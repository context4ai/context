export const DEFAULT_TOKEN_BUDGET = 2000;
export const DEFAULT_EXPANDED_TOKEN_BUDGET = 5000;
export const DEFAULT_WORKFLOW_OUTPUT_BYTE_BUDGET = 24_000;
export const DEFAULT_WORKFLOW_METADATA_BYTE_BUDGET = 6_000;

const APPROX_CHARS_PER_TOKEN = 4;
const PREVIEW_TEXT_LIMIT = 240;

export type TokenBudgetOrderDirection = "asc" | "desc";

export interface TokenBudgetSelectionOrder {
  field: string;
  direction: TokenBudgetOrderDirection;
}

export interface TokenBudgetSelectionPolicy {
  id: string;
  order: readonly TokenBudgetSelectionOrder[];
  note?: string;
}

export interface TokenBudgetHowToExplore {
  level: string;
  reason: string;
  command: string;
}

export interface TokenBudgetPreviewContext {
  itemTokenEstimate: number;
  remainingBudget: number;
  tokenBudget: number;
}

export interface TokenBudgetEntry<T extends Record<string, unknown>> {
  item: T;
  tokenEstimate?: number;
  contextOnly?: boolean;
}

export interface BuildTokenBudgetWindowOptions<T extends Record<string, unknown>> {
  entries: readonly TokenBudgetEntry<T>[];
  itemIdField: string;
  tokenBudget: number;
  selectionPolicy: TokenBudgetSelectionPolicy;
  howToExplore?: readonly TokenBudgetHowToExplore[];
  estimateTokens?: (item: T) => number;
  previewItem?: (item: T, context: TokenBudgetPreviewContext) => T;
}

export interface TokenBudgetWindow<T extends Record<string, unknown>> {
  items: T[];
  context_items: T[];
  context_omitted_count: number;
  item_id_field: string;
  token_budget: number;
  token_used: number;
  shown_count: number;
  total: number;
  omitted_count: number;
  truncated: boolean;
  selection_policy: TokenBudgetSelectionPolicy;
  how_to_explore: TokenBudgetHowToExplore[];
}

interface TakeBudgetEntriesOptions<T extends Record<string, unknown>> {
  entries: readonly TokenBudgetEntry<T>[];
  remainingBudget: number;
  tokenBudget: number;
  itemIdField: string;
  estimateTokens?: (item: T) => number;
  previewItem?: (item: T, context: TokenBudgetPreviewContext) => T;
}

interface TakeBudgetEntriesResult<T extends Record<string, unknown>> {
  items: T[];
  tokenUsed: number;
  omittedCount: number;
}

export type BudgetNarrowScopeKind = "source" | "heading" | "type" | "node";

export interface BudgetNarrowScope {
  kind: BudgetNarrowScopeKind;
  value?: string;
  placeholder?: string;
  reason?: string;
  tokenBudget?: number;
}

export interface BuildBudgetHowToExploreOptions {
  baseCommand: string;
  tokenBudget: number;
  expandBudget?: number;
  narrowScopes?: readonly BudgetNarrowScope[];
}

export interface OutputBudgetSplit {
  total_byte_budget: number;
  metadata_budget: number;
  value_budget: number;
  metadata_bytes: number;
}

export interface BuildOutputBudgetSplitOptions {
  totalByteBudget?: number;
  metadataByteBudget?: number;
  metadataBytes?: number;
}

export function normalizeTokenBudget(value: number | undefined, defaultBudget = DEFAULT_TOKEN_BUDGET): number {
  const budget = value ?? defaultBudget;
  if (!Number.isInteger(budget) || budget < 1) {
    throw new Error("token budget must be a positive integer");
  }
  return budget;
}

export function buildOutputBudgetSplit(options: BuildOutputBudgetSplitOptions = {}): OutputBudgetSplit {
  const total = positiveIntegerOrDefault(options.totalByteBudget, DEFAULT_WORKFLOW_OUTPUT_BYTE_BUDGET);
  const requestedMetadata = positiveIntegerOrDefault(options.metadataByteBudget, DEFAULT_WORKFLOW_METADATA_BYTE_BUDGET);
  const metadataBudget = Math.min(requestedMetadata, Math.max(1, total - 1));
  const metadataBytes = Math.max(0, Math.ceil(options.metadataBytes ?? 0));
  return {
    total_byte_budget: total,
    metadata_budget: metadataBudget,
    value_budget: Math.max(1, total - metadataBudget),
    metadata_bytes: metadataBytes,
  };
}

export function estimateMaxFittingPageSize(input: {
  requestedPageSize: number;
  estimatedBytes: number;
  byteBudget?: number;
  safetyRatio?: number;
}): number {
  const requested = positiveIntegerOrDefault(input.requestedPageSize, 1);
  const estimatedBytes = positiveIntegerOrDefault(input.estimatedBytes, 1);
  const byteBudget = positiveIntegerOrDefault(input.byteBudget, DEFAULT_WORKFLOW_OUTPUT_BYTE_BUDGET);
  const safetyRatio = typeof input.safetyRatio === "number" && Number.isFinite(input.safetyRatio) && input.safetyRatio > 0
    ? input.safetyRatio
    : 0.85;
  return Math.max(1, Math.floor(requested * (byteBudget / estimatedBytes) * safetyRatio));
}

export function estimateTokenCount(value: unknown): number {
  const text = typeof value === "string" ? value : stringifyForTokenEstimate(value);
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) return 0;
  return Math.max(1, Math.ceil(normalized.length / APPROX_CHARS_PER_TOKEN));
}

export function previewTextFields<T extends Record<string, unknown>>(item: T, maxChars = PREVIEW_TEXT_LIMIT): T {
  const next: Record<string, unknown> = { ...item };
  for (const key of ["text", "content", "quote", "preview", "text_preview", "quote_preview", "content_preview"]) {
    const value = next[key];
    if (typeof value !== "string" || value.length <= maxChars) continue;
    next[key] = `${value.slice(0, maxChars).trimEnd()}...`;
    next.preview_truncated = true;
  }
  return next as T;
}

export function buildTokenBudgetWindow<T extends Record<string, unknown>>(
  options: BuildTokenBudgetWindowOptions<T>,
): TokenBudgetWindow<T> {
  const tokenBudget = normalizeTokenBudget(options.tokenBudget);
  const mainEntries = options.entries.filter((entry) => entry.contextOnly !== true);
  const contextEntries = options.entries.filter((entry) => entry.contextOnly === true);
  const main = takeBudgetEntries({
    entries: mainEntries,
    remainingBudget: tokenBudget,
    tokenBudget,
    itemIdField: options.itemIdField,
    ...(options.estimateTokens !== undefined ? { estimateTokens: options.estimateTokens } : {}),
    ...(options.previewItem !== undefined ? { previewItem: options.previewItem } : {}),
  });
  const context = takeBudgetEntries({
    entries: contextEntries,
    remainingBudget: Math.max(0, tokenBudget - main.tokenUsed),
    tokenBudget,
    itemIdField: options.itemIdField,
    ...(options.estimateTokens !== undefined ? { estimateTokens: options.estimateTokens } : {}),
    ...(options.previewItem !== undefined ? { previewItem: options.previewItem } : {}),
  });
  const contextOmittedCount = contextEntries.length - context.items.length;
  const hasEntries = options.entries.length > 0;
  return {
    items: main.items,
    context_items: context.items,
    context_omitted_count: contextOmittedCount,
    item_id_field: options.itemIdField,
    token_budget: tokenBudget,
    token_used: main.tokenUsed + context.tokenUsed,
    shown_count: main.items.length,
    total: mainEntries.length,
    omitted_count: main.omittedCount,
    truncated: main.omittedCount > 0 || contextOmittedCount > 0,
    selection_policy: cloneSelectionPolicy(options.selectionPolicy),
    how_to_explore: hasEntries ? cloneHowToExplore(options.howToExplore ?? []) : [],
  };
}

export function buildBudgetHowToExplore(options: BuildBudgetHowToExploreOptions): TokenBudgetHowToExplore[] {
  const tokenBudget = normalizeTokenBudget(options.tokenBudget);
  const commands = (options.narrowScopes ?? []).map((scope) => {
    const scopeBudget = normalizeTokenBudget(scope.tokenBudget, tokenBudget);
    return {
      level: `narrow_scope_by_${scope.kind}`,
      reason: scope.reason ?? defaultNarrowScopeReason(scope.kind),
      command: appendCommandArgs(options.baseCommand, [
        flagForNarrowScope(scope.kind),
        scope.value !== undefined ? quoteShellArg(scope.value) : defaultNarrowScopePlaceholder(scope.kind, scope.placeholder),
        "--token-budget",
        String(scopeBudget),
      ]),
    };
  });
  const defaultExpandBudget = tokenBudget < DEFAULT_EXPANDED_TOKEN_BUDGET
    ? DEFAULT_EXPANDED_TOKEN_BUDGET
    : tokenBudget * 2;
  const requestedExpandBudget = normalizeTokenBudget(options.expandBudget, defaultExpandBudget);
  const expandBudget = requestedExpandBudget > tokenBudget ? requestedExpandBudget : defaultExpandBudget;
  return [
    ...commands,
    {
      level: "expand_budget",
      reason: "Increase token budget to show more items in the current view.",
      command: appendCommandArgs(options.baseCommand, ["--token-budget", String(expandBudget)]),
    },
  ];
}

function takeBudgetEntries<T extends Record<string, unknown>>(
  options: TakeBudgetEntriesOptions<T>,
): TakeBudgetEntriesResult<T> {
  const items: T[] = [];
  let tokenUsed = 0;
  for (let index = 0; index < options.entries.length; index += 1) {
    const entry = options.entries[index];
    if (entry === undefined) continue;
    const remainingBudget = options.remainingBudget - tokenUsed;
    const resolved = materializeBudgetItem(entry, {
      remainingBudget,
      tokenBudget: options.tokenBudget,
      ...(options.estimateTokens !== undefined ? { estimateTokens: options.estimateTokens } : {}),
      ...(options.previewItem !== undefined ? { previewItem: options.previewItem } : {}),
    });
    if (resolved === undefined) {
      return {
        items,
        tokenUsed,
        omittedCount: options.entries.length - index,
      };
    }
    assertStableHandle(resolved.item, options.itemIdField);
    items.push(resolved.item);
    tokenUsed += resolved.tokenEstimate;
  }
  return { items, tokenUsed, omittedCount: 0 };
}

function materializeBudgetItem<T extends Record<string, unknown>>(
  entry: TokenBudgetEntry<T>,
  options: {
    remainingBudget: number;
    tokenBudget: number;
    estimateTokens?: (item: T) => number;
    previewItem?: (item: T, context: TokenBudgetPreviewContext) => T;
  },
): { item: T; tokenEstimate: number } | undefined {
  const fullEstimate = estimateEntryTokens(entry, options.estimateTokens);
  if (fullEstimate <= options.remainingBudget) {
    return { item: entry.item, tokenEstimate: fullEstimate };
  }
  if (options.previewItem === undefined) return undefined;
  const preview = options.previewItem(entry.item, {
    itemTokenEstimate: fullEstimate,
    remainingBudget: options.remainingBudget,
    tokenBudget: options.tokenBudget,
  });
  const previewEstimate = estimateTokenCount(preview);
  if (previewEstimate > options.remainingBudget) return undefined;
  return { item: preview, tokenEstimate: previewEstimate };
}

function estimateEntryTokens<T extends Record<string, unknown>>(
  entry: TokenBudgetEntry<T>,
  estimateTokens: ((item: T) => number) | undefined,
): number {
  const explicitEstimate = normalizeTokenEstimate(entry.tokenEstimate);
  if (explicitEstimate !== undefined) return explicitEstimate;
  const customEstimate = estimateTokens === undefined ? undefined : normalizeTokenEstimate(estimateTokens(entry.item));
  if (customEstimate !== undefined) return customEstimate;
  const embeddedEstimate = normalizeTokenEstimate(entry.item.token_estimate);
  return Math.max(embeddedEstimate ?? 0, estimateTokenCount(entry.item));
}

function normalizeTokenEstimate(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.ceil(value));
}

function positiveIntegerOrDefault(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function assertStableHandle(item: Record<string, unknown>, itemIdField: string): void {
  const value = item[itemIdField];
  if (typeof value === "string" && value.length > 0) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  throw new Error(`budget item is missing stable handle field "${itemIdField}"`);
}

function cloneSelectionPolicy(policy: TokenBudgetSelectionPolicy): TokenBudgetSelectionPolicy {
  const next: TokenBudgetSelectionPolicy = {
    id: policy.id,
    order: policy.order.map((order) => ({ field: order.field, direction: order.direction })),
  };
  if (policy.note !== undefined) next.note = policy.note;
  return next;
}

function cloneHowToExplore(items: readonly TokenBudgetHowToExplore[]): TokenBudgetHowToExplore[] {
  return items.map((item) => ({
    level: item.level,
    reason: item.reason,
    command: item.command,
  }));
}

function stringifyForTokenEstimate(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendCommandArgs(baseCommand: string, args: readonly string[]): string {
  return [baseCommand.trim(), ...args.filter((arg) => arg.length > 0)].join(" ");
}

function flagForNarrowScope(kind: BudgetNarrowScopeKind): string {
  switch (kind) {
    case "source":
      return "--source";
    case "heading":
      return "--heading";
    case "type":
      return "--type";
    case "node":
      return "--node";
  }
}

function defaultNarrowScopeReason(kind: BudgetNarrowScopeKind): string {
  switch (kind) {
    case "source":
      return "Narrow to one source and reuse the current token budget.";
    case "heading":
      return "Narrow to one heading and reuse the current token budget.";
    case "type":
      return "Narrow to one issue type and reuse the current token budget.";
    case "node":
      return "Narrow to one node and reuse the current token budget.";
  }
}

function defaultNarrowScopePlaceholder(kind: BudgetNarrowScopeKind, placeholder: string | undefined): string {
  if (placeholder !== undefined) return placeholder;
  switch (kind) {
    case "source":
      return "<source-id>";
    case "heading":
      return "'<heading-prefix>'";
    case "type":
      return "'<issue-type>'";
    case "node":
      return "<node-slug>";
  }
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/u.test(value)) return value;
  return `'${value.replace(/'/gu, "'\\''")}'`;
}
