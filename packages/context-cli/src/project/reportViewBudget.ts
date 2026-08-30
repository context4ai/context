import { Buffer } from "node:buffer";
import {
  buildOutputBudgetSplit,
  buildTokenBudgetWindow,
  DEFAULT_TOKEN_BUDGET,
  DEFAULT_WORKFLOW_OUTPUT_BYTE_BUDGET,
  type TokenBudgetSelectionPolicy,
} from "../lib/tokenBudget.js";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";

export interface ReportViewOptions {
  tokenBudget?: string;
  byteBudget?: string;
  pageSize?: string;
  pageToken?: string;
}

export interface ReportViewItem extends Record<string, unknown> {
  item_id: string;
  item_kind: string;
}

interface ParsedReportViewOptions {
  tokenBudget: number;
  byteBudget: number;
  pageSize: number;
  offset: number;
}

function positiveInteger(value: string | undefined, fallback: number, flag: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  throw new ContextError(ExitCode.UserError, `${flag} must be a positive integer`, {
    category: ErrorCategory.UserInputInvalid,
    [flag.replace(/^--/u, "").replaceAll("-", "_")]: value,
  });
}

function nonNegativeInteger(value: string | undefined, fallback: number, flag: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  throw new ContextError(ExitCode.UserError, `${flag} must be a non-negative integer`, {
    category: ErrorCategory.UserInputInvalid,
    [flag.replace(/^--/u, "").replaceAll("-", "_")]: value,
  });
}

function parsedOptions(options: ReportViewOptions): ParsedReportViewOptions {
  return {
    tokenBudget: positiveInteger(options.tokenBudget, DEFAULT_TOKEN_BUDGET, "--token-budget"),
    byteBudget: positiveInteger(options.byteBudget, DEFAULT_WORKFLOW_OUTPUT_BYTE_BUDGET, "--byte-budget"),
    pageSize: Math.min(100, positiveInteger(options.pageSize, 25, "--page-size")),
    offset: nonNegativeInteger(options.pageToken, 0, "--page-token"),
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function command(input: {
  baseCommand: string;
  pageSize: number;
  pageToken: number;
  tokenBudget: number;
  byteBudget: number;
}): string {
  return [
    input.baseCommand,
    "--page-size",
    String(input.pageSize),
    "--page-token",
    String(input.pageToken),
    "--token-budget",
    String(input.tokenBudget),
    "--byte-budget",
    String(input.byteBudget),
    "--format json",
  ].join(" ");
}

export function reportViewBaseCommand(input: {
  command: string;
  args?: readonly [string, string][];
}): string {
  const args = (input.args ?? []).flatMap(([flag, value]) => [flag, shellQuote(value)]);
  return [input.command, ...args].join(" ");
}

export function buildReportViewWindow<T extends ReportViewItem>(input: {
  items: readonly T[];
  options: ReportViewOptions;
  baseCommand: string;
  selectionPolicy: TokenBudgetSelectionPolicy;
  completeKind: string;
  nextPageKind: string;
  budgetTruncatedKind: string;
}): {
  output_budget: Record<string, number>;
  page: Record<string, unknown>;
  items: ReturnType<typeof buildTokenBudgetWindow<T>>;
  next_action: Record<string, unknown>;
} {
  const options = parsedOptions(input.options);
  if (options.offset > input.items.length || (input.items.length > 0 && options.offset === input.items.length)) {
    const restart = command({
      baseCommand: input.baseCommand,
      pageSize: options.pageSize,
      pageToken: 0,
      tokenBudget: options.tokenBudget,
      byteBudget: options.byteBudget,
    });
    throw new ContextError(ExitCode.UserError, "--page-token is beyond the report item count", {
      category: ErrorCategory.UserInputInvalid,
      page_token: String(options.offset),
      total: input.items.length,
      diagnostics: [{
        severity: "error",
        code: "cursor.expired",
        family: "cursor",
        message: "The pagination cursor no longer matches this digest-bound report view.",
      }],
      next_action: { kind: "restart_report_view", command: restart },
      next: restart,
    });
  }

  const selected = input.items.slice(options.offset, options.offset + options.pageSize);
  const split = buildOutputBudgetSplit({ totalByteBudget: options.byteBudget });
  const narrowerPageSize = Math.max(1, Math.min(options.pageSize - 1, Math.floor(options.pageSize / 2)));
  const narrowCommand = command({
    baseCommand: input.baseCommand,
    pageSize: narrowerPageSize,
    pageToken: options.offset,
    tokenBudget: options.tokenBudget,
    byteBudget: options.byteBudget,
  });
  const tokenWindow = buildTokenBudgetWindow({
    entries: selected.map((item) => ({ item })),
    itemIdField: "item_id",
    tokenBudget: options.tokenBudget,
    selectionPolicy: input.selectionPolicy,
    howToExplore: [{
      level: "narrow_page",
      reason: "Read fewer digest-bound items at the same cursor while retaining the fixed stdout budget.",
      command: narrowCommand,
    }],
  });

  const kept: T[] = [];
  let byteUsed = 0;
  for (const item of tokenWindow.items) {
    const bytes = Buffer.byteLength(JSON.stringify(item), "utf8");
    if (kept.length > 0 && byteUsed + bytes > split.value_budget) break;
    if (kept.length === 0 && bytes > split.value_budget) {
      throw new ContextError(ExitCode.WorkspaceStateError, "one report item exceeds the fixed stdout value budget", {
        category: ErrorCategory.WorkspaceStateInvalid,
        item_id: item.item_id,
        item_kind: item.item_kind,
        item_bytes: bytes,
        item_byte_budget: split.value_budget,
        next: "The report producer must split this semantic item into stable child items.",
      });
    }
    kept.push(item);
    byteUsed += bytes;
  }
  const omittedByBytes = tokenWindow.items.length - kept.length;
  const truncated = tokenWindow.truncated || omittedByBytes > 0;
  const itemWindow = {
    ...tokenWindow,
    items: kept,
    token_used: kept.reduce((sum, item) => sum + Math.max(1, Math.ceil(JSON.stringify(item).length / 4)), 0),
    shown_count: kept.length,
    omitted_count: tokenWindow.omitted_count + omittedByBytes,
    truncated,
    byte_budget: split.value_budget,
    byte_used: byteUsed,
    byte_omitted_count: omittedByBytes,
    byte_truncated: omittedByBytes > 0,
  };
  const nextOffset = options.offset + selected.length;
  const hasMorePages = nextOffset < input.items.length;
  const nextPageCommand = hasMorePages
    ? command({
        baseCommand: input.baseCommand,
        pageSize: options.pageSize,
        pageToken: nextOffset,
        tokenBudget: options.tokenBudget,
        byteBudget: options.byteBudget,
      })
    : undefined;
  const page = {
    total: input.items.length,
    offset: options.offset,
    page_size: options.pageSize,
    selected: selected.length,
    shown: kept.length,
    omitted_in_window: selected.length - kept.length,
    remaining: Math.max(0, input.items.length - options.offset - kept.length),
    truncated,
    has_more: truncated || hasMorePages,
    ...(nextPageCommand === undefined || truncated ? {} : {
      next_token: String(nextOffset),
      next_command: nextPageCommand,
    }),
  };
  const nextAction = truncated
    ? {
        kind: input.budgetTruncatedKind,
        command: narrowCommand,
        reason_code: "report-view-budget-truncated",
        omitted_in_window: selected.length - kept.length,
      }
    : nextPageCommand === undefined
      ? { kind: input.completeKind }
      : {
          kind: input.nextPageKind,
          command: nextPageCommand,
          reason_code: "report-view-next-page",
        };
  return {
    output_budget: {
      token_budget: options.tokenBudget,
      total_byte_budget: split.total_byte_budget,
      metadata_byte_budget: split.metadata_budget,
      item_byte_budget: split.value_budget,
    },
    page,
    items: itemWindow,
    next_action: nextAction,
  };
}
