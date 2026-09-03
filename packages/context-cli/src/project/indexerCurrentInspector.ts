import {
  buildIndexerActivationRequest,
  buildIndexerFixedDependencySet,
  buildIndexerInspectorRequest,
  indexerLayerFragmentDigest,
  validateAndMaterializeIndexerLayerFragment,
  validateIndexerActivationResult,
  type IndexerMaterializedLayerFragment,
  type IndexerParserFactView,
} from "@c4a/context";
import { executeIndexerControlledRequest } from "./indexerControlledExecution.js";
import type { resolveCurrentProjectIndexerPrimaryAuthority } from
  "./indexerCurrentPrimaryAuthority.js";

type CurrentProjectIndexerPrimaryAuthority = Awaited<
  ReturnType<typeof resolveCurrentProjectIndexerPrimaryAuthority>
>;

const CONTROLLED_LIMITS = {
  timeout_ms: 60_000,
  max_stdin_bytes: 16 * 1024 * 1024,
  max_stdout_bytes: 16 * 1024 * 1024,
  max_stderr_bytes: 1024 * 1024,
};

export interface CurrentIndexerInspectorMaterialization {
  inspector_request: unknown;
  inspector_result: unknown;
}

export interface CurrentIndexerExtensionFacts {
  inspector_materializations: CurrentIndexerInspectorMaterialization[];
  fragments: IndexerMaterializedLayerFragment[];
}

export async function materializeCurrentIndexerExtensionFacts(input: {
  projectRoot: string;
  authority: CurrentProjectIndexerPrimaryAuthority;
  workset_digest: string;
  target_ref?: string;
  parser_fact_view: IndexerParserFactView;
  selected_fact_refs?: readonly string[];
}): Promise<CurrentIndexerExtensionFacts> {
  const dependencies = buildIndexerFixedDependencySet([]);
  const selectedFacts = input.selected_fact_refs === undefined
    ? null
    : new Set(input.selected_fact_refs);
  const sourceFacts = new Map(input.parser_fact_view.files.flatMap((file) =>
    file.facts.map((fact) => [fact.fact_ref, fact] as const)
  ));
  const inspectorMaterializations: CurrentIndexerInspectorMaterialization[] = [];
  const fragments: IndexerMaterializedLayerFragment[] = [];
  for (const layer of input.authority.layers.filter((item) =>
    item.layer.role === "extension" && item.manifest.authoring_inspector !== undefined
  )) {
    if (layer.bundle === undefined || layer.staged === undefined) {
      throw new TypeError(`extension Provider ${layer.layer.id} lacks its staged execution authority`);
    }
    const profiles = input.authority.composition_plan?.active_profiles
      .filter((profile) => profile.provider_layer_id === layer.layer.id)
      .map((profile) => ({ id: profile.id, variants: profile.variants })) ?? [];
    if (profiles.length === 0) continue;
    const control = {
      manifest: layer.manifest,
      bundle: layer.bundle,
      dependencies,
      scope: {
        source_ref: input.parser_fact_view.authorized_scope.source_ref,
        module_refs: input.parser_fact_view.authorized_scope.module_refs,
      },
      limits: CONTROLLED_LIMITS,
      project_ref: input.projectRoot,
    };
    if (layer.manifest.activation.detector !== undefined) {
      const request = buildIndexerActivationRequest({
        ...control,
        input_view: input.parser_fact_view,
      });
      const executed = await executeIndexerControlledRequest({
        request,
        bundle: layer.bundle,
        staged: layer.staged,
      });
      if (executed.result.protocol !== "context.indexer.activation-result/v1") {
        throw new TypeError("extension activation returned the wrong Result protocol");
      }
      const activation = validateIndexerActivationResult({
        request,
        result: executed.result,
      });
      if (activation.report.status === "not-matched") continue;
      if (activation.report.status === "indeterminate") {
        throw new TypeError(`extension Provider ${layer.layer.id} applicability is indeterminate`);
      }
    }
    const request = buildIndexerInspectorRequest({
      ...control,
      input_view: input.parser_fact_view,
      active_profiles: profiles,
    });
    const executed = await executeIndexerControlledRequest({
      request,
      bundle: layer.bundle,
      staged: layer.staged,
    });
    if (executed.result.protocol !== "context.indexer.inspector-result/v1") {
      throw new TypeError("extension inspector returned the wrong Result protocol");
    }
    inspectorMaterializations.push({
      inspector_request: request,
      inspector_result: executed.result,
    });
    if (input.target_ref === undefined) continue;
    const factPayloads = [...executed.result.fact_payloads]
      .filter((item) => selectedFacts === null ||
        item.payload.source_fact_refs.some((ref) => selectedFacts.has(ref)))
      .sort((left, right) => left.fact_ref.localeCompare(right.fact_ref));
    if (factPayloads.length === 0) continue;
    const layerRef = `provider:${layer.layer.id}#layer:${layer.layer.role}`;
    const fragmentBase = {
      protocol: "context.indexer.layer-fragment/v1" as const,
      workset_digest: input.workset_digest,
      layer_ref: layerRef,
      layer_integrity: layer.layer.integrity,
      phase: "pre-authority" as const,
      kind: "fact-enrichment" as const,
      target_refs: [input.target_ref],
      payload: {
        protocol: "context.indexer.fragment.fact-enrichment/v1" as const,
        facts: factPayloads.map((item, index) => ({
          target_ref: input.target_ref!,
          fact_id: `enrichment-${item.payload.profile}-${index + 1}`,
          value: {
            profile: item.payload.profile,
            profile_variants: item.payload.profile_variants,
            source_fact_refs: item.payload.source_fact_refs,
            template_variables: item.payload.template_variables,
            status: item.payload.status,
            ...(item.payload.reason_code === undefined
              ? {}
              : { reason_code: item.payload.reason_code }),
          },
          evidence_refs: item.payload.source_fact_refs.map((ref) => {
            const fact = sourceFacts.get(ref);
            if (fact === undefined) {
              throw new TypeError(`extension enrichment references unknown source fact ${ref}`);
            }
            return {
              ref,
              kind: "code" as const,
              source_digest: fact.payload_digest,
            };
          }).sort((left, right) => left.ref.localeCompare(right.ref)),
        })),
      },
    };
    const fragment = {
      ...fragmentBase,
      fragment_digest: indexerLayerFragmentDigest(fragmentBase),
    };
    const acceptedKinds = new Set(input.authority.composition_plan?.operation_authorities
      .find((item) => item.operation === "main-index")?.accepts_layer_fragments ?? []);
    const allowedKinds = ([
      "fact-enrichment",
      "template-variables",
      "derived-artifact-proposal",
    ] as const).filter((kind) => acceptedKinds.has(kind));
    fragments.push(validateAndMaterializeIndexerLayerFragment({
      fragment,
      expected_workset_digest: input.workset_digest,
      expected_layer_ref: layerRef,
      expected_layer_integrity: layer.layer.integrity,
      allowed_kinds: allowedKinds,
      allowed_target_refs: [input.target_ref],
      validator_contract_digest: input.authority.profile_contract.contract_digest,
    }));
  }
  return {
    inspector_materializations: inspectorMaterializations,
    fragments,
  };
}
