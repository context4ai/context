import { Buffer } from "node:buffer";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import {
  buildBudgetHowToExplore,
  DEFAULT_TOKEN_BUDGET,
  DEFAULT_WORKFLOW_OUTPUT_BYTE_BUDGET,
  previewTextFields,
  type TokenBudgetHowToExplore,
} from "../lib/tokenBudget.js";
import { ExitCode } from "../types/exitCode.js";
import { alignCommand, suggestedAlignPayloadPath, type AlignView, type ProseAlignRunOptions } from "./proseAlignTypes.js";

export interface EvidenceBudgetOptions {
  tokenBudget: number;
  byteBudget: number;
}

export interface PageSliceResult<T> {
  items: T[];
  page?: Record<string, unknown>;
}

export interface ByteBudgetResult<T extends Record<string, unknown>> {
  items: T[];
  byte_budget: number;
  byte_used: number;
  byte_omitted_count: number;
  byte_truncated: boolean;
}

export interface LineByteBudgetResult {
  lineEnd: number;
  byte_used: number;
  byte_truncated: boolean;
}

interface AlignEvidenceCommandOverrides {
  pageSize?: string | null;
  pageToken?: string | null;
  readCursor?: string | null;
  tokenBudget?: string | null;
  byteBudget?: string | null;
}

function userError(message: string, detail: Record<string, unknown> = {}): ContextError {
  return new ContextError(ExitCode.UserError, message, {
    category: ErrorCategory.UserInputInvalid,
    ...detail,
  });
}

function jsonByteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function textByteSize(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function parsePositiveOption(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw userError(`${flag} must be a positive integer`, {
      [flag.replace(/^--/u, "").replace(/-/gu, "_")]: value,
    });
  }
  return parsed;
}

export function parseNonNegativeOption(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw userError(`${flag} must be a non-negative integer`, {
      [flag.replace(/^--/u, "").replace(/-/gu, "_")]: value,
    });
  }
  return parsed;
}

export function evidenceBudgets(options: ProseAlignRunOptions): EvidenceBudgetOptions {
  return {
    tokenBudget: parsePositiveOption(options.tokenBudget, "--token-budget", DEFAULT_TOKEN_BUDGET),
    byteBudget: parsePositiveOption(options.byteBudget, "--byte-budget", DEFAULT_WORKFLOW_OUTPUT_BYTE_BUDGET),
  };
}

export function pageSlice<T>(
  items: readonly T[],
  options: ProseAlignRunOptions,
  restartCommand?: string,
): PageSliceResult<T> {
  const pageSize = options.pageSize === undefined ? undefined : parsePositiveOption(options.pageSize, "--page-size", 50);
  if (pageSize === undefined) return { items: [...items] };
  const token = options.readCursor ?? options.pageToken;
  const offset = parseNonNegativeOption(token, token === options.readCursor ? "--read-cursor" : "--page-token", 0);
  if (offset > items.length || (items.length > 0 && offset === items.length)) {
    throw userError("--page-token is beyond the item count", {
      page_token: token,
      total: items.length,
      diagnostics: [{
        severity: "error",
        code: "cursor.expired",
        family: "cursor",
        message: "The pagination cursor no longer matches the current evidence view.",
      }],
      repair_hints: [{
        action: "restart_view_without_cursor",
        reason: "Evidence views are regenerated from current snapshots; use a fresh page token from the latest response.",
        ...(restartCommand !== undefined ? { command: restartCommand } : {}),
      }],
      next: restartCommand ?? "Rerun the same evidence view without --page-token/--read-cursor, then continue with the returned next_token.",
    });
  }
  const pageItems = items.slice(offset, offset + pageSize);
  const nextOffset = offset + pageItems.length;
  return {
    items: pageItems,
    page: {
      total: items.length,
      shown: pageItems.length,
      page_size: pageSize,
      page_token: String(offset),
      has_more: nextOffset < items.length,
      ...(nextOffset < items.length ? { next_token: String(nextOffset) } : {}),
    },
  };
}

export function alignHowToExplore(input: {
  phaseId: string;
  view: AlignView;
  options: ProseAlignRunOptions;
  budget: EvidenceBudgetOptions;
}): TokenBudgetHowToExplore[] {
  const baseCommand = alignEvidenceViewCommand({
    phaseId: input.phaseId,
    view: input.view,
    options: input.options,
    overrides: {
      tokenBudget: null,
      byteBudget: String(input.budget.byteBudget),
      pageToken: null,
      readCursor: null,
    },
  });
  const tokenHints = buildBudgetHowToExplore({
    baseCommand,
    tokenBudget: input.budget.tokenBudget,
    narrowScopes: input.options.source === undefined ? [
      {
        kind: "source",
        placeholder: "<document-path-or-locator>",
        reason: "Narrow reading to one snapshot document.",
      },
    ] : [],
  });
  return [
    ...tokenHints,
    {
      level: "expand_byte_budget",
      reason: "Increase byte budget when the current evidence view is folded by output size.",
      command: alignEvidenceViewCommand({
        phaseId: input.phaseId,
        view: input.view,
        options: input.options,
        overrides: {
          tokenBudget: String(input.budget.tokenBudget),
          byteBudget: String(Math.max(input.budget.byteBudget * 2, DEFAULT_WORKFLOW_OUTPUT_BYTE_BUDGET)),
          pageToken: null,
          readCursor: null,
        },
      }),
    },
  ];
}

export function alignEvidenceViewCommand(input: {
  phaseId: string;
  view: AlignView;
  options?: ProseAlignRunOptions;
  overrides?: AlignEvidenceCommandOverrides;
}): string {
  const options = input.options ?? {};
  const overrides = input.overrides ?? {};
  const args = ["--view", input.view];
  if (options.compact === true) args.push("--compact");
  if (options.source !== undefined) args.push("--source", options.source);
  if (options.chunk !== undefined) args.push("--chunk", options.chunk);
  if (options.span !== undefined) args.push("--span", options.span);
  if (options.range !== undefined) args.push("--range", options.range);
  if (options.query !== undefined) args.push("--query", options.query);
  if (options.collection !== undefined) args.push("--collection", options.collection);
  if (options.nodeType !== undefined) args.push("--node-type", options.nodeType);
  const tokenBudget = Object.hasOwn(overrides, "tokenBudget") ? overrides.tokenBudget : options.tokenBudget;
  if (typeof tokenBudget === "string") args.push("--token-budget", tokenBudget);
  const byteBudget = Object.hasOwn(overrides, "byteBudget") ? overrides.byteBudget : options.byteBudget;
  if (typeof byteBudget === "string") args.push("--byte-budget", byteBudget);
  const pageSize = Object.hasOwn(overrides, "pageSize") ? overrides.pageSize : options.pageSize;
  if (typeof pageSize === "string") args.push("--page-size", pageSize);
  const pageToken = Object.hasOwn(overrides, "pageToken") ? overrides.pageToken : options.pageToken;
  if (typeof pageToken === "string") args.push("--page-token", pageToken);
  const readCursor = Object.hasOwn(overrides, "readCursor") ? overrides.readCursor : options.readCursor;
  if (typeof readCursor === "string") args.push("--read-cursor", readCursor);
  args.push("--format", "json");
  return alignCommand(input.phaseId, args);
}

export function pageContinuationCommand(input: {
  phaseId: string;
  view: AlignView;
  options: ProseAlignRunOptions;
  page: Record<string, unknown> | undefined;
}): string | undefined {
  const nextToken = typeof input.page?.next_token === "string" ? input.page.next_token : undefined;
  const pageSize = typeof input.page?.page_size === "number" ? String(input.page.page_size) : undefined;
  if (nextToken === undefined || pageSize === undefined) return undefined;
  return alignEvidenceViewCommand({
    phaseId: input.phaseId,
    view: input.view,
    options: input.options,
    overrides: {
      pageSize,
      pageToken: nextToken,
      readCursor: null,
    },
  });
}

export function pageWithNextCommand(input: {
  phaseId: string;
  view: AlignView;
  options: ProseAlignRunOptions;
  page: Record<string, unknown> | undefined;
}): Record<string, unknown> | undefined {
  if (input.page === undefined) return undefined;
  const command = pageContinuationCommand(input);
  return command === undefined ? input.page : { ...input.page, next_command: command };
}

function currentPageToken(page: Record<string, unknown> | undefined): string | null {
  const token = typeof page?.page_token === "string" ? page.page_token : undefined;
  if (token === undefined || token === "0") return null;
  return token;
}

export function samePageExpandedBudgetCommand(input: {
  phaseId: string;
  view: AlignView;
  options: ProseAlignRunOptions;
  page: Record<string, unknown> | undefined;
  pageSize?: string | null;
  tokenBudget?: string;
  byteBudget?: string;
}): string {
  const overrides: AlignEvidenceCommandOverrides = {
    pageToken: currentPageToken(input.page),
    readCursor: null,
  };
  if (input.pageSize !== undefined) {
    overrides.pageSize = input.pageSize;
  } else if (typeof input.page?.page_size === "number") {
    overrides.pageSize = String(input.page.page_size);
  }
  if (input.tokenBudget !== undefined) overrides.tokenBudget = input.tokenBudget;
  if (input.byteBudget !== undefined) overrides.byteBudget = input.byteBudget;
  return alignEvidenceViewCommand({
    phaseId: input.phaseId,
    view: input.view,
    options: input.options,
    overrides,
  });
}

export function takeRecordsByByteBudget<T extends Record<string, unknown>>(
  items: readonly T[],
  byteBudget: number,
): ByteBudgetResult<T> {
  const kept: T[] = [];
  let byteUsed = 0;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === undefined) continue;
    const itemBytes = jsonByteSize(item);
    if (byteUsed + itemBytes <= byteBudget) {
      kept.push(item);
      byteUsed += itemBytes;
      continue;
    }
    if (kept.length === 0) {
      const preview = previewTextFields(item, Math.max(80, Math.floor(byteBudget / 4)));
      kept.push(preview);
      byteUsed += jsonByteSize(preview);
      return {
        items: kept,
        byte_budget: byteBudget,
        byte_used: byteUsed,
        byte_omitted_count: items.length - index - 1,
        byte_truncated: true,
      };
    }
    return {
      items: kept,
      byte_budget: byteBudget,
      byte_used: byteUsed,
      byte_omitted_count: items.length - index,
      byte_truncated: true,
    };
  }
  return {
    items: kept,
    byte_budget: byteBudget,
    byte_used: byteUsed,
    byte_omitted_count: 0,
    byte_truncated: false,
  };
}

export function applyByteBudgetToWindow<T extends Record<string, unknown>, W extends {
  items: T[];
  context_items: T[];
  truncated: boolean;
}>(
  window: W,
  byteBudget: number,
): W & {
  byte_budget: number;
  byte_used: number;
  byte_omitted_count: number;
  byte_context_omitted_count: number;
  byte_truncated: boolean;
} {
  const main = takeRecordsByByteBudget(window.items, byteBudget);
  const remaining = Math.max(1, byteBudget - main.byte_used);
  const context = takeRecordsByByteBudget(window.context_items, remaining);
  const byteTruncated = main.byte_truncated || context.byte_truncated;
  return {
    ...window,
    items: main.items,
    context_items: context.items,
    truncated: window.truncated || byteTruncated,
    byte_budget: byteBudget,
    byte_used: main.byte_used + context.byte_used,
    byte_omitted_count: main.byte_omitted_count,
    byte_context_omitted_count: context.byte_omitted_count,
    byte_truncated: byteTruncated,
  };
}

export function nextReadAction(input: {
  phaseId: string;
  view: AlignView;
  options: ProseAlignRunOptions;
  page: Record<string, unknown> | undefined;
}): Record<string, unknown> {
  const command = pageContinuationCommand(input);
  if (command !== undefined) {
    return {
      kind: "read_next_page",
      command,
      reason_code: "prose-align-next-page",
    };
  }
  return {
    kind: "validate_payload",
    command: alignCommand(input.phaseId, ["--validate", "--input", suggestedAlignPayloadPath(input.phaseId), "--format", "json"]),
    reason_code: "prose-align-ready-for-payload",
  };
}

export function nextEvidenceAction(input: {
  phaseId: string;
  view: AlignView;
  options: ProseAlignRunOptions;
  page: Record<string, unknown> | undefined;
  budget: {
    truncated: boolean;
    omitted_count: number;
    context_omitted_count?: number;
    byte_omitted_count?: number;
    byte_context_omitted_count?: number;
    how_to_explore: unknown[];
  };
  truncatedCommandArgs: readonly string[];
  truncatedCommand?: string;
}): Record<string, unknown> {
  if (input.budget.truncated) {
    return {
      kind: "read_more_evidence",
      command: input.truncatedCommand ?? alignCommand(input.phaseId, input.truncatedCommandArgs),
      reason_code: "prose-align-budget-truncated",
      omitted_count: input.budget.omitted_count + (input.budget.context_omitted_count ?? 0),
      byte_omitted_count: (input.budget.byte_omitted_count ?? 0) + (input.budget.byte_context_omitted_count ?? 0),
      how_to_explore: input.budget.how_to_explore,
    };
  }
  const pageCommand = pageContinuationCommand(input);
  if (pageCommand !== undefined) {
    return {
      kind: "read_next_page",
      command: pageCommand,
      reason_code: "prose-align-next-page",
    };
  }
  return nextReadAction(input);
}

export function parseRange(value: string): { start: number; end: number } {
  const normalized = value.trim().replace(/^L(\d+)-(?:L)?(\d+)$/iu, "$1-$2");
  const match = /^(\d+)(?:-|:)(\d+)$/u.exec(normalized) ?? /^(\d+)$/u.exec(normalized);
  if (match?.[1] === undefined) {
    throw userError("--range must be L<start>-<end>, <start>-<end>, or <line>", {
      range: value,
    });
  }
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw userError("--range must use positive ascending line numbers", { range: value });
  }
  return { start, end };
}

export function takeLinesByByteBudget(input: {
  lines: readonly string[];
  lineStart: number;
  lineEnd: number;
  byteBudget: number;
}): LineByteBudgetResult {
  let byteUsed = 0;
  let lineEnd = input.lineStart - 1;
  for (let lineNumber = input.lineStart; lineNumber <= input.lineEnd; lineNumber += 1) {
    const line = input.lines[lineNumber - 1] ?? "";
    const chunk = lineNumber === input.lineStart ? line : `\n${line}`;
    const chunkBytes = textByteSize(chunk);
    if (byteUsed > 0 && byteUsed + chunkBytes > input.byteBudget) break;
    byteUsed += chunkBytes;
    lineEnd = lineNumber;
    if (byteUsed > input.byteBudget) break;
  }
  if (lineEnd < input.lineStart) {
    lineEnd = input.lineStart;
    byteUsed = textByteSize(input.lines[input.lineStart - 1] ?? "");
  }
  return {
    lineEnd,
    byte_used: byteUsed,
    byte_truncated: lineEnd < input.lineEnd,
  };
}
