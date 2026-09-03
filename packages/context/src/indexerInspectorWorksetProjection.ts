import {
  buildIndexerAuthorizedWorksetViewSource,
  type IndexerAuthorizedWorksetViewSource,
} from "./indexerAuthorizedWorksetView.js";
import {
  validateIndexerInspectorRequest,
  validateIndexerInspectorResult,
} from "./indexerControlledProgram.js";
import { validateIndexerMainRunRequest } from "./indexerMainRunProtocol.js";

export function buildIndexerInspectorWorksetViewSource(input: {
  request: unknown;
  inspector_request: unknown;
  inspector_result: unknown;
}): IndexerAuthorizedWorksetViewSource {
  const request = validateIndexerMainRunRequest(input.request);
  const inspectorRequest = validateIndexerInspectorRequest(input.inspector_request);
  const materialization = validateIndexerInspectorResult({
    request: inspectorRequest,
    result: input.inspector_result,
  });
  const expectedModules = request.workset.module_ref === null
    ? []
    : [request.workset.module_ref];
  const scope = inspectorRequest.input_view.authorized_scope;
  if (
    scope.source_ref !== request.workset.source_ref ||
    scope.module_refs.length !== expectedModules.length ||
    scope.module_refs.some((ref, index) => ref !== expectedModules[index])
  ) {
    throw new TypeError("inspector projection does not match the current workset source/module");
  }

  return buildIndexerAuthorizedWorksetViewSource({
    request,
    projection_kind: "provider-enrichment",
    input_digests: [
      inspectorRequest.request_digest,
      materialization.result.result_digest,
    ],
    items: materialization.fact_payloads.map((item) => ({
      ref: item.fact_ref,
      category: "provider-enrichment",
      provenance: {
        protocol: materialization.result.protocol,
        digest: materialization.result.result_digest,
        container_ref: `provider:${inspectorRequest.invocation.provider.provider_id}`,
      },
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
    })),
  });
}
