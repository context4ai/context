import type {
  CodeIndexAuditActionGuidance,
  CodeIndexAuditDimension,
  CodeIndexAuditPageMetrics,
  CodeIndexAuditSignal,
} from "./codeIndexAuditTypes.js";

interface ActionContract {
  templates: string[];
  fields: string[];
  improves: string[];
}

const TEMPLATE_ROOT = "context-workflow/resources/semantic/code-index/templates";
const CLASSIFICATION_RESOURCE = "context-workflow/resources/semantic/code-index/classification.md";

const ACTION_CONTRACTS: Record<string, ActionContract> = {
  "expand-input-scope": {
    templates: [CLASSIFICATION_RESOURCE],
    fields: ["phase.include", "indexUnits[].inputSources"],
    improves: ["eligible-file-analysis", "eligible-loc-analysis"],
  },
  "correct-exclusions": {
    templates: [CLASSIFICATION_RESOURCE],
    fields: ["phase.exclude", "indexUnits[].exclusions"],
    improves: ["eligible-file-analysis", "eligible-loc-analysis"],
  },
  "inspect-authoritative-entry": {
    templates: [CLASSIFICATION_RESOURCE],
    fields: ["indexUnits[].entries", "indexUnits[].documents", "indexUnits[].lifecycle"],
    improves: ["stable-entry-coverage", "root-document-read-coverage", "related-document-read-coverage"],
  },
  "add-entry-probes": {
    templates: [CLASSIFICATION_RESOURCE],
    fields: ["indexUnits[].entries", "adapter.inventory.boundaryTargets"],
    improves: ["stable-entry-coverage", "eligible-file-analysis"],
  },
  "cover-missing-exports": {
    templates: [`${TEMPLATE_ROOT}/sdk-library.md`, `${TEMPLATE_ROOT}/contract-source.md`],
    fields: ["indexUnits[].sections", "adapter.inventory.exportedTargetIdentities"],
    improves: ["target-symbol-coverage", "public-export-identity-coverage"],
  },
  "cover-missing-routes": {
    templates: [`${TEMPLATE_ROOT}/web-application.md`, `${TEMPLATE_ROOT}/api-service.md`],
    fields: ["indexUnits[].sections", "adapter.inventory.boundaryTargets"],
    improves: ["route-coverage", "operation-coverage"],
  },
  "connect-operation-handler": {
    templates: [`${TEMPLATE_ROOT}/api-service.md`, `${TEMPLATE_ROOT}/contracts-and-chains.md`],
    fields: ["indexUnits[].sections", "indexUnits[].edges"],
    improves: ["operation-coverage", "handler-coverage"],
  },
  "connect-handler-downstream": {
    templates: [`${TEMPLATE_ROOT}/domain-service.md`, `${TEMPLATE_ROOT}/contracts-and-chains.md`],
    fields: ["indexUnits[].sections", "indexUnits[].edges"],
    improves: ["downstream-coverage", "handoff-coverage"],
  },
  "connect-adjacent-handoffs": {
    templates: [`${TEMPLATE_ROOT}/cross-module-chain.md`],
    fields: ["indexUnits[].sections", "indexUnits[].edges"],
    improves: ["handoff-coverage"],
  },
  "cover-missing-commands": {
    templates: [`${TEMPLATE_ROOT}/cli-tool.md`],
    fields: ["indexUnits[].sections", "adapter.inventory.boundaryTargets"],
    improves: ["command-coverage"],
  },
  "cover-missing-events": {
    templates: [`${TEMPLATE_ROOT}/event-flow.md`, `${TEMPLATE_ROOT}/background-runtime.md`],
    fields: ["indexUnits[].sections", "adapter.inventory.boundaryTargets"],
    improves: ["event-coverage"],
  },
  "cover-missing-plugin-entries": {
    templates: [`${TEMPLATE_ROOT}/plugin-extension.md`],
    fields: ["indexUnits[].sections", "adapter.inventory.boundaryTargets"],
    improves: ["plugin-coverage"],
  },
  "add-module-explanation": {
    templates: [CLASSIFICATION_RESOURCE],
    fields: ["indexUnits[].sections"],
    improves: ["semantic-fact-lines", "semantic-fact-density", "explanatory-lines"],
  },
  "remove-template-residue": {
    templates: [CLASSIFICATION_RESOURCE],
    fields: ["indexUnits[].sections"],
    improves: ["template-residue", "placeholder-sections", "unscoped-section-evidence"],
  },
  "aggregate-symbol-pages": {
    templates: [`${TEMPLATE_ROOT}/sdk-library.md`, `${TEMPLATE_ROOT}/contract-source.md`],
    fields: ["indexUnits[].outputProfile", "indexUnits[].sections"],
    improves: ["semantic-fact-density", "max-target-symbols-per-page"],
  },
  "split-oversized-page": {
    templates: [CLASSIFICATION_RESOURCE],
    fields: ["indexUnits[].sections", "indexUnits[].outputOwner"],
    improves: ["max-page-lines", "max-referenced-files-per-page", "max-target-symbols-per-page"],
  },
  "reduce-implementation-body": {
    templates: [`${TEMPLATE_ROOT}/derived-source.md`],
    fields: ["indexUnits[].sections"],
    improves: ["implementation-body-ratio", "semantic-fact-density"],
  },
  "return-complete-source-inventory": {
    templates: [`${TEMPLATE_ROOT}/adapter.md`],
    fields: ["adapter.inventory"],
    improves: ["eligible-file-analysis", "eligible-loc-analysis", "semantic-fact-density"],
  },
  "return-target-symbol-inventory": {
    templates: [`${TEMPLATE_ROOT}/adapter.md`],
    fields: ["adapter.inventory.targetSymbolIdentities"],
    improves: ["target-symbol-coverage"],
  },
  "scope-section-evidence": {
    templates: [`${TEMPLATE_ROOT}/contracts-and-chains.md`],
    fields: ["indexUnits[].sections[].evidence"],
    improves: ["unscoped-section-evidence"],
  },
};

const FALLBACK_CONTRACT: ActionContract = {
  templates: [CLASSIFICATION_RESOURCE],
  fields: ["indexUnits[]"],
  improves: [],
};

export function buildCodeIndexActionGuidance(input: {
  dimensions: readonly CodeIndexAuditDimension[];
  pages: readonly CodeIndexAuditPageMetrics[];
  signals?: readonly CodeIndexAuditSignal[];
}): CodeIndexAuditActionGuidance[] {
  const failed = input.dimensions.filter((dimension) =>
    dimension.absolute_gate || dimension.status === "below-target" || dimension.status === "above-ceiling" || (
      dimension.status === "above-target" && (
        dimension.dimension === "max-page-lines" ||
        dimension.dimension === "implementation-body-ratio"
      )
    )
  );
  const actionableSignals = (input.signals ?? []).filter((signal) =>
    (signal.recommended_actions?.length ?? 0) > 0
  );
  const actions = [...new Set([
    ...failed.flatMap((dimension) => dimension.recommended_actions),
    ...actionableSignals.flatMap((signal) => signal.recommended_actions ?? []),
  ])].sort();
  const affectedPages = (dimensions: readonly CodeIndexAuditDimension[]): string[] => {
    const pageDimensions = new Set(dimensions.map((dimension) => dimension.dimension));
    return input.pages.filter((page) => {
      if (pageDimensions.has("max-page-lines") && page.line_count > 500) return true;
      if (pageDimensions.has("max-referenced-files-per-page") && page.referenced_file_count > 30) return true;
      const symbolDimension = dimensions.find((dimension) => dimension.dimension === "max-target-symbols-per-page");
      if (symbolDimension?.target !== null && symbolDimension !== undefined && page.referenced_symbol_count > symbolDimension.target) return true;
      if (pageDimensions.has("template-residue") && page.template_residue_count > 0) return true;
      if (pageDimensions.has("placeholder-sections") && page.placeholder_section_count > 0) return true;
      if (pageDimensions.has("unscoped-section-evidence") &&
        page.evidence_count > page.section_scoped_evidence_count) return true;
      if (pageDimensions.has("relationship-evidence-coverage") && page.relation_evidence_count < page.relation_count) return true;
      if (pageDimensions.has("implementation-body-ratio") && page.implementation_body_lines > 0) return true;
      if (pageDimensions.has("semantic-fact-lines") || pageDimensions.has("semantic-fact-density") ||
        pageDimensions.has("explanatory-lines")) return true;
      return false;
    }).map((page) => page.view_ref).sort();
  };
  return actions.map((action) => {
    const contract = ACTION_CONTRACTS[action] ?? FALLBACK_CONTRACT;
    const actionDimensions = failed.filter((dimension) => dimension.recommended_actions.includes(action));
    const actionSignals = actionableSignals.filter((signal) => signal.recommended_actions?.includes(action));
    return {
      action,
      failed_dimensions: [...new Set([
        ...actionDimensions.map((dimension) => dimension.dimension),
        ...actionSignals.map((signal) => signal.code),
      ])].sort(),
      affected_pages: [...new Set([
        ...affectedPages(actionDimensions),
        ...actionSignals.flatMap((signal) => signal.view_ref === undefined ? [] : [signal.view_ref]),
      ])].sort(),
      template_paths: contract.templates,
      configuration_fields: contract.fields,
      expected_improvement: contract.improves,
    };
  });
}
