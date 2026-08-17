import { describe, expect, test } from "bun:test";
import {
  alignEvidenceViewCommand,
  alignHowToExplore,
  evidenceBudgets,
  nextEvidenceAction,
  pageSlice,
  pageWithNextCommand,
  samePageExpandedBudgetCommand,
  takeLinesByByteBudget,
  takeRecordsByByteBudget,
} from "../project/proseAlignBudget.js";
import { suggestedAlignPayloadPath } from "../project/proseAlignTypes.js";

describe("prose align evidence budgets", () => {
  test("derives readable unique scratch paths without restricting custom inputs", () => {
    expect(suggestedAlignPayloadPath("align:file:docs:architecture")).toBe(
      ".tmp/agent-payloads/align-file-docs-architecture-structure.yaml",
    );
    const prefix = "align:file:" + "long-source-".repeat(20);
    const first = suggestedAlignPayloadPath(`${prefix}a:architecture`);
    const second = suggestedAlignPayloadPath(`${prefix}b:architecture`);
    expect(first).not.toBe(second);
    expect(first).toMatch(/^\.tmp\/agent-payloads\/[a-z0-9-]+-structure\.yaml$/u);
  });

  test("parses token and byte budgets from align options", () => {
    expect(evidenceBudgets({ tokenBudget: "123", byteBudget: "456" })).toEqual({
      tokenBudget: 123,
      byteBudget: 456,
    });
  });

  test("truncates record lists by byte budget without losing a stable first item", () => {
    const result = takeRecordsByByteBudget([
      { id: "a", text: "x".repeat(100) },
      { id: "b", text: "y".repeat(100) },
    ], 80);

    expect(result.byte_budget).toBe(80);
    expect(result.byte_truncated).toBe(true);
    expect(result.items[0]?.id).toBe("a");
    expect(result.byte_omitted_count).toBe(1);
  });

  test("paginates span text on line boundaries under byte budget", () => {
    const result = takeLinesByByteBudget({
      lines: ["alpha", "beta".repeat(20), "gamma"],
      lineStart: 1,
      lineEnd: 3,
      byteBudget: 16,
    });

    expect(result.lineEnd).toBe(1);
    expect(result.byte_truncated).toBe(true);
  });

  test("builds exact continuation commands instead of requiring agents to compose them", () => {
    const page = {
      total: 5,
      shown: 2,
      page_size: 2,
      page_token: "0",
      has_more: true,
      next_token: "2",
    };
    const options = {
      source: "Getting Started.md",
      pageSize: "2",
      tokenBudget: "100",
      byteBudget: "2000",
    };

    expect(pageWithNextCommand({
      phaseId: "align:file:docs:architecture",
      view: "chunks",
      options,
      page,
    })?.next_command).toBe("context run align:file:docs:architecture --view chunks --source 'Getting Started.md' --token-budget 100 --byte-budget 2000 --page-size 2 --page-token 2 --format json");

    expect(nextEvidenceAction({
      phaseId: "align:file:docs:architecture",
      view: "chunks",
      options,
      page,
      budget: {
        truncated: false,
        omitted_count: 0,
        how_to_explore: [],
      },
      truncatedCommandArgs: ["--view", "chunks", "--format", "json"],
    }).command).toBe("context run align:file:docs:architecture --view chunks --source 'Getting Started.md' --token-budget 100 --byte-budget 2000 --page-size 2 --page-token 2 --format json");
  });

  test("preserves scoped evidence commands when expanding truncated budgets", () => {
    const options = {
      source: "Getting Started.md",
      pageSize: "2",
      tokenBudget: "100",
      byteBudget: "2000",
    };
    const command = alignEvidenceViewCommand({
      phaseId: "align:file:docs:architecture",
      view: "chunks",
      options,
      overrides: {
        pageSize: "20",
        tokenBudget: "5000",
        byteBudget: "4000",
        pageToken: null,
        readCursor: null,
      },
    });

    expect(nextEvidenceAction({
      phaseId: "align:file:docs:architecture",
      view: "chunks",
      options,
      page: undefined,
      budget: {
        truncated: true,
        omitted_count: 1,
        how_to_explore: alignHowToExplore({
          phaseId: "align:file:docs:architecture",
          view: "chunks",
          options,
          budget: { tokenBudget: 100, byteBudget: 2000 },
        }),
      },
      truncatedCommandArgs: ["--view", "chunks", "--format", "json"],
      truncatedCommand: command,
    }).command).toBe("context run align:file:docs:architecture --view chunks --source 'Getting Started.md' --token-budget 5000 --byte-budget 4000 --page-size 20 --format json");

    const hints = alignHowToExplore({
      phaseId: "align:file:docs:architecture",
      view: "chunks",
      options,
      budget: { tokenBudget: 100, byteBudget: 2000 },
    });
    expect(hints.map((hint) => hint.command).join("\n")).toContain("--source 'Getting Started.md'");
    expect(hints.map((hint) => hint.command).join("\n")).not.toContain("--page-token");
    for (const hint of hints) {
      expect(hint.command.match(/--token-budget/gu)?.length ?? 0).toBe(1);
    }
  });

  test("preserves placeholders while quoting concrete unsafe arguments", () => {
    expect(alignEvidenceViewCommand({
      phaseId: "align:file:docs:architecture",
      view: "full-text",
      options: {
        source: "<document-path-or-locator>",
        pageSize: "120",
      },
    })).toBe("context run align:file:docs:architecture --view full-text --source <document-path-or-locator> --page-size 120 --format json");
  });

  test("returns an executable restart command for expired item cursors", () => {
    const restart = alignEvidenceViewCommand({
      phaseId: "align:file:docs:architecture",
      view: "chunks",
      options: {
        source: "Getting Started.md",
        pageSize: "2",
        pageToken: "99",
        byteBudget: "2000",
      },
      overrides: {
        pageToken: null,
        readCursor: null,
      },
    });

    try {
      pageSlice([{ id: "a" }], {
        source: "Getting Started.md",
        pageSize: "2",
        pageToken: "99",
        byteBudget: "2000",
      }, restart);
      throw new Error("expected pageSlice to reject an expired cursor");
    } catch (error) {
      expect(error).toMatchObject({
        message: "--page-token is beyond the item count",
        detail: {
          next: restart,
          repair_hints: [expect.objectContaining({ command: restart })],
        },
      });
    }
  });

  test("expands truncated budgets on the current page before continuing", () => {
    const page = {
      total: 60,
      shown: 20,
      page_size: 20,
      page_token: "20",
      has_more: true,
      next_token: "40",
    };
    const options = {
      pageSize: "20",
      pageToken: "20",
      byteBudget: "1",
    };
    const command = samePageExpandedBudgetCommand({
      phaseId: "align:file:docs:architecture",
      view: "chunks",
      options,
      page,
      byteBudget: "24000",
    });

    const action = nextEvidenceAction({
      phaseId: "align:file:docs:architecture",
      view: "chunks",
      options,
      page,
      budget: {
        truncated: true,
        omitted_count: 19,
        how_to_explore: [],
      },
      truncatedCommandArgs: ["--view", "chunks", "--format", "json"],
      truncatedCommand: command,
    });

    expect(action).toMatchObject({
      kind: "read_more_evidence",
      reason_code: "prose-align-budget-truncated",
    });
    expect(action.command).toContain("--page-token 20");
    expect(action.command).not.toContain("--page-token 40");
  });
});
