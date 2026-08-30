import type { IndexerEvidenceKind } from "./indexerProtocolCommon.js";
import type { IndexRequirement, IndexerScopeTarget } from "./indexerRegistry.js";

export type RequirementContractionRelation =
  | "equivalent"
  | "strengthening"
  | "contraction"
  | "incomparable";

export interface ResolvedQuestionContractView {
  ref: string;
  contractDigest: string;
  semanticId: string;
  coverageDomain: string;
  targetDomainId: string;
  selectorContractDigest: string;
  targetRefs: readonly string[];
  evidence: {
    acceptedKinds: readonly IndexerEvidenceKind[];
    minimumItems: number;
    minimumDistinctSources: number;
    provenanceRequired: boolean;
  };
}

export interface RequirementComparisonChange {
  area:
    | "target-scope"
    | "reader-goals"
    | "coverage-domain"
    | "exclusions"
    | "question"
    | "question-semantic"
    | "question-selector"
    | "question-domain"
    | "question-evidence";
  path: string;
  relation: Exclude<RequirementContractionRelation, "equivalent">;
  detail: string;
}

export interface RequirementContractionComparison {
  protocol: "context.indexer.requirement-contraction-comparison/v1";
  requirementRef: string;
  relation: RequirementContractionRelation;
  requiresHumanConfirmation: boolean;
  evidenceSourceChange: "unchanged" | "expanded" | "reduced" | "changed";
  changes: RequirementComparisonChange[];
}

export interface RequirementContractionComparatorOptions {
  /** Canonical implication closure. Each key implies every listed reader goal. */
  readerGoalImplications?: Readonly<Record<string, readonly string[]>>;
  oldQuestionContracts?: readonly ResolvedQuestionContractView[];
  newQuestionContracts?: readonly ResolvedQuestionContractView[];
  /**
   * Relation of a new selector contract to the previous selector contract.
   * The caller must derive this from the CLI's registered selector DSL.
   */
  selectorRelations?: Readonly<Record<string, RequirementContractionRelation>>;
}

type Direction = "strengthening" | "contraction" | "incomparable";

function setRelation<T>(oldValues: ReadonlySet<T>, newValues: ReadonlySet<T>): RequirementContractionRelation {
  const oldContained = [...oldValues].every((value) => newValues.has(value));
  const newContained = [...newValues].every((value) => oldValues.has(value));
  if (oldContained && newContained) return "equivalent";
  if (oldContained) return "strengthening";
  if (newContained) return "contraction";
  return "incomparable";
}

function targetCellSet(targets: readonly IndexerScopeTarget[]): Set<string> {
  return new Set(targets.flatMap((target) =>
    target.module_refs.length === 0
      ? [`${target.source_ref}\u0000`]
      : target.module_refs.map((moduleRef) => `${target.source_ref}\u0000${moduleRef}`)
  ));
}

function addChange(
  changes: RequirementComparisonChange[],
  input: RequirementComparisonChange,
): void {
  changes.push(input);
}

function compareSetArea(input: {
  oldValues: ReadonlySet<string>;
  newValues: ReadonlySet<string>;
  area: RequirementComparisonChange["area"];
  path: string;
  detail: string;
  changes: RequirementComparisonChange[];
}): RequirementContractionRelation {
  const relation = setRelation(input.oldValues, input.newValues);
  if (relation !== "equivalent") {
    addChange(input.changes, {
      area: input.area,
      path: input.path,
      relation,
      detail: input.detail,
    });
  }
  return relation;
}

function implicationClosure(
  goals: readonly string[],
  implications: Readonly<Record<string, readonly string[]>>,
): Set<string> {
  const result = new Set(goals);
  const pending = [...goals];
  while (pending.length > 0) {
    const goal = pending.pop()!;
    for (const implied of implications[goal] ?? []) {
      if (result.has(implied)) continue;
      result.add(implied);
      pending.push(implied);
    }
  }
  return result;
}

const COVERAGE_STRENGTH = {
  "out-of-scope": 0,
  optional: 1,
  required: 2,
} as const;

function compareCoverageDomains(
  oldRequirement: IndexRequirement,
  newRequirement: IndexRequirement,
  changes: RequirementComparisonChange[],
): void {
  const domains = new Set([
    ...Object.keys(oldRequirement.coverage_domains),
    ...Object.keys(newRequirement.coverage_domains),
  ]);
  for (const domain of domains) {
    const oldCoverage = oldRequirement.coverage_domains[domain] ?? "out-of-scope";
    const newCoverage = newRequirement.coverage_domains[domain] ?? "out-of-scope";
    const oldStrength = COVERAGE_STRENGTH[oldCoverage];
    const newStrength = COVERAGE_STRENGTH[newCoverage];
    if (oldStrength === newStrength) continue;
    addChange(changes, {
      area: "coverage-domain",
      path: `coverage_domains.${domain}`,
      relation: newStrength > oldStrength ? "strengthening" : "contraction",
      detail: `coverage changed from ${oldCoverage} to ${newCoverage}`,
    });
  }
}

function exclusionCells(requirement: IndexRequirement): Set<string> {
  return new Set((requirement.exclusions ?? []).flatMap((exclusion) =>
    [...targetCellSet(exclusion.scope.targets)].map((cell) => `${exclusion.id}\u0000${cell}`)
  ));
}

function questionViewMap(
  views: readonly ResolvedQuestionContractView[],
): Map<string, ResolvedQuestionContractView> {
  return new Map(views.map((view) => [`${view.ref}\u0000${view.contractDigest}`, view]));
}

function compareEvidence(
  ref: string,
  oldView: ResolvedQuestionContractView,
  newView: ResolvedQuestionContractView,
  changes: RequirementComparisonChange[],
): void {
  const acceptedRelation = setRelation(
    new Set(newView.evidence.acceptedKinds),
    new Set(oldView.evidence.acceptedKinds),
  );
  if (acceptedRelation !== "equivalent") {
    addChange(changes, {
      area: "question-evidence",
      path: `questions.${ref}.evidence.acceptedKinds`,
      relation: acceptedRelation,
      detail: "accepted evidence kinds changed",
    });
  }
  for (const [field, oldValue, newValue] of [
    ["minimumItems", oldView.evidence.minimumItems, newView.evidence.minimumItems],
    [
      "minimumDistinctSources",
      oldView.evidence.minimumDistinctSources,
      newView.evidence.minimumDistinctSources,
    ],
  ] as const) {
    if (oldValue === newValue) continue;
    addChange(changes, {
      area: "question-evidence",
      path: `questions.${ref}.evidence.${field}`,
      relation: newValue > oldValue ? "strengthening" : "contraction",
      detail: `${field} changed from ${oldValue} to ${newValue}`,
    });
  }
  if (oldView.evidence.provenanceRequired !== newView.evidence.provenanceRequired) {
    addChange(changes, {
      area: "question-evidence",
      path: `questions.${ref}.evidence.provenanceRequired`,
      relation: newView.evidence.provenanceRequired ? "strengthening" : "contraction",
      detail: "provenance requirement changed",
    });
  }
}

function compareChangedQuestion(input: {
  ref: string;
  oldDigest: string;
  newDigest: string;
  oldViews: Map<string, ResolvedQuestionContractView>;
  newViews: Map<string, ResolvedQuestionContractView>;
  selectorRelations: Readonly<Record<string, RequirementContractionRelation>>;
  changes: RequirementComparisonChange[];
}): void {
  const oldView = input.oldViews.get(`${input.ref}\u0000${input.oldDigest}`);
  const newView = input.newViews.get(`${input.ref}\u0000${input.newDigest}`);
  if (oldView === undefined || newView === undefined) {
    addChange(input.changes, {
      area: "question",
      path: `questions.${input.ref}`,
      relation: "incomparable",
      detail: "changed question contract is not available from its canonical authority",
    });
    return;
  }
  if (oldView.semanticId !== newView.semanticId) {
    addChange(input.changes, {
      area: "question-semantic",
      path: `questions.${input.ref}.semanticId`,
      relation: "incomparable",
      detail: "canonical question semantic changed",
    });
  }
  if (oldView.coverageDomain !== newView.coverageDomain) {
    addChange(input.changes, {
      area: "question-domain",
      path: `questions.${input.ref}.coverageDomain`,
      relation: "incomparable",
      detail: "question was rebound to another coverage domain",
    });
  }
  if (oldView.targetDomainId !== newView.targetDomainId) {
    addChange(input.changes, {
      area: "question-domain",
      path: `questions.${input.ref}.targetDomainId`,
      relation: "incomparable",
      detail: "question target domain changed",
    });
  }
  if (oldView.selectorContractDigest !== newView.selectorContractDigest) {
    const selectorRelation = input.selectorRelations[input.ref] ?? "incomparable";
    if (selectorRelation !== "equivalent") {
      addChange(input.changes, {
        area: "question-selector",
        path: `questions.${input.ref}.selector`,
        relation: selectorRelation,
        detail: "selector contract changed",
      });
    }
  }
  compareSetArea({
    oldValues: new Set(oldView.targetRefs),
    newValues: new Set(newView.targetRefs),
    area: "question-selector",
    path: `questions.${input.ref}.targetRefs`,
    detail: "resolved question target set changed",
    changes: input.changes,
  });
  compareEvidence(input.ref, oldView, newView, input.changes);
}

function compareQuestions(
  oldRequirement: IndexRequirement,
  newRequirement: IndexRequirement,
  options: RequirementContractionComparatorOptions,
  changes: RequirementComparisonChange[],
): void {
  const oldBindings = new Map(
    (oldRequirement.questions ?? []).map((question) => [question.ref, question]),
  );
  const newBindings = new Map(
    (newRequirement.questions ?? []).map((question) => [question.ref, question]),
  );
  const refs = new Set([...oldBindings.keys(), ...newBindings.keys()]);
  const oldViews = questionViewMap(options.oldQuestionContracts ?? []);
  const newViews = questionViewMap(options.newQuestionContracts ?? []);
  for (const ref of refs) {
    const oldBinding = oldBindings.get(ref);
    const newBinding = newBindings.get(ref);
    if (oldBinding === undefined) {
      addChange(changes, {
        area: "question",
        path: `questions.${ref}`,
        relation: "strengthening",
        detail: "canonical question obligation was added",
      });
      continue;
    }
    if (newBinding === undefined) {
      addChange(changes, {
        area: "question",
        path: `questions.${ref}`,
        relation: "contraction",
        detail: "canonical question obligation was removed",
      });
      continue;
    }
    if (oldBinding.contract_digest === newBinding.contract_digest) continue;
    compareChangedQuestion({
      ref,
      oldDigest: oldBinding.contract_digest,
      newDigest: newBinding.contract_digest,
      oldViews,
      newViews,
      selectorRelations: options.selectorRelations ?? {},
      changes,
    });
  }
}

function overallRelation(changes: readonly RequirementComparisonChange[]): RequirementContractionRelation {
  const directions = new Set<Direction>(changes.map((change) => change.relation));
  if (directions.size === 0) return "equivalent";
  if (directions.has("incomparable")) return "incomparable";
  if (directions.has("strengthening") && directions.has("contraction")) {
    return "incomparable";
  }
  return directions.has("contraction") ? "contraction" : "strengthening";
}

function evidenceSourceChange(
  oldRequirement: IndexRequirement,
  newRequirement: IndexRequirement,
): RequirementContractionComparison["evidenceSourceChange"] {
  const relation = setRelation(
    targetCellSet(oldRequirement.evidence_source_scope.targets),
    targetCellSet(newRequirement.evidence_source_scope.targets),
  );
  if (relation === "equivalent") return "unchanged";
  if (relation === "strengthening") return "expanded";
  if (relation === "contraction") return "reduced";
  return "changed";
}

export function compareIndexRequirementContraction(
  oldRequirement: IndexRequirement,
  newRequirement: IndexRequirement,
  options: RequirementContractionComparatorOptions = {},
): RequirementContractionComparison {
  if (oldRequirement.id !== newRequirement.id) {
    throw new TypeError("Requirement comparator cannot replace a requirement identity");
  }
  const changes: RequirementComparisonChange[] = [];
  compareSetArea({
    oldValues: targetCellSet(oldRequirement.target_scope.targets),
    newValues: targetCellSet(newRequirement.target_scope.targets),
    area: "target-scope",
    path: "target_scope.targets",
    detail: "target source/module scope changed",
    changes,
  });
  compareSetArea({
    oldValues: implicationClosure(
      oldRequirement.reader_goals,
      options.readerGoalImplications ?? {},
    ),
    newValues: implicationClosure(
      newRequirement.reader_goals,
      options.readerGoalImplications ?? {},
    ),
    area: "reader-goals",
    path: "reader_goals",
    detail: "canonical reader goals changed",
    changes,
  });
  compareCoverageDomains(oldRequirement, newRequirement, changes);
  const exclusionRelation = setRelation(
    exclusionCells(oldRequirement),
    exclusionCells(newRequirement),
  );
  if (exclusionRelation !== "equivalent") {
    addChange(changes, {
      area: "exclusions",
      path: "exclusions",
      relation: exclusionRelation === "strengthening"
        ? "contraction"
        : exclusionRelation === "contraction"
        ? "strengthening"
        : "incomparable",
      detail: "confirmed target exclusions changed",
    });
  }
  compareQuestions(oldRequirement, newRequirement, options, changes);
  const relation = overallRelation(changes);
  return {
    protocol: "context.indexer.requirement-contraction-comparison/v1",
    requirementRef: oldRequirement.id,
    relation,
    requiresHumanConfirmation: relation === "contraction" || relation === "incomparable",
    evidenceSourceChange: evidenceSourceChange(oldRequirement, newRequirement),
    changes,
  };
}
