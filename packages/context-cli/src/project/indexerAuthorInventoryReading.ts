import type { IndexerAuthorizedWorksetView } from "@c4a/context";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Join the same exact fact/container identities as semantic Author consumption.
 * This is navigation, not a decision that a member is public or covered. */
export function authorInventoryReading(view: IndexerAuthorizedWorksetView): unknown[] {
  const selected = new Set(view.items.filter(item => item.category === "dependency")
    .map(item => record(item.value)).filter(value => value.kind === "selected-fact")
    .map(value => value.fact_ref));
  const byMember = new Map<string, Record<string, unknown>[]>();
  for (const item of view.items) {
    if (!["fact", "consumer-anchor", "supporting-fact"].includes(item.category)) continue;
    const value = record(item.value), payload = record(value.payload);
    const ref = typeof value.fact_ref === "string" ? value.fact_ref : item.ref;
    if (!selected.has(ref) || value.kind !== "code-symbol") continue;
    const fact = { ref, ...Object.fromEntries(["name", "kind", "propsType"].filter(key => payload[key] !== undefined)
      .map(key => [key, payload[key]])) };
    for (const member of new Set([ref, item.provenance.container_ref])) {
      if (member === undefined) continue;
      const facts = byMember.get(member) ?? [];
      if (!facts.some(previous => previous.ref === ref)) facts.push(fact);
      byMember.set(member, facts);
    }
  }
  return view.items.filter(item => item.category === "inventory-member").map(item => {
    const value = record(item.value);
    const facts = byMember.get(String(value.member_id));
    return facts?.length ? { ...value, facts } : item.value;
  });
}
