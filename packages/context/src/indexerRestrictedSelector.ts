import { z } from "zod";

type SelectorScalar = string | number | boolean;

export type IndexerRestrictedSelectorExpression =
  | { op: "all"; args: IndexerRestrictedSelectorExpression[] }
  | { op: "any"; args: IndexerRestrictedSelectorExpression[] }
  | { op: "not"; arg: IndexerRestrictedSelectorExpression }
  | { op: "exists"; fact: string }
  | { op: "equals"; fact: string; value: SelectorScalar }
  | { op: "in"; fact: string; value: SelectorScalar[] }
  | { op: "prefix"; fact: string; value: string }
  | { op: "glob"; fact: string; value: string }
  | { op: "regex"; fact: string; value: string }
  | { op: "gte"; fact: string; value: number }
  | { op: "lte"; fact: string; value: number };

export const indexerSelectorFactPathSchema = z.string().regex(
  /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u,
);
const scalarSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

const expressionSchema: z.ZodType<IndexerRestrictedSelectorExpression> = z.lazy(() =>
  z.union([
    z.object({
      op: z.enum(["all", "any"]),
      args: z.array(expressionSchema).min(1),
    }).strict(),
    z.object({ op: z.literal("not"), arg: expressionSchema }).strict(),
    z.object({ op: z.literal("exists"), fact: indexerSelectorFactPathSchema }).strict(),
    z.object({
      op: z.literal("equals"),
      fact: indexerSelectorFactPathSchema,
      value: scalarSchema,
    }).strict(),
    z.object({
      op: z.literal("in"),
      fact: indexerSelectorFactPathSchema,
      value: z.array(scalarSchema).min(1),
    }).strict(),
    z.object({
      op: z.enum(["prefix", "glob"]),
      fact: indexerSelectorFactPathSchema,
      value: z.string(),
    }).strict(),
    z.object({
      op: z.literal("regex"),
      fact: indexerSelectorFactPathSchema,
      value: z.string().max(256),
    }).strict(),
    z.object({
      op: z.enum(["gte", "lte"]),
      fact: indexerSelectorFactPathSchema,
      value: z.number().finite(),
    }).strict(),
  ])
);

export const indexerRestrictedSelectorSchema = z.object({
  protocol: z.literal("context.indexer.selector/v1"),
  expression: expressionSchema,
}).strict();

export type IndexerRestrictedSelector = z.infer<
  typeof indexerRestrictedSelectorSchema
>;

function collectFacts(
  expression: IndexerRestrictedSelectorExpression,
  output: Set<string>,
): void {
  if (expression.op === "all" || expression.op === "any") {
    expression.args.forEach((item) => collectFacts(item, output));
  } else if (expression.op === "not") {
    collectFacts(expression.arg, output);
  } else {
    output.add(expression.fact);
  }
}

export function validateIndexerRestrictedSelector(
  value: unknown,
  allowedFactPaths: ReadonlySet<string>,
): IndexerRestrictedSelector {
  const selector = indexerRestrictedSelectorSchema.parse(value);
  const facts = new Set<string>();
  collectFacts(selector.expression, facts);
  const unauthorized = [...facts].find((fact) => !allowedFactPaths.has(fact));
  if (unauthorized !== undefined) {
    throw new TypeError(`restricted selector references unauthorized fact ${unauthorized}`);
  }
  return selector;
}

function readFact(facts: Record<string, unknown>, path: string): unknown {
  let value: unknown = facts;
  for (const segment of path.split(".")) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function globPattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*")
    .replaceAll("?", "[^/]");
  return new RegExp(`^${escaped}$`, "u");
}

function evaluateExpression(
  expression: IndexerRestrictedSelectorExpression,
  facts: Record<string, unknown>,
): boolean {
  if (expression.op === "all") {
    return expression.args.every((item) => evaluateExpression(item, facts));
  }
  if (expression.op === "any") {
    return expression.args.some((item) => evaluateExpression(item, facts));
  }
  if (expression.op === "not") return !evaluateExpression(expression.arg, facts);
  const fact = readFact(facts, expression.fact);
  if (expression.op === "exists") return fact !== undefined;
  if (expression.op === "equals") return fact === expression.value;
  if (expression.op === "in") return expression.value.some((value) => value === fact);
  if (expression.op === "prefix") {
    return typeof fact === "string" && fact.startsWith(expression.value);
  }
  if (expression.op === "glob") {
    return typeof fact === "string" && globPattern(expression.value).test(fact);
  }
  if (expression.op === "regex") {
    try {
      return typeof fact === "string" && new RegExp(expression.value, "u").test(fact);
    } catch {
      throw new TypeError("restricted selector contains an invalid regular expression");
    }
  }
  if (typeof fact !== "number") return false;
  return expression.op === "gte" ? fact >= expression.value : fact <= expression.value;
}

export function evaluateIndexerRestrictedSelector(input: {
  selector: unknown;
  facts: Record<string, unknown>;
  allowed_fact_paths: ReadonlySet<string>;
}): boolean {
  const selector = validateIndexerRestrictedSelector(
    input.selector,
    input.allowed_fact_paths,
  );
  return evaluateExpression(selector.expression, input.facts);
}

export const INDEXER_SELECTOR_OPERATORS = [
  "all",
  "any",
  "not",
  "equals",
  "in",
  "exists",
  "prefix",
  "glob",
  "regex",
  "gte",
  "lte",
] as const;
