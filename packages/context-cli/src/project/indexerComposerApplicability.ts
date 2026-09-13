import type { IndexerComposerDeclaration, IndexerPrimaryResultView } from "@c4a/context";

export function missingComposerInputs(composer: IndexerComposerDeclaration, view: IndexerPrimaryResultView): string[] {
  const required = composer.contract?.primary_requirements;
  if (!required) return [];
  const artifacts = new Set(view.artifacts.map((artifact) => artifact.artifact_kind));
  return [
    ...required.artifact_kinds.filter((kind) => !artifacts.has(kind)).map((kind) => `artifact:${kind}`),
  ];
}
