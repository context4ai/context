import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IndexerProviderManifest } from "@c4a/context";
import {
  analyzeDocumentEditorialSignals,
  DOCUMENT_EDITORIAL_SIGNAL_CODES,
  type DocumentEditorialSignalCode,
} from "./documentEditorialSignals.js";
import { sensitiveSourceLiteralCandidates } from "./sensitiveSourceLiteral.js";

const SIGNAL_CONFIDENCES = ["high", "review"] as const;
const RECOMMENDED_ACTIONS = ["repair", "reshape", "omit", "request-input"] as const;
const SELECTED_OUTCOMES = ["keep", ...RECOMMENDED_ACTIONS] as const;
const DETECTION_SCOPES = ["section", "cross-section", "safety-baseline"] as const;

interface EditorialExpectedSignal {
  code: DocumentEditorialSignalCode;
  confidence: typeof SIGNAL_CONFIDENCES[number];
  recommended_action: typeof RECOMMENDED_ACTIONS[number];
  omission_reason: string | null;
}

interface EditorialFixtureCase {
  id: string;
  profile: string;
  detection_scope: typeof DETECTION_SCOPES[number];
  source_markdown: string;
  expected_signal: EditorialExpectedSignal | null;
  selected_outcome: typeof SELECTED_OUTCOMES[number];
  assessment: string | null;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}

function nonEmptyId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(value)) {
    throw new TypeError(`${label} must be a stable lower-case id`);
  }
  return value;
}

function nonEmptyText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be non-empty text`);
  }
  return value;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`${label} must be one of ${allowed.join(", ")}`);
  }
  return value as T[number];
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  return nonEmptyText(value, label);
}

function parseExpectedSignal(value: unknown): EditorialExpectedSignal | null {
  if (value === null) return null;
  const signal = record(value, "Markdown editorial expected signal");
  exactKeys(signal, [
    "code",
    "confidence",
    "recommended_action",
    "omission_reason",
  ], "Markdown editorial expected signal");
  return {
    code: enumValue(signal.code, DOCUMENT_EDITORIAL_SIGNAL_CODES, "editorial signal code"),
    confidence: enumValue(signal.confidence, SIGNAL_CONFIDENCES, "editorial confidence"),
    recommended_action: enumValue(
      signal.recommended_action,
      RECOMMENDED_ACTIONS,
      "editorial recommended action",
    ),
    omission_reason: signal.omission_reason === null
      ? null
      : nonEmptyId(signal.omission_reason, "editorial omission reason"),
  };
}

function parseFixtureCase(value: unknown): EditorialFixtureCase {
  const fixture = record(value, "Markdown editorial fixture case");
  exactKeys(fixture, [
    "id",
    "profile",
    "detection_scope",
    "source_markdown",
    "expected_signal",
    "selected_outcome",
    "assessment",
  ], "Markdown editorial fixture case");
  const parsed: EditorialFixtureCase = {
    id: nonEmptyId(fixture.id, "editorial fixture id"),
    profile: nonEmptyId(fixture.profile, "editorial fixture profile"),
    detection_scope: enumValue(
      fixture.detection_scope,
      DETECTION_SCOPES,
      "editorial detection scope",
    ),
    source_markdown: nonEmptyText(fixture.source_markdown, "editorial source markdown"),
    expected_signal: parseExpectedSignal(fixture.expected_signal),
    selected_outcome: enumValue(
      fixture.selected_outcome,
      SELECTED_OUTCOMES,
      "editorial selected outcome",
    ),
    assessment: nullableText(fixture.assessment, "editorial assessment"),
  };
  validateFixtureDecision(parsed);
  return parsed;
}

function validateFixtureDecision(fixture: EditorialFixtureCase): void {
  const signal = fixture.expected_signal;
  if (sensitiveSourceLiteralCandidates(fixture.source_markdown).length > 0) {
    throw new TypeError(`editorial fixture ${fixture.id} must not reproduce a sensitive literal`);
  }
  if (signal === null) {
    if (
      fixture.selected_outcome !== "keep"
      || fixture.assessment !== null
      || fixture.detection_scope !== "section"
    ) {
      throw new TypeError("a no-signal editorial fixture must be a plain Section keep");
    }
    if (analyzeDocumentEditorialSignals(fixture.source_markdown).length > 0) {
      throw new TypeError(`no-signal editorial fixture ${fixture.id} produced a runtime signal`);
    }
    return;
  }
  if (fixture.selected_outcome === "keep") {
    if (
      signal.confidence !== "review"
      || fixture.assessment === null
      || !fixture.assessment.includes(signal.code)
      || !/(?:false-positive|source fidelity)/iu.test(fixture.assessment)
    ) {
      throw new TypeError("a signaled keep requires one Section-specific review assessment");
    }
    if (/(?:time|cost|effort|workload|batch size|deadline|progress)/iu.test(fixture.assessment)) {
      throw new TypeError("an editorial assessment cannot use delivery effort as quality evidence");
    }
  } else {
    if (fixture.selected_outcome !== signal.recommended_action || fixture.assessment !== null) {
      throw new TypeError("an editorial fixture outcome must follow its signal or justify a review keep");
    }
    if (fixture.selected_outcome === "omit" && signal.omission_reason === null) {
      throw new TypeError("an editorial omission fixture requires an exact omission reason");
    }
  }
  validateRuntimeSignal(fixture, signal);
}

function validateRuntimeSignal(
  fixture: EditorialFixtureCase,
  expected: EditorialExpectedSignal,
): void {
  if (fixture.detection_scope === "cross-section") {
    if (expected.code !== "duplicate-fragment") {
      throw new TypeError("only duplicate-fragment may use cross-section fixture detection");
    }
    return;
  }
  if (fixture.detection_scope === "safety-baseline") {
    if (expected.code !== "sensitive-value-candidate") {
      throw new TypeError("only a redacted sensitive-value fixture may use safety-baseline detection");
    }
    return;
  }
  const actual = analyzeDocumentEditorialSignals(fixture.source_markdown)
    .find((signal) => signal.code === expected.code);
  if (
    actual === undefined
    || actual.confidence !== expected.confidence
    || actual.recommended_action !== expected.recommended_action
    || (actual.omission_reason ?? null) !== expected.omission_reason
  ) {
    throw new TypeError(`editorial fixture ${fixture.id} drifted from runtime signal ${expected.code}`);
  }
}

function assertExactCoverage(
  actual: ReadonlySet<string>,
  expected: readonly string[],
  label: string,
): void {
  if (actual.size !== expected.length || expected.some((value) => !actual.has(value))) {
    throw new TypeError(`${label} must cover ${expected.join(", ")}`);
  }
}

async function validateEditorialInstruction(input: {
  source: string;
  expectedProfiles: readonly string[];
  manifest: IndexerProviderManifest;
}): Promise<string> {
  const path = "references/editorial-policy.md";
  const instruction = input.manifest.provider.instructions?.find((item) => item.path === path);
  if (
    instruction === undefined
    || instruction.profiles.length !== input.expectedProfiles.length
    || instruction.profiles.some((profile, index) => profile !== input.expectedProfiles[index])
  ) {
    throw new TypeError(`${path} must cover every Markdown profile in canonical order`);
  }
  const content = await readFile(join(input.source, path), "utf8");
  for (const code of DOCUMENT_EDITORIAL_SIGNAL_CODES) {
    if (!content.includes(`\`${code}\``)) {
      throw new TypeError(`Markdown editorial guidance misses signal ${code}`);
    }
  }
  for (const anchor of [
    ...SELECTED_OUTCOMES,
    "Section-specific",
    "false positive",
    "source fidelity",
  ]) {
    if (!content.includes(anchor)) {
      throw new TypeError(`Markdown editorial guidance misses policy anchor ${anchor}`);
    }
  }
  if (/\b(?:collection|output_path|knowledge)\s*:/u.test(content)) {
    throw new TypeError("Markdown editorial guidance must not declare storage authority");
  }
  return content;
}

export async function validateBundledIndexerMarkdownEditorialFixtures(input: {
  source: string;
  expectedProfiles: readonly string[];
  manifest: IndexerProviderManifest;
}): Promise<void> {
  const guidance = await validateEditorialInstruction(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(
      join(input.source, "tests", "fixtures", "editorial.json"),
      "utf8",
    )) as unknown;
  } catch {
    throw new TypeError("context-markdown-indexer editorial fixture catalog is invalid JSON");
  }
  const root = record(parsed, "Markdown editorial fixture set");
  exactKeys(root, ["protocol", "anonymized", "cases"], "Markdown editorial fixture set");
  if (
    root.protocol !== "context.indexer.markdown-editorial-fixture-set/v1"
    || root.anonymized !== true
    || !Array.isArray(root.cases)
    || root.cases.length === 0
  ) {
    throw new TypeError("Markdown editorial fixture protocol, anonymity, or cases are invalid");
  }
  const cases = root.cases.map(parseFixtureCase);
  if (new Set(cases.map((fixture) => fixture.id)).size !== cases.length) {
    throw new TypeError("Markdown editorial fixture ids must be unique");
  }
  assertExactCoverage(
    new Set(cases.map((fixture) => fixture.profile)),
    input.expectedProfiles,
    "Markdown editorial profile fixtures",
  );
  assertExactCoverage(
    new Set(cases.flatMap((fixture) =>
      fixture.expected_signal === null ? [] : [fixture.expected_signal.code]
    )),
    DOCUMENT_EDITORIAL_SIGNAL_CODES,
    "Markdown editorial signal fixtures",
  );
  assertExactCoverage(
    new Set(cases.map((fixture) => fixture.selected_outcome)),
    SELECTED_OUTCOMES,
    "Markdown editorial outcome fixtures",
  );
  if (!cases.some((fixture) =>
    fixture.selected_outcome === "keep" && fixture.expected_signal !== null
    && fixture.assessment?.includes("false-positive")
  ) || !cases.some((fixture) =>
    fixture.selected_outcome === "keep" && fixture.expected_signal !== null
    && fixture.assessment?.includes("source fidelity")
  )) {
    throw new TypeError("Markdown editorial fixtures must cover both valid assessment bases");
  }
  for (const fixture of cases) {
    if (fixture.expected_signal !== null && !guidance.includes(`\`${fixture.expected_signal.code}\``)) {
      throw new TypeError(`editorial fixture ${fixture.id} has no guidance entry`);
    }
  }
}
