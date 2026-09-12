import type { IndexerAuthorSemanticInput } from "@c4a/context";
import type { loadCurrentIndexerBatchTask } from "./indexerCurrentBatch.js";
import { prepareIndexerAuthorMaterial } from "./indexerAuthorMaterial.js";
import { applyIndexerAuthorMaterials } from "./indexerAuthorMaterialStore.js";
import { prepareProjectIndexerWorksetViewMaterialization } from "./indexerWorksetViewMaterialization.js";
import { buildIndexerAuthorRunResultFromSemantic } from "./indexerSemanticAuthorResult.js";

/** Resolve submitted source regions within the registered module. The Agent
 * supplies paths and lines, not parser facts or evidence identities. */
export async function prepareIndexerAuthorSubmission(input: {
  projectRoot: string;
  task: Awaited<ReturnType<typeof loadCurrentIndexerBatchTask>>;
  semantic: IndexerAuthorSemanticInput;
  preview?: boolean;
}) {
  let task = input.task;
  const articles = input.semantic.articles ?? [];
  const sections = [...input.semantic.sections, ...articles.flatMap(article => article.sections)];
  const variables = [input.semantic.template_variables, ...articles.map(article => article.template_variables)];
  const paths = [...new Set([...sections.flatMap(section => section.references.filter(ref => ref.source_ref === task.spec.request.workset.source_ref).map(ref => ref.locator.path)),
    ...variables.flatMap(values => Object.values(values ?? {}).flatMap(value => typeof value === "string" ? [] : value.references.filter(ref => ref.source_ref === task.spec.request.workset.source_ref).map(ref => ref.locator.path)))])]
    .filter((ref) => !ref.includes(":"));
  const material = paths.length === 0 || !task.spec.request.workset.source_ref.startsWith("repo:")
    ? undefined : await prepareIndexerAuthorMaterial({
        projectRoot: input.projectRoot, spec: task.spec,
        group_key: input.semantic.group_key, source_hints: paths,
      });
  if (material !== undefined && material.missing_paths.length > 0) {
    throw new TypeError(`Source files are not in the registered module: ${material.missing_paths.join(", ")}`);
  }
  if (material !== undefined) {
    const prepared = await prepareProjectIndexerWorksetViewMaterialization({
      projectRoot: input.projectRoot, run_spec: material.spec,
    });
    task = { ...task, spec: material.spec, view: prepared.projection.view };
  }
  const result = buildIndexerAuthorRunResultFromSemantic({
    projectRoot: input.projectRoot, request: task.spec.request, view: task.view, semantic: input.semantic,
    validation: task.spec.validation as unknown as Parameters<typeof buildIndexerAuthorRunResultFromSemantic>[0]["validation"],
  });
  // Validate the semantic submission before replacing its pending request.
  // Accepted peers and the stable page/group identity are never reset.
  if (!input.preview && material !== undefined && material.spec.spec_digest !== input.task.spec.spec_digest) {
    await applyIndexerAuthorMaterials({ projectRoot: input.projectRoot, materials: [material] });
  }
  return { task, semantic: input.semantic, result };
}
