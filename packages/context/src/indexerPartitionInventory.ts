import {
  canonicalIndexerInventoryMembers,
  type IndexerInventoryMember,
  type IndexerInventoryMemberKind,
} from "./indexerInventoryDisposition.js";
import {
  validateIndexerParserFactView,
  type IndexerParserFact,
} from "./indexerParserFactView.js";

const DIRECT_FACT_KIND_MAPPING: Readonly<Record<string, IndexerInventoryMemberKind>> = {
  component: "component",
  entry: "entry",
  example: "example",
  handler: "handler",
  method: "method",
  "protocol-method": "protocol-method",
  route: "route",
  service: "service",
  store: "store",
  "event-branch": "event-branch",
  "timer-branch": "timer-branch",
  "downstream-callsite": "downstream-callsite",
  "state-transition": "state-transition",
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parserFactMemberKind(fact: IndexerParserFact): IndexerInventoryMemberKind | null {
  const direct = DIRECT_FACT_KIND_MAPPING[fact.kind];
  if (direct !== undefined) return direct;
  if (fact.denominator !== "symbol") return null;
  const symbolKind = record(fact.payload)?.kind;
  return symbolKind === "component" ? "component" : "entry";
}

export function buildIndexerPartitionInventoryFromParserFactView(
  value: unknown,
): IndexerInventoryMember[] {
  const view = validateIndexerParserFactView(value);
  const members: IndexerInventoryMember[] = [];
  for (const file of view.files) {
    if (file.disposition === "excluded") continue;
    members.push({ member_id: file.file_ref, member_kind: "entry" });
    for (const fact of file.facts) {
      const memberKind = parserFactMemberKind(fact);
      if (memberKind !== null) {
        members.push({ member_id: fact.fact_ref, member_kind: memberKind });
      }
    }
  }
  return canonicalIndexerInventoryMembers(members);
}
