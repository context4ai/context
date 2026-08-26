import { collectCodeIndexAuditStatus } from "./codeIndexAudit.js";

export async function packageCodeIndexAudit(input: {
  projectRoot: string;
  packageName: string;
  selectedApprovedPaths: readonly string[];
}): Promise<Record<string, unknown> | undefined> {
  const current = await collectCodeIndexAuditStatus(input.projectRoot);
  if (!current.applicable || !current.current || current.decision?.decision !== "accept" || current.report === undefined) {
    return undefined;
  }
  const selected = new Set(input.selectedApprovedPaths);
  const selectedPages = current.report.pages.filter((page) => selected.has(page.path));
  const selectedUnits = current.report.units.filter((unit) => selectedPages.some((page) =>
    page.module === unit.id || page.module === unit.output_owner
  ));
  const selectedUnitIds = new Set(selectedUnits.map((unit) => unit.id));
  const selectedViewRefs = new Set(selectedPages.map((page) => page.view_ref));
  const selectedSignals = current.report.signals.filter((signal) =>
    selectedUnitIds.has(signal.unit_id) ||
    (signal.view_ref !== undefined && selectedViewRefs.has(signal.view_ref))
  );
  return {
    schema: "context.package-code-index-audit.v1",
    package: input.packageName,
    report_digest: current.report.digest,
    scope_digest: current.report.scope_digest,
    decision: current.decision,
    workspace_summary: current.report.summary,
    package_selection: {
      code_pages: selectedPages.length,
      approved_paths: selectedPages.map((page) => page.path),
      effective_chars: selectedPages.reduce((sum, page) => sum + page.effective_chars, 0),
      evidence: selectedPages.reduce((sum, page) => sum + page.evidence_count, 0),
      sections: selectedPages.reduce((sum, page) => sum + page.section_count, 0),
      relations: selectedPages.reduce((sum, page) => sum + page.relation_count, 0),
    },
    units: selectedUnits,
    signals: selectedSignals,
  };
}
