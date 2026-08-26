import type { CodeIndexOutputProfile } from "@c4a/context";
import type { ExtractionIndexUnitPreview } from "./extractCandidateTypes.js";
import type {
  CodeIndexAuditDimension,
  CodeIndexAuditDimensionStatus,
  CodeIndexAuditPageMetrics,
} from "./codeIndexAuditTypes.js";

const TEMPLATE_PATTERN = /\b(?:describe|document|explain|list|summarize)\s+(?:the|this|each|relevant)\b|(?:在此|这里)(?:描述|说明|列出|补充)/iu;

function isPlaceholderMarker(line: string): boolean {
  const value = line
    .replace(/^#{1,6}\s+/u, "")
    .replace(/^(?:[-*+] |\d+[.)] )/u, "")
    .trim();
  return /^(?:todo|tbd|fixme)(?:\s*[:：-]\s*.+)?$/iu.test(value) ||
    /^(?:placeholder|coming soon|to be (?:added|defined|documented)|待补充|待完善|占位)[.!。！?？…]*$/iu.test(value);
}

export interface MarkdownQualityMetrics {
  lineCount: number;
  semanticFactLines: number;
  tableFactRows: number;
  explanatoryLines: number;
  implementationBodyLines: number;
  signatureDumpLines: number;
  generatedTypeLines: number;
  templateResidueCount: number;
  placeholderSectionCount: number;
}

export function codeIndexReaderMarkdown(markdown: string): string {
  return markdown
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/u, "")
    .replace(/^[\t ]*<!--\s*\/?context:[\s\S]*?-->[\t ]*(?:\r?\n|$)/gimu, "")
    .replace(/<!--\s*\/?context:[\s\S]*?-->/giu, "");
}

function containsModuleSpecificIdentity(line: string): boolean {
  return /`[^`]+`|\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\b|\b[A-Za-z_$][\w$]{3,}\b|\/[A-Za-z0-9_./:{}-]+/u.test(line);
}

function isGeneratedMarker(line: string): boolean {
  return /(?:code generated|generated (?:code|file|type|source)|do not edit|auto[- ]generated|@generated|由.+自动生成|自动生成.*勿改)/iu.test(line);
}

function isDeclarationLike(line: string): boolean {
  const value = line.replace(/^\s*(?:[-*+] |\d+[.)] )/u, "").trim();
  if (value.length === 0 || /^`.*`$/u.test(value)) return false;
  return /^(?:(?:export|declare|default|abstract|public|private|protected|internal|static|final|readonly|override|async|sealed|open)\s+)*(?:class|interface|enum|namespace|type|function|const|let|var|record|struct|trait|impl|fn|def)\s+[A-Za-z_$][\w$]*/u.test(value) ||
    /^func\s+(?:\([^)]*\)\s*)?[A-Za-z_$][\w$]*\s*\(/u.test(value) ||
    /^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type|fn|const|static)\s+[A-Za-z_$][\w$]*/u.test(value) ||
    /^(?:(?:public|private|protected|internal|static|final|abstract|virtual|override|async)\s+)+[\w$.<>,?\[\] ]+\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(?:\{|;|=>)?$/u.test(value) ||
    /^(?:[A-Za-z_$][\w$]*\??\s*:\s*[^.!?]+[;,]?|[A-Za-z_$][\w$]*\s+[A-Za-z_$][\w$]*\s*(?:`[^`]+`)?\s*[,;]?)$/u.test(value) ||
    /^[{}()[\],;]+$/u.test(value);
}

function declarationDumpLines(lines: readonly string[]): { signature: Set<number>; generated: Set<number> } {
  const signature = new Set<number>();
  const generated = new Set<number>();
  const generatedDocument = lines.some((line) => isGeneratedMarker(line));
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    const length = end - start;
    if (length >= 3 || generatedDocument) {
      for (let index = start; index < end; index += 1) {
        if (!isDeclarationLike(lines[index] ?? "")) continue;
        (generatedDocument ? generated : signature).add(index);
      }
    }
    start = -1;
  };
  lines.forEach((line, index) => {
    if (isDeclarationLike(line)) {
      if (start < 0) start = index;
      return;
    }
    if (line.trim().length === 0 && start >= 0) return;
    flush(index);
  });
  flush(lines.length);
  return { signature, generated };
}

export function measureCodeIndexMarkdown(markdown: string): MarkdownQualityMetrics {
  const lines = codeIndexReaderMarkdown(markdown).replace(/\r\n/gu, "\n").trimEnd().split("\n");
  const dumps = declarationDumpLines(lines);
  let fenced = false;
  let implementationBodyLines = 0;
  let signatureDumpLines = 0;
  let generatedTypeLines = 0;
  let semanticFactLines = 0;
  let tableFactRows = 0;
  let explanatoryLines = 0;
  let templateResidueCount = 0;
  let placeholderSectionCount = 0;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    if (/^```/u.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      if (line.length > 0) implementationBodyLines += 1;
      continue;
    }
    if (isGeneratedMarker(line)) {
      implementationBodyLines += 1;
      generatedTypeLines += 1;
      continue;
    }
    if (dumps.signature.has(index) || dumps.generated.has(index)) {
      implementationBodyLines += 1;
      signatureDumpLines += Number(dumps.signature.has(index));
      generatedTypeLines += Number(dumps.generated.has(index));
      continue;
    }
    if (line.length === 0 || /^<!--\s*context:/u.test(line)) continue;
    if (isPlaceholderMarker(line)) placeholderSectionCount += 1;
    if (/^#{1,6}\s/u.test(line)) continue;
    if (TEMPLATE_PATTERN.test(line)) templateResidueCount += 1;
    if (/^\|.*\|$/u.test(line)) {
      if (!/^\|?(?:\s*:?-+:?\s*\|)+\s*$/u.test(line)) {
        tableFactRows += 1;
        semanticFactLines += 1;
      }
      continue;
    }
    if (/^(?:[-*+] |\d+[.)] )/u.test(line) || containsModuleSpecificIdentity(line)) {
      semanticFactLines += 1;
    }
    if (!/^(?:[-*+] |\d+[.)] )/u.test(line) && containsModuleSpecificIdentity(line) && line.length >= 24) {
      explanatoryLines += 1;
    }
  }
  return {
    lineCount: lines.length,
    semanticFactLines,
    tableFactRows,
    explanatoryLines,
    implementationBodyLines,
    signatureDumpLines,
    generatedTypeLines,
    templateResidueCount,
    placeholderSectionCount,
  };
}

interface Threshold {
  floor: number | null;
  target: number | null;
  ceiling: number | null;
}

function coverageThreshold(floor: number, target: number): Threshold {
  return { floor, target, ceiling: 100 };
}

function targetSymbolThreshold(profile: CodeIndexOutputProfile): Threshold {
  switch (profile) {
    case "module-map": return coverageThreshold(20, 35);
    case "application-map": return coverageThreshold(30, 50);
    case "runtime-map":
    case "service-boundary": return coverageThreshold(50, 70);
    case "protocol-index": return coverageThreshold(70, 85);
    case "public-api-reference": return coverageThreshold(80, 90);
    case "adapter-contract":
    case "command-map": return coverageThreshold(70, 85);
    case "module-registry":
    case "cross-module-flow": return coverageThreshold(100, 100);
    default: return { floor: null, target: null, ceiling: null };
  }
}

function factDensityThreshold(profile: CodeIndexOutputProfile): Threshold {
  switch (profile) {
    case "module-map":
    case "application-map": return { floor: 0.3, target: 0.6, ceiling: 1.2 };
    case "runtime-map": return { floor: 0.3, target: 0.8, ceiling: 1.5 };
    case "service-boundary": return { floor: 0.2, target: 0.5, ceiling: 1 };
    case "public-api-reference": return { floor: 8, target: 14, ceiling: 20 };
    case "adapter-contract":
    case "command-map": return { floor: 0.5, target: 1, ceiling: 2 };
    default: return { floor: null, target: null, ceiling: null };
  }
}

const MIN_DENSITY_DENOMINATOR_LOC = 500;
const SECTION_SCOPED_PROFILES = new Set<CodeIndexOutputProfile>([
  "protocol-index",
  "service-boundary",
  "runtime-map",
  "module-map",
  "application-map",
  "adapter-contract",
  "command-map",
  "module-registry",
  "cross-module-flow",
]);

function explanatoryThreshold(profile: CodeIndexOutputProfile, eligibleLoc: number): Threshold {
  const base = profile === "cross-module-flow"
    ? { floor: 12, target: 20, ceiling: 40 }
    : { floor: 8, target: 12, ceiling: profile === "module-map" || profile === "application-map" || profile === "runtime-map" ? 24 : 20 };
  const density = factDensityThreshold(profile);
  if (density.ceiling === null || eligibleLoc <= 0) return base;
  const feasible = Math.max(1, Math.ceil(eligibleLoc * density.ceiling / 100));
  return {
    floor: Math.min(base.floor, feasible),
    target: base.target === null ? null : Math.min(base.target, feasible),
    ceiling: base.ceiling,
  };
}

function factLineThreshold(eligibleLoc: number, profile: CodeIndexOutputProfile): Threshold {
  const base = eligibleLoc <= 5_000
    ? { floor: 25, target: 40 }
    : eligibleLoc <= 30_000
      ? { floor: 40, target: 80 }
      : { floor: 100, target: null };
  const density = factDensityThreshold(profile);
  if (density.ceiling === null) return { ...base, ceiling: null };
  const feasibleFloor = Math.max(1, Math.ceil(eligibleLoc * density.ceiling / 100));
  const feasibleTarget = density.target === null
    ? null
    : Math.max(feasibleFloor, Math.ceil(eligibleLoc * density.target / 100));
  return {
    floor: Math.min(base.floor, feasibleFloor),
    target: base.target === null || feasibleTarget === null ? base.target : Math.min(base.target, feasibleTarget),
    ceiling: null,
  };
}

function dimensionStatus(observed: number, threshold: Threshold): CodeIndexAuditDimensionStatus {
  if (threshold.floor !== null && observed < threshold.floor) return "below-floor";
  if (threshold.ceiling !== null && observed > threshold.ceiling) return "above-ceiling";
  if (threshold.target !== null && observed < threshold.target) return "below-target";
  if (threshold.target !== null && observed > threshold.target) return "above-target";
  return "target";
}

function score(observed: number, threshold: Threshold, status: CodeIndexAuditDimensionStatus): number | null {
  if (threshold.target === null) return status === "target" ? 100 : 0;
  if (status === "target" || status === "above-target") return 100;
  if (status === "below-floor") {
    if (threshold.floor === null || threshold.floor === 0) return 0;
    return Math.max(0, Math.round(observed / threshold.floor * 59));
  }
  if (status === "below-target" && threshold.floor !== null) {
    return Math.round(60 + (observed - threshold.floor) / Math.max(0.0001, threshold.target - threshold.floor) * 40);
  }
  if (status === "above-ceiling" && threshold.ceiling !== null) {
    return Math.max(0, Math.round(59 * threshold.ceiling / Math.max(observed, threshold.ceiling)));
  }
  return 100;
}

function evaluated(input: {
  dimension: string;
  observed: number;
  unit: CodeIndexAuditDimension["unit"];
  threshold: Threshold;
  evidence: CodeIndexAuditDimension["evidence"];
  actions: string[];
}): CodeIndexAuditDimension {
  const status = dimensionStatus(input.observed, input.threshold);
  return {
    dimension: input.dimension,
    observed: Number(input.observed.toFixed(3)),
    unit: input.unit,
    ...input.threshold,
    score: score(input.observed, input.threshold, status),
    status,
    absolute_gate: status === "below-floor" || status === "above-ceiling",
    evidence: input.evidence,
    recommended_actions: input.actions,
  };
}

function unscorable(dimension: string, unit: CodeIndexAuditDimension["unit"], action: string): CodeIndexAuditDimension {
  return {
    dimension,
    observed: null,
    unit,
    floor: null,
    target: null,
    ceiling: null,
    score: null,
    status: "unscorable",
    absolute_gate: true,
    evidence: { reason: "reliable inventory denominator is unavailable" },
    recommended_actions: [action],
  };
}

function normalizeIdentity(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "").trim().toLowerCase();
}

function coveredIdentities(targets: readonly string[], references: readonly string[]): string[] {
  const normalizedReferences = references.map(normalizeIdentity);
  return targets.filter((target) => {
    const normalizedTarget = normalizeIdentity(target);
    return normalizedReferences.some((reference) =>
      reference === normalizedTarget || reference.endsWith(`/${normalizedTarget}`) ||
      normalizedTarget.endsWith(`/${reference}`)
    );
  });
}

function coverageDimension(input: {
  dimension: string;
  targets: readonly string[];
  references: readonly string[];
  floor: number;
  target: number;
  actions: string[];
}): CodeIndexAuditDimension {
  const covered = coveredIdentities(input.targets, input.references);
  const uncovered = input.targets.filter((identity) => !covered.includes(identity));
  return evaluated({
    dimension: input.dimension,
    observed: input.targets.length === 0 ? 100 : covered.length / input.targets.length * 100,
    unit: "percent",
    threshold: coverageThreshold(input.floor, input.target),
    evidence: {
      eligible: input.targets.length,
      covered: covered.length,
      uncovered: uncovered.length,
      uncovered_identities: uncovered,
    },
    actions: input.actions,
  });
}

function upperBound(input: {
  dimension: string;
  observed: number;
  unit: CodeIndexAuditDimension["unit"];
  target: number;
  ceiling: number;
  absoluteGate?: boolean;
  evidence: CodeIndexAuditDimension["evidence"];
  actions: string[];
}): CodeIndexAuditDimension {
  const status: CodeIndexAuditDimensionStatus = input.observed > input.ceiling
    ? "above-ceiling"
    : input.observed > input.target
      ? "above-target"
      : "target";
  return {
    dimension: input.dimension,
    observed: Number(input.observed.toFixed(3)),
    unit: input.unit,
    floor: null,
    target: input.target,
    ceiling: input.ceiling,
    score: status === "target" ? 100 : status === "above-target"
      ? Math.max(60, Math.round(100 - (input.observed - input.target) / Math.max(1, input.ceiling - input.target) * 40))
      : Math.max(0, Math.round(59 * input.ceiling / Math.max(input.observed, input.ceiling))),
    status,
    absolute_gate: status === "above-ceiling" && input.absoluteGate !== false,
    evidence: input.evidence,
    recommended_actions: input.actions,
  };
}

export function auditDimensions(input: {
  unit: ExtractionIndexUnitPreview;
  pages: readonly CodeIndexAuditPageMetrics[];
}): CodeIndexAuditDimension[] {
  const inventory = input.unit.inventory;
  const facts = input.pages.reduce((sum, page) => sum + page.semantic_fact_lines, 0);
  const explanatory = input.pages.reduce((sum, page) => sum + page.explanatory_lines, 0);
  const maxPageLines = Math.max(0, ...input.pages.map((page) => page.line_count));
  const implementation = input.pages.reduce((sum, page) => sum + page.implementation_body_lines, 0);
  const visibleLines = Math.max(1, input.pages.reduce((sum, page) => sum + page.semantic_fact_lines + page.explanatory_lines + page.implementation_body_lines, 0));
  const dimensions: CodeIndexAuditDimension[] = [];
  if (inventory.basis === "ast" && inventory.eligibleFiles > 0) {
    dimensions.push(evaluated({
      dimension: "eligible-file-analysis",
      observed: inventory.analyzedFiles / inventory.eligibleFiles * 100,
      unit: "percent",
      threshold: coverageThreshold(90, 95),
      evidence: {
        eligible: inventory.eligibleFiles,
        analyzed: inventory.analyzedFiles,
        excluded: inventory.excludedFiles,
        parser_skipped: inventory.parserSkippedFiles,
        eligible_file_identities: inventory.eligibleFileTargets,
        analyzed_file_identities: inventory.analyzedFileTargets,
        excluded_file_identities: inventory.excludedFileTargets,
        parser_skipped_file_identities: inventory.parserSkippedFileTargets,
        exclusion_reasons: inventory.excludedReasons,
      },
      actions: ["expand-input-scope", "correct-exclusions", "add-entry-probes"],
    }));
  } else dimensions.push(unscorable("eligible-file-analysis", "percent", "return-complete-source-inventory"));
  if (inventory.basis === "ast" && inventory.eligibleLoc > 0) {
    dimensions.push(evaluated({
      dimension: "eligible-loc-analysis",
      observed: inventory.analyzedLoc / inventory.eligibleLoc * 100,
      unit: "percent",
      threshold: coverageThreshold(80, 90),
      evidence: { eligible_loc: inventory.eligibleLoc, analyzed_loc: inventory.analyzedLoc },
      actions: ["expand-input-scope", "correct-exclusions", "inspect-authoritative-entry"],
    }));
    const densityThreshold = factDensityThreshold(input.unit.outputProfile);
    if (densityThreshold.floor === null || inventory.eligibleLoc < MIN_DENSITY_DENOMINATOR_LOC) {
      dimensions.push({
        dimension: "semantic-fact-density",
        observed: null,
        unit: "percent",
        floor: null,
        target: null,
        ceiling: null,
        score: null,
        status: "not-applicable",
        absolute_gate: false,
        evidence: {
          profile: input.unit.outputProfile,
          eligible_loc: inventory.eligibleLoc,
          reason: densityThreshold.floor === null
            ? "profile has no density contract"
            : `scope is smaller than ${MIN_DENSITY_DENOMINATOR_LOC} eligible LOC; absolute fact lines are authoritative`,
        },
        recommended_actions: [],
      });
    } else {
      const density = facts / inventory.eligibleLoc * 100;
      dimensions.push(evaluated({
        dimension: "semantic-fact-density",
        observed: density,
        unit: "percent",
        threshold: densityThreshold,
        evidence: { semantic_fact_lines: facts, eligible_loc: inventory.eligibleLoc },
        actions: density < densityThreshold.floor ? ["add-module-explanation", "cover-missing-exports", "cover-missing-routes"] : ["aggregate-symbol-pages", "reduce-implementation-body"],
      }));
    }
    dimensions.push(evaluated({
      dimension: "semantic-fact-lines",
      observed: facts,
      unit: "lines",
      threshold: factLineThreshold(inventory.eligibleLoc, input.unit.outputProfile),
      evidence: { eligible_loc: inventory.eligibleLoc },
      actions: ["add-module-explanation", "cover-missing-exports", "connect-operation-handler"],
    }));
  } else {
    dimensions.push(unscorable("eligible-loc-analysis", "percent", "return-complete-source-inventory"));
    dimensions.push(unscorable("semantic-fact-density", "percent", "return-complete-source-inventory"));
    dimensions.push(unscorable("semantic-fact-lines", "lines", "return-complete-source-inventory"));
  }
  if (inventory.basis === "ast" && inventory.targetSymbols > 0) {
    const referencedSymbols = new Set(input.pages.flatMap((page) => page.referenced_symbols));
    const coveredTargets = inventory.targetSymbolIdentities.length > 0
      ? coveredIdentities(inventory.targetSymbolIdentities, [...referencedSymbols])
      : [...referencedSymbols];
    const uncoveredTargets = inventory.targetSymbolIdentities.filter((identity) => !coveredTargets.includes(identity));
    dimensions.push(evaluated({
      dimension: "target-symbol-coverage",
      observed: Math.min(100, coveredTargets.length / inventory.targetSymbols * 100),
      unit: "percent",
      threshold: targetSymbolThreshold(input.unit.outputProfile),
      evidence: {
        discovered: inventory.symbolsDiscovered,
        target: inventory.targetSymbols,
        referenced: coveredTargets.length,
        exported: inventory.exportedSymbols,
        uncovered_identities: uncoveredTargets,
      },
      actions: ["cover-missing-exports", "cover-missing-routes", "connect-operation-handler"],
    }));
  } else dimensions.push(unscorable("target-symbol-coverage", "percent", "return-target-symbol-inventory"));
  const referencedFiles = [...new Set(input.pages.flatMap((page) => page.referenced_files))];
  const referencedSymbols = [...new Set(input.pages.flatMap((page) => page.referenced_symbols))];
  const referencedDocumentTargets = coveredIdentities(inventory.documentTargets, [
    ...inventory.referencedDocumentTargets,
    ...referencedFiles,
  ]);
  if (inventory.rootDocumentTargets.length > 0) {
    dimensions.push(coverageDimension({
      dimension: "root-document-read-coverage",
      targets: inventory.rootDocumentTargets,
      references: inventory.readDocumentTargets,
      floor: 100,
      target: 100,
      actions: ["inspect-authoritative-entry"],
    }));
  }
  const rootDocuments = new Set(inventory.rootDocumentTargets);
  const relatedDocuments = inventory.documentTargets.filter((identity) => !rootDocuments.has(identity));
  if (relatedDocuments.length > 0) {
    const dimension = coverageDimension({
      dimension: "related-document-read-coverage",
      targets: relatedDocuments,
      references: inventory.readDocumentTargets,
      floor: 60,
      target: 80,
      actions: ["inspect-authoritative-entry"],
    });
    dimension.evidence.referenced = referencedDocumentTargets.length;
    dimensions.push(dimension);
  } else if (inventory.documentTargets.length === 0 && inventory.documentsDiscovered > 0) {
    dimensions.push(evaluated({
      dimension: "related-document-read-coverage",
      observed: inventory.documentsRead / inventory.documentsDiscovered * 100,
      unit: "percent",
      threshold: coverageThreshold(60, 80),
      evidence: {
        discovered: inventory.documentsDiscovered,
        read: inventory.documentsRead,
        identity_inventory: "unavailable",
      },
      actions: ["inspect-authoritative-entry"],
    }));
  }
  if (inventory.entryTargets.length > 0) {
    dimensions.push(coverageDimension({
      dimension: "stable-entry-coverage",
      targets: inventory.entryTargets,
      references: [
        ...referencedFiles,
        ...inventory.coveredBoundaryTargets.filter((target) => target.kind === "entry").map((target) => target.identity),
      ],
      floor: 85,
      target: 95,
      actions: ["add-entry-probes", "inspect-authoritative-entry"],
    }));
  }
  if (inventory.exportedTargetIdentities.length > 0) {
    dimensions.push(coverageDimension({
      dimension: "public-export-identity-coverage",
      targets: inventory.exportedTargetIdentities,
      references: referencedSymbols,
      floor: 100,
      target: 100,
      actions: ["cover-missing-exports"],
    }));
  }
  const boundaryThresholds: Partial<Record<ExtractionIndexUnitPreview["inventory"]["boundaryTargets"][number]["kind"], [number, number, string]>> = {
    route: [85, 95, "cover-missing-routes"],
    operation: [85, 95, "connect-operation-handler"],
    handler: [75, 85, "connect-operation-handler"],
    downstream: [60, 75, "connect-handler-downstream"],
    command: [85, 95, "cover-missing-commands"],
    event: [85, 95, "cover-missing-events"],
    plugin: [85, 95, "cover-missing-plugin-entries"],
    handoff: [100, 100, "connect-adjacent-handoffs"],
  };
  for (const kind of [...new Set(inventory.boundaryTargets.map((target) => target.kind))]) {
    const threshold = boundaryThresholds[kind];
    if (threshold === undefined) continue;
    dimensions.push(coverageDimension({
      dimension: `${kind}-coverage`,
      targets: inventory.boundaryTargets.filter((target) => target.kind === kind).map((target) => target.identity),
      references: [
        ...referencedFiles,
        ...referencedSymbols,
        ...inventory.coveredBoundaryTargets.filter((target) => target.kind === kind).map((target) => target.identity),
      ],
      floor: threshold[0],
      target: threshold[1],
      actions: [threshold[2]],
    }));
  }
  dimensions.push(evaluated({
    dimension: "explanatory-lines",
    observed: explanatory,
    unit: "lines",
    threshold: explanatoryThreshold(input.unit.outputProfile, inventory.eligibleLoc),
    evidence: { explanatory_lines: explanatory },
    actions: ["add-module-explanation"],
  }));
  dimensions.push(upperBound({
    dimension: "max-page-lines",
    observed: maxPageLines,
    unit: "lines",
    target: 500,
    ceiling: 800,
    evidence: { pages: input.pages.length },
    actions: ["split-oversized-page"],
  }));
  dimensions.push(upperBound({
    dimension: "max-referenced-files-per-page",
    observed: Math.max(0, ...input.pages.map((page) => page.referenced_file_count)),
    unit: "count",
    target: 30,
    ceiling: 60,
    absoluteGate: false,
    evidence: {},
    actions: ["split-oversized-page"],
  }));
  dimensions.push(upperBound({
    dimension: "max-target-symbols-per-page",
    observed: Math.max(0, ...input.pages.map((page) => page.referenced_symbol_count)),
    unit: "count",
    target: input.unit.outputProfile === "public-api-reference" ? 20 : 60,
    ceiling: input.unit.outputProfile === "public-api-reference" ? 50 : 150,
    evidence: {},
    actions: ["split-oversized-page", "aggregate-symbol-pages"],
  }));
  dimensions.push(upperBound({
    dimension: "implementation-body-ratio",
    observed: implementation / visibleLines * 100,
    unit: "percent",
    target: 10,
    ceiling: 20,
    evidence: { implementation_lines: implementation, visible_lines: visibleLines },
    actions: ["reduce-implementation-body"],
  }));
  dimensions.push(upperBound({
    dimension: "template-residue",
    observed: input.pages.reduce((sum, page) => sum + page.template_residue_count, 0),
    unit: "count",
    target: 0,
    ceiling: 0,
    evidence: {},
    actions: ["remove-template-residue"],
  }));
  dimensions.push(upperBound({
    dimension: "placeholder-sections",
    observed: input.pages.reduce((sum, page) => sum + page.placeholder_section_count, 0),
    unit: "count",
    target: 0,
    ceiling: 0,
    evidence: {},
    actions: ["remove-template-residue"],
  }));
  if (
    SECTION_SCOPED_PROFILES.has(input.unit.outputProfile) &&
    input.pages.some((page) => page.evidence_count > 0)
  ) {
    dimensions.push(upperBound({
      dimension: "unscoped-section-evidence",
      observed: input.pages.reduce((sum, page) => sum + Math.max(0, page.evidence_count - page.section_scoped_evidence_count), 0),
      unit: "count",
      target: 0,
      ceiling: 0,
      evidence: {},
      actions: ["scope-section-evidence"],
    }));
  }
  return dimensions;
}
