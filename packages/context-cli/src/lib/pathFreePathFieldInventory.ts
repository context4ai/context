import type { PathFieldInventoryEntry } from "./pathFreeContractTypes.js";

const DEFAULT_INTERNAL_FIELDS = [
  "path",
  "file",
  "dir",
  "filePath",
  "href",
  "relativePath",
  "relative_path",
  "raw_path",
  "source_path",
  "bucket_path",
  "archiveDir",
  "archivePath",
  "archive_path",
  "archivePathsBySource",
  "archive_paths_by_source",
  "decision_detail_path",
  "bucketDir",
  "bucket_dir",
  "target_dir",
  "target_path",
  "expected_path",
  "current_path",
  "candidate_path",
  "patch_path",
  "patch_root",
  "payload.path",
  "config_path",
  "compile_config_path",
  "repo_root",
  "review_artifact",
  "body_ref",
  "cacheDir",
  "cacheRoot",
  "cache_path",
  "workspaceCachePath",
  "cache_root",
  "ctxDir",
  "outputRoot",
  "outputDir",
  "output_root",
  "output_path",
  "out_dir",
  "index_path",
  "template_path",
  "template_root",
  "report_path",
  "absolute_path",
  "route_metadata_path",
  "prompt_path",
  "packageDir",
  "package_dir",
  "manifestPath",
  "manifest",
  "manifest_path",
  "runnerBinPath",
  "runner_config_path",
  "snapshot_file",
  "snapshotPath",
  "snapshot_path",
  "latest_snapshot",
  "latest_snapshot_file",
  "baseline_snapshot",
  "baseline_snapshot_file",
  "previous_snapshot",
  "previous_snapshot_file",
  "old_snapshot",
  "old_snapshot_file",
  "new_snapshot",
  "new_snapshot_file",
] as const;

function policyFor(field: string): PathFieldInventoryEntry["policy"] {
  if (field === "href" || field === "packageDir" || field === "package_dir" || field === "report_path" || field === "absolute_path") {
    return "human-only";
  }
  if (
    field === "bucket_dir" ||
    field === "target_dir" ||
    field === "config_path" ||
    field === "compile_config_path" ||
    field === "repo_root" ||
    field === "ctxDir" ||
    field === "runner_config_path" ||
    field.startsWith("output") ||
    field === "out_dir" ||
    field === "index_path" ||
    field === "template_path" ||
    field === "template_root" ||
    field === "prompt_path"
  ) {
    return "internal-only";
  }
  if (field === "path" || field === "payload.path" || field.endsWith("_path") || field.endsWith("Path")) {
    return "remove-from-default";
  }
  return "debug-only";
}

function semanticReplacementFor(field: string): string {
  if (field === "payload.path") {
    return "Pass the payload with --input and identify it by schema_version, node_ref, view_ref, section_id, source_ref, or digest.";
  }
  if (field === "href") {
    return "Use node_ref, view_ref, section_id, edge tuple, or source_ref in Agent views; clickable links belong only to explicit human/report views.";
  }
  if (field.includes("snapshot")) {
    return "Use source_name, snapshot_hash, source_ref, and evidence_status instead of snapshot file paths.";
  }
  if (field.includes("manifest")) {
    return "Use source_name, snapshot_hash, manifest status counts, and issue_code instead of manifest paths.";
  }
  if (field.toLowerCase().includes("cache")) {
    return "Use clean-cache status, removed_count, and issue_code instead of cache paths.";
  }
  if (field.toLowerCase().includes("package") || field.startsWith("output") || field === "out_dir") {
    return "Use package_name, build_inventory, and build status instead of generated output paths.";
  }
  return "Use source_name, node_ref, view_ref, section_id, source_ref, edge tuple, issue_code, or explicit --input instead of filesystem paths.";
}

export const PATH_FIELD_INVENTORY: readonly PathFieldInventoryEntry[] = DEFAULT_INTERNAL_FIELDS.map((field) => ({
  field,
  policy: policyFor(field),
  semanticReplacement: semanticReplacementFor(field),
  debugEquivalent: "Use the current command output with --format json plus issue_code/source_ref/node_ref/view_ref; no production debug command is exposed.",
})) satisfies readonly PathFieldInventoryEntry[];
