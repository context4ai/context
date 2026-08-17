import { isSafeEntityId } from "./entityId.js";
import {
  diagnostic,
  isRecord,
  parseStringArray,
  reportUnknownFields,
  stringValue,
} from "./proseAlignSchemaUtils.js";
import type { AlignDiagnostic, StructureUserOrAgentHints } from "./proseAlignTypes.js";

function parsePreferredNodes(value: unknown, diagnostics: AlignDiagnostic[]): StructureUserOrAgentHints["preferred_nodes"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic("error", "schema.preferred_nodes_array", "schema", "user_or_agent_hints.preferred_nodes must be an array.", "user_or_agent_hints.preferred_nodes"));
    return undefined;
  }
  const nodes: NonNullable<StructureUserOrAgentHints["preferred_nodes"]> = [];
  for (const [index, rawNode] of value.entries()) {
    if (!isRecord(rawNode)) {
      diagnostics.push(diagnostic("error", "schema.preferred_node_object", "schema", "preferred_nodes item must be an object.", `user_or_agent_hints.preferred_nodes[${index}]`));
      continue;
    }
    reportUnknownFields(rawNode, ["node_ref", "reason"], `user_or_agent_hints.preferred_nodes[${index}]`, diagnostics);
    const nodeRef = stringValue(rawNode, "node_ref");
    const reason = stringValue(rawNode, "reason");
    if (nodeRef === undefined) {
      diagnostics.push(diagnostic("error", "schema.preferred_node_ref_missing", "schema", "preferred node must include node_ref.", `user_or_agent_hints.preferred_nodes[${index}].node_ref`));
      continue;
    }
    if (!isSafeEntityId(nodeRef)) {
      diagnostics.push(diagnostic("error", "schema.preferred_node_ref_unsafe", "schema", "preferred node_ref must be a safe relative id.", `user_or_agent_hints.preferred_nodes[${index}].node_ref`));
      continue;
    }
    nodes.push({
      node_ref: nodeRef,
      ...(reason !== undefined ? { reason } : {}),
    });
  }
  return nodes.length > 0 ? nodes : undefined;
}

export function parseUserOrAgentHints(value: unknown, diagnostics: AlignDiagnostic[]): StructureUserOrAgentHints | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    diagnostics.push(diagnostic("error", "schema.user_or_agent_hints_object", "schema", "user_or_agent_hints must be an object.", "user_or_agent_hints"));
    return undefined;
  }
  reportUnknownFields(value, ["preferred_nodes", "grouping_notes", "do_not_force"], "user_or_agent_hints", diagnostics);
  const preferredNodes = parsePreferredNodes(value.preferred_nodes, diagnostics);
  const groupingNotes = parseStringArray(value.grouping_notes, "user_or_agent_hints.grouping_notes", diagnostics);
  const doNotForce = parseStringArray(value.do_not_force, "user_or_agent_hints.do_not_force", diagnostics);
  const hints: StructureUserOrAgentHints = {
    ...(preferredNodes !== undefined ? { preferred_nodes: preferredNodes } : {}),
    ...(groupingNotes.length > 0 ? { grouping_notes: groupingNotes } : {}),
    ...(doNotForce.length > 0 ? { do_not_force: doNotForce } : {}),
  };
  return Object.keys(hints).length > 0 ? hints : undefined;
}
