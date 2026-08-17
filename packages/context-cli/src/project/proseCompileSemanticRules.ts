import {
  type AlignPayload,
  type StructureViewPlan,
} from "./proseAlignTypes.js";
import { semanticRuleSet, type SemanticRuleSet } from "./semanticRules.js";

export function compileSemanticRules(input: {
  view: "read-plan" | "node-context" | "blockers" | "schema";
  structure: AlignPayload;
  node?: StructureViewPlan;
  existingSectionCount?: number;
  parentIndex?: boolean;
}): SemanticRuleSet {
  const required: Array<{ id: string; reason: string }> = [];
  if (input.view === "schema") {
    required.push({ id: "compile-actions", reason: "The compile payload schema and core action contract are being inspected." });
  }
  if (input.view === "blockers") {
    required.push({ id: "structural-challenges", reason: "The current view is diagnosing structure and section ownership blockers." });
  }
  if (input.node !== undefined) {
    required.push(
      { id: "compile-actions", reason: "Core source-bound section action contract for the current node." },
      { id: "compile-judgment", reason: "Core support, weak-evidence, duplicate, and conflict judgment for the current node." },
      { id: "semantic-judgment", reason: "Core semantic support and omission judgment for the current node." },
    );
    const node = input.structure.nodes.find((candidate) => candidate.node_ref === input.node?.node_ref);
    if (node?.node_type === "action" || node?.node_type === "domain") {
      required.push({ id: "action-domain-gates", reason: `Current node type is ${node.node_type}.` });
    }
    if ((input.existingSectionCount ?? 0) > 0) {
      required.push(
        { id: "compile-notes", reason: "The current node already has approved sections and may need update or skip actions." },
        { id: "refresh-and-update", reason: "Existing approved sections require refresh, replacement, or withdrawal rules." },
        { id: "temporal-and-evidence", reason: "Existing evidence bindings must remain temporally and source-ref consistent." },
      );
    }
    if (input.parentIndex === true || input.node.sections.length === 0) {
      required.push({ id: "structural-challenges", reason: "The current node is a generated or section-empty structural view." });
    }
  }
  return semanticRuleSet({ scope: "compile", required });
}
