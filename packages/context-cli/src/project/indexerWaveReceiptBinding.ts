import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { canonicalIndexerJson } from "@c4a/context";
import { currentSpec, type MainRunSpec, INDEXER_MAIN_RUN_STORE_ROOT } from "./indexerMainRunStoreRecords.js";
import { partitionAuthorBinding } from "./indexerPartitionStream.js";

/** A normal material expansion retains the original plan and all its evidence.
 * Repair intent may change, but ownership, requirements and instructions may not. */
export function extendsWaveMaterial(original: MainRunSpec, current: MainRunSpec): boolean {
  if (original.request.workset.stage !== "author" || current.request.workset.stage !== "author") return false;
  const shape = (spec: MainRunSpec) => {
    if (spec.request.workset.stage !== "author") throw new TypeError("Expected Author");
    const { source_binding_digest: _source, group_dependency_view_digest: _dependency,
      workset_digest: _digest, repair_intent: _repair, ...workset } = spec.request.workset;
    void _source; void _dependency; void _digest; void _repair;
    const { dependency_view: _view, source_identity_inventory: _inventory, ...validation } = spec.validation;
    void _view; void _inventory;
    return { workset, validation };
  };
  if (canonicalIndexerJson(shape(original)) !== canonicalIndexerJson(shape(current))) return false;
  const nodes = (spec: MainRunSpec) => spec.validation.dependency_view as {
    positive_nodes: unknown[]; negative_nodes: unknown[];
  } | undefined;
  const before = nodes(original), after = nodes(current);
  if (!before || !after) return false;
  const expanded = new Set(after.positive_nodes.map(canonicalIndexerJson));
  return before.positive_nodes.every(node => expanded.has(canonicalIndexerJson(node))) &&
    canonicalIndexerJson(before.negative_nodes) === canonicalIndexerJson(after.negative_nodes);
}

/** Recover old checkpoints using immutable requests, never by accepting an
 * arbitrary receipt with a matching title. Used only when exact binding fails. */
export async function resolveWaveReceiptBindings(root: string, active: readonly string[], specs: readonly MainRunSpec[]) {
  const result = new Map<string, string>();
  const unmatched = specs.filter(spec => {
    const binding = partitionAuthorBinding(spec);
    if (!active.includes(binding)) return true;
    result.set(spec.request.execution_request_digest, binding);
    return false;
  });
  if (!unmatched.length) return result;
  const originals: MainRunSpec[] = [];
  for (const name of await readdir(join(root, INDEXER_MAIN_RUN_STORE_ROOT, "requests"))) {
    if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue;
    const spec = await currentSpec({ projectRoot: root, request_digest: `sha256:${name.slice(0, -5)}` });
    if (spec.request.workset.stage === "author" && active.includes(partitionAuthorBinding(spec))) originals.push(spec);
  }
  for (const spec of unmatched) {
    const matches = [...new Set(originals.filter(original => extendsWaveMaterial(original, spec)).map(partitionAuthorBinding))];
    if (matches.length !== 1) {
      throw new ContextError(ExitCode.WorkspaceStateError,
        "Author receipt cannot be uniquely traced to the active wave. Preserve the workspace; repeating build cannot repair this lineage.",
        { category: "author-receipt-wave-mismatch", request_digest: spec.request.execution_request_digest, active_bindings: active });
    }
    result.set(spec.request.execution_request_digest, matches[0]!);
  }
  return result;
}
