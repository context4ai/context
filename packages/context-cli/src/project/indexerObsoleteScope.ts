import { indexerEvidenceAdapterFileRef } from "@c4a/context";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function isExplicitDeprecatedPath(path: string): boolean {
  return /(^|\/)deprecated(\/|$)/iu.test(path);
}

/** Counts owned targets, not supporting tests or repeated dependency facts.
 * A legacy/v1 directory is not in itself proof of deprecation. This mechanical
 * signal proposes a scope decision; it does not judge or remove content.
 */
export function summarizeIndexerObsoleteScope(runSpecs: readonly unknown[], options: {
  deprecated_member_ids?: ReadonlySet<string>;
  pending_planning?: boolean;
  titles?: ReadonlyMap<string, string>;
} = {}) {
  const files = new Set<string>();
  const affected: { title: string; paths: string[]; mixed_current_content: boolean; member_ids: string[] }[] = [];
  for (const raw of runSpecs) {
    const spec = record(raw);
    const validation = record(spec.validation);
    const members = Array.isArray(validation.canonical_inventory_members)
      ? validation.canonical_inventory_members.map((member) => record(member).member_id) : [];
    const inventory = record(validation.source_identity_inventory);
    const sourceFiles = Array.isArray(inventory.files) ? inventory.files : [];
    const owned = sourceFiles.flatMap((value) => {
      const file = record(value);
      if (typeof file.normalized_path !== "string") return [];
      const facts = Array.isArray(file.facts) ? file.facts : [];
      const fileRef = typeof inventory.source_ref === "string" ? indexerEvidenceAdapterFileRef({
        source_ref: inventory.source_ref, module_ref: typeof inventory.module_ref === "string" ? inventory.module_ref : null,
        normalized_path: file.normalized_path,
      }) : undefined;
      const ownedFacts = facts.map(record).filter((fact) => members.includes(fact.fact_ref));
      const path = file.normalized_path;
      return [
        ...(members.includes(fileRef) ? [{ path, member_id: String(fileRef), deprecated: isExplicitDeprecatedPath(path) }] : []),
        ...ownedFacts.map((fact) => ({ path, member_id: String(fact.fact_ref), deprecated: isExplicitDeprecatedPath(path) ||
          options.deprecated_member_ids?.has(String(fact.fact_ref)) === true })),
      ];
    });
    const paths = [...new Set(owned.filter((member) => member.deprecated).map((member) => member.path))].sort();
    if (paths.length === 0) continue;
    const workset = record(record(spec.request).workset);
    const source = workset.source_ref;
    paths.forEach((path) => files.add(`${String(source)}:${path}`));
    const subject = record(validation.expected_subject_key);
    affected.push({ title: options.titles?.get(String(workset.group_key)) ?? String(subject.local_key ?? "Untitled target"), paths,
      member_ids: [...new Set(owned.filter((member) => member.deprecated).map((member) => member.member_id))].sort(),
      mixed_current_content: owned.some((member) => !member.deprecated) });
  }
  const exclusionLeavesNoCurrentPages = options.pending_planning !== true && runSpecs.length > 0 && affected.length === runSpecs.length &&
    affected.every((item) => !item.mixed_current_content);
  return {
    requires_confirmation: affected.length >= 5 || files.size >= 5,
    detection: "Owned files under explicitly named deprecated directories or declarations explicitly marked deprecated by the Provider; legacy/v1 names and incidental prose mentions are not classified automatically.",
    affected_page_count: affected.length,
    affected_file_count: files.size,
    mixed_page_count: affected.filter((item) => item.mixed_current_content).length,
    total_page_count: runSpecs.length,
    exclusion_leaves_no_current_pages: exclusionLeavesNoCurrentPages,
    affected,
    include_consequence: "Generate documentation for these outdated APIs too. This adds reading, writing and maintenance work; keep their entry points and contracts distinct from current APIs.",
    exclude_consequence: (options.pending_planning ? "This summary covers the current ready wave; excluding it resumes the remaining planning. It does not establish that the rest of the scope has no useful pages. " : "") + "Do not generate outdated API pages. Old integration and migration questions will not be covered. Keep current APIs in mixed pages; captured sources and already accepted knowledge are not deleted." +
      (exclusionLeavesNoCurrentPages ? " No current pages remain: stop this indexing request without submitting another Partition or Author result. Resume only after the user supplies a different scope." : ""),
    include_action: { stage: "structure-review", decision: "approved" },
    exclude_action: exclusionLeavesNoCurrentPages || affected.length === 0 ? null : { stage: "structure-review", decision: "exclude-obsolete" },
  };
}
