import { loadCurrentIndexerRegistry as loadIndexerRegistry } from "./currentIndexerRegistry.js";
import { join, posix } from "node:path";
import {
  buildIndexerAuthorDependencyView, buildIndexerMainRunRequest, buildIndexerMainWorkset,
  buildIndexerRunEnvironment, buildIndexerSourceIdentityInventory, composeIndexerLayerInput,
  indexerProtocolDigest, loadSourcesRegistry,
  validateIndexerAuthorDependencyView, validateIndexerSourceIdentityInventory,
  type IndexerAuthorDependencyView, type IndexerSourceIdentityInventory,
} from "@c4a/context";
import { normalizeRunSpec, type MainRunSpec } from "./indexerMainRunStoreRecords.js";
import { resolveProjectIndexerMainSourceIdentity } from "./indexerMainSourceAdapter.js";
import { projectIndexerReadTargetAllows, projectIndexerReadTargets } from "./indexerReadScopeAuthorization.js";
import { INDEXER_AUTHOR_SOURCE_TEXT_MAX_BYTES, readIndexerAuthorSourceText } from "./indexerAuthorSourceText.js";

type SourceSpan = Extract<IndexerAuthorDependencyView["positive_nodes"][number], { kind: "source-span" }>;

function withoutNodeRef({ node_ref: _ref, ...node }: { node_ref: string }) {
  void _ref;
  return node;
}

/** Keep explicitly requested source bodies even when they have no selected Fact.
 * Reading a dependency does not make all of its symbols members of this page. */
export function authorSourceIdentityForView(input: {
  inventory: IndexerSourceIdentityInventory;
  dependency_view: IndexerAuthorDependencyView;
}): IndexerSourceIdentityInventory {
  const view = input.dependency_view;
  const facts = new Set(view.positive_nodes.flatMap((node) => node.kind === "selected-fact" ? [node.fact_ref] : []));
  const paths = new Set(view.positive_nodes.flatMap((node) =>
    node.kind === "source-span" && node.source_ref === input.inventory.source_ref &&
      node.module_ref === input.inventory.module_ref ? [node.locator.path] : []));
  return buildIndexerSourceIdentityInventory({
    ...input.inventory, source_input_digest: view.view_digest,
    files: input.inventory.files.map((file) => ({ ...file, facts: file.facts.filter((fact) => facts.has(fact.fact_ref)) }))
      .filter((file) => paths.has(file.normalized_path) || file.facts.length > 0),
  });
}

function expandedSpec(spec: MainRunSpec, nodes: SourceSpan[], inventory: IndexerSourceIdentityInventory): MainRunSpec {
  if (spec.request.workset.stage !== "author") throw new TypeError("Material expansion requires an Author task");
  const previous = validateIndexerAuthorDependencyView(spec.validation.dependency_view);
  const replacedEvidence = new Set(nodes.map((node) => node.evidence_ref));
  const view = buildIndexerAuthorDependencyView({
    ...previous,
    positive_nodes: [...previous.positive_nodes.filter((node) =>
      node.kind !== "source-span" || !replacedEvidence.has(node.evidence_ref)), ...nodes].map(withoutNodeRef),
    negative_nodes: previous.negative_nodes.map(withoutNodeRef),
  });
  const { workset_digest: _worksetDigest, ...payload } = spec.request.workset;
  void _worksetDigest;
  const workset = buildIndexerMainWorkset({
    ...payload, source_binding_digest: view.view_digest, group_dependency_view_digest: view.view_digest,
  });
  const { protocol: _protocol, environment_digest: _environmentDigest, ...environment } = spec.request.run_environment;
  void _protocol;
  void _environmentDigest;
  const request = buildIndexerMainRunRequest({
    workset,
    composition_input: composeIndexerLayerInput({
      workset_digest: workset.workset_digest,
      final_authority_layer_ref: spec.request.composition_input.final_authority_layer_ref,
      fragments: spec.request.composition_input.accepted_fragments,
    }),
    final_authority: spec.request.final_authority,
    run_environment: buildIndexerRunEnvironment({
      ...environment, dependency_view_digest: view.view_digest, source_dependency_fingerprint: view.view_digest,
      source_snapshot_digest: indexerProtocolDigest({
        source_ref: view.source_ref, module_ref: view.module_ref,
        source_spans: view.positive_nodes.flatMap((node) => node.kind === "source-span"
          ? [{ node_ref: node.node_ref, content_digest: node.content_digest }] : []),
      }),
    }),
  });
  return normalizeRunSpec({
    protocol: spec.protocol, request,
    validation: { ...spec.validation, dependency_view: view,
      source_identity_inventory: authorSourceIdentityForView({ inventory, dependency_view: view }) },
  });
}

/** Resolve concrete paths against the registered Parser inventory, never by
 * scanning the repository, following guessed imports or changing Partition. */
export async function prepareIndexerAuthorMaterial(input: {
  projectRoot: string;
  spec: MainRunSpec;
  group_key: string;
  source_hints: readonly string[];
}) {
  const workset = input.spec.request.workset;
  if (workset.stage !== "author" || workset.group_key !== input.group_key) {
    throw new TypeError("Material request must identify the current Author group");
  }
  const { registry } = await loadIndexerRegistry(input.projectRoot);
  if (!projectIndexerReadTargetAllows({
    targets: projectIndexerReadTargets({ registry, indexer_id: workset.indexer_id }),
    source_ref: workset.source_ref, module_ref: workset.module_ref,
  })) throw new TypeError("Requested Author source is outside the Indexer read scope");
  const sources = await loadSourcesRegistry({ rootDir: input.projectRoot });
  const sourceName = workset.source_ref.startsWith("repo:") ? workset.source_ref.slice(5) : null;
  const source = sources.repos.find((repo) => repo.name === sourceName || repo.id === sourceName);
  if (source === undefined) {
    throw new TypeError("No registered repository for this material request. Use the available captured document materials or report the specific missing source; repeating the same request will not add it.");
  }
  const hints = [...new Set(input.source_hints.map((hint) => hint.trim().replace(/^\.\//u, "").replace(/\/+$/u, "")))];
  if (hints.length === 0 || hints.some((hint) => hint === "" || hint === "." || posix.isAbsolute(hint) ||
      hint.split("/").includes("..") || hint.includes("\\"))) {
    throw new TypeError("Provide source_hints as specific repository-relative file or directory paths; do not request the entire repository or paths outside it.");
  }
  const inventory = await resolveProjectIndexerMainSourceIdentity({
    projectRoot: input.projectRoot, indexer_id: workset.indexer_id,
    source_ref: workset.source_ref, module_ref: workset.module_ref,
    profile_contract_digest: workset.profile_contract_digest,
  });
  const files = inventory.files.filter((file) => hints.some((hint) =>
    file.normalized_path === hint || file.normalized_path.startsWith(`${hint}/`)));
  const missing = hints.filter((hint) => !files.some((file) =>
    file.normalized_path === hint || file.normalized_path.startsWith(`${hint}/`)));
  if (files.length === 0) {
    throw new TypeError(`No captured source matches ${hints.join(", ")} in ${workset.source_ref}. Correct the relative paths or report the missing dependency; do not retry unchanged or restart collection/Partition automatically.`);
  }
  const view = validateIndexerAuthorDependencyView(input.spec.validation.dependency_view);
  const oldIdentity = validateIndexerSourceIdentityInventory(input.spec.validation.source_identity_inventory);
  const nodes: SourceSpan[] = [];
  const expanded: string[] = [];
  let remaining = INDEXER_AUTHOR_SOURCE_TEXT_MAX_BYTES;
  for (const file of files) {
    const probe: SourceSpan = {
      kind: "source-span", node_ref: "source:requested-body",
      evidence_ref: `evidence:${indexerProtocolDigest({ source_ref: workset.source_ref,
        module_ref: workset.module_ref, path: file.normalized_path, material: "full-source-body" })}`,
      source_ref: workset.source_ref, module_ref: workset.module_ref,
      locator: { path: file.normalized_path, start_line: 1, end_line: 1 },
      content_digest: file.content_digest, targets: [{ level: "logical-unit" }],
    };
    const body = await readIndexerAuthorSourceText({
      source_root: join(input.projectRoot, source.materializedAt), path: file.normalized_path,
      content_digest: file.content_digest, spans: [probe], max_bytes: remaining, whole_file: true,
    });
    remaining -= body.bytes;
    const end = body.spans[0]!.end_line;
    const alreadyComplete = view.positive_nodes.some((node) => node.kind === "source-span" &&
      node.source_ref === workset.source_ref && node.module_ref === workset.module_ref &&
      node.locator.path === file.normalized_path && node.content_digest === file.content_digest &&
      node.locator.start_line === 1 && node.locator.end_line >= end && node.targets.length > 0);
    // An unselected Parser span is not a delivered body. Explicit requests
    // must survive both the source-text and readable-View selectors.
    expanded.push(file.normalized_path);
    if (alreadyComplete) continue;
    const previous = oldIdentity.files.find((item) => item.normalized_path === file.normalized_path);
    if (previous !== undefined && previous.content_digest !== file.content_digest) {
      throw new TypeError(`Source ${file.normalized_path} changed during Author. Refresh this source before requesting more material; existing completed pages are retained.`);
    }
    nodes.push({ ...probe, locator: { ...probe.locator, end_line: end } });
  }
  // Preserve existing selected facts; additional bodies do not acquire page ownership.
  const identities = new Map(oldIdentity.files.map((file) => [file.normalized_path, file]));
  for (const file of files) if (!identities.has(file.normalized_path)) identities.set(file.normalized_path, { ...file, facts: [] });
  return {
    previous_request_digest: input.spec.request.execution_request_digest,
    spec: nodes.length === 0 ? input.spec : expandedSpec(input.spec, nodes, buildIndexerSourceIdentityInventory({ ...inventory, files: [...identities.values()] })),
    paths: expanded, missing_paths: missing,
  };
}
