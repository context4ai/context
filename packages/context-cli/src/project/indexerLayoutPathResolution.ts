import {
  buildIndexerLayoutProposalSet,
  compareIndexerCanonicalText,
  indexerProtocolDigest,
  type IndexerApprovedLayoutProjection,
  type IndexerLayoutProposal,
} from "@c4a/context";

export interface IndexerReaderPathChoice {
  artifact_ref: string;
  output_path: string;
}

export interface IndexerReaderPathPreparation {
  input_digest: string;
  proposals: IndexerLayoutProposal[];
  base_projections: IndexerApprovedLayoutProjection[];
  occupied_paths: string[];
  conflicts: Array<{
    output_path: string;
    occupied_by_approved_page: boolean;
    artifacts: Array<{ artifact_ref: string; title: string; output_path: string }>;
  }>;
}

function pathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

function readablePath(path: string, collection: string): boolean {
  if (!path.startsWith(`knowledge/${collection}/`) || !path.endsWith(".md")) return false;
  const segments = path.slice(`knowledge/${collection}/`.length, -3).split("/");
  return segments.length >= 2 && segments.every((segment) =>
    /^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u.test(segment) &&
    !/^(?:[a-f\d]{32,}|\d{8,14})$/iu.test(segment)
  );
}

function withPaths(
  proposals: readonly IndexerLayoutProposal[],
  paths: ReadonlyMap<string, string>,
): IndexerLayoutProposal[] {
  return proposals.map((proposal) => {
    const { proposal_digest: _digest, ...original } = proposal;
    void _digest;
    const payload = {
      ...original,
      artifacts: original.artifacts.map((artifact) => ({
        ...artifact,
        output_path: paths.get(artifact.artifact_ref) ?? artifact.output_path,
      })),
    };
    return { ...payload, proposal_digest: indexerProtocolDigest(payload) };
  });
}

function findConflicts(input: Pick<IndexerReaderPathPreparation,
  "proposals" | "base_projections" | "occupied_paths"
>): IndexerReaderPathPreparation["conflicts"] {
  const previousOwner = new Map(input.base_projections.flatMap((base) =>
    base.artifacts.map((artifact) =>
      [pathKey(artifact.output_path), artifact.artifact_ref] as const
    )
  ));
  const occupied = new Set(input.occupied_paths.map(pathKey));
  const byPath = new Map<string, IndexerReaderPathPreparation["conflicts"][number]>();
  for (const proposal of input.proposals) {
    for (const artifact of proposal.artifacts) {
      const key = pathKey(artifact.output_path);
      const conflict = byPath.get(key) ?? {
        output_path: artifact.output_path,
        occupied_by_approved_page: false,
        artifacts: [],
      };
      conflict.occupied_by_approved_page ||= occupied.has(key) &&
        previousOwner.get(key) !== artifact.artifact_ref;
      conflict.artifacts.push({
        artifact_ref: artifact.artifact_ref,
        title: `${proposal.node.subject_key.namespace} / ${proposal.node.subject_key.local_key} (${artifact.artifact_kind})`,
        output_path: artifact.output_path,
      });
      byPath.set(key, conflict);
    }
  }
  return [...byPath.values()]
    .filter((conflict) => conflict.artifacts.length > 1 || conflict.occupied_by_approved_page)
    .map((conflict) => ({
      ...conflict,
      artifacts: conflict.artifacts.sort((a, b) =>
        compareIndexerCanonicalText(a.artifact_ref, b.artifact_ref)
      ),
    }))
    .sort((a, b) => compareIndexerCanonicalText(pathKey(a.output_path), pathKey(b.output_path)));
}

export function prepareIndexerReaderPaths(input: {
  proposals: readonly IndexerLayoutProposal[];
  base_projections: readonly IndexerApprovedLayoutProjection[];
  occupied_paths: readonly string[];
}): IndexerReaderPathPreparation {
  // Validate every proposal before examining cross-Subject collisions.
  const proposals = input.proposals.map((proposal) =>
    buildIndexerLayoutProposalSet([proposal]).proposals[0]!
  );
  const previous = new Map(input.base_projections.flatMap((base) =>
    base.artifacts.map((artifact) => [artifact.artifact_ref, artifact] as const)
  ));
  const paths = new Map<string, string>();
  for (const proposal of proposals) {
    for (const artifact of proposal.artifacts) {
      const approved = previous.get(artifact.artifact_ref);
      if (approved?.collection === artifact.collection &&
        readablePath(approved.output_path, artifact.collection)) {
        paths.set(artifact.artifact_ref, approved.output_path);
      }
    }
  }
  const canonical = {
    proposals: withPaths(proposals, paths).sort((a, b) =>
      compareIndexerCanonicalText(a.proposal_digest, b.proposal_digest)
    ),
    base_projections: [...input.base_projections].sort((a, b) =>
      compareIndexerCanonicalText(a.projection_digest, b.projection_digest)
    ),
    occupied_paths: [...new Set(input.occupied_paths)].sort(compareIndexerCanonicalText),
  };
  return {
    ...canonical,
    input_digest: indexerProtocolDigest(canonical),
    conflicts: findConflicts(canonical),
  };
}

export function resolveIndexerReaderPaths(input: {
  preparation: IndexerReaderPathPreparation;
  paths: readonly IndexerReaderPathChoice[];
}) {
  const allowed = new Set(input.preparation.conflicts.flatMap((conflict) =>
    conflict.artifacts.map((artifact) => artifact.artifact_ref)
  ));
  const choices = new Map(input.paths.map((choice) => [choice.artifact_ref, choice.output_path]));
  if (choices.size !== input.paths.length || choices.size !== allowed.size ||
    [...choices.keys()].some((ref) => !allowed.has(ref))) {
    throw new TypeError("paths must specify each conflicting Artifact exactly once and no unrelated Artifact");
  }
  for (const proposal of input.preparation.proposals) {
    for (const artifact of proposal.artifacts) {
      const path = choices.get(artifact.artifact_ref);
      if (path !== undefined && !readablePath(path, artifact.collection)) {
        throw new TypeError(
          `paths for ${artifact.artifact_ref} must use a readable knowledge/${artifact.collection}/<namespace>/<name>.md path`,
        );
      }
    }
  }
  const proposals = withPaths(input.preparation.proposals, choices);
  if (findConflicts({ ...input.preparation, proposals }).length > 0) {
    throw new TypeError("paths still collide with another proposed or approved page; choose distinct readable names");
  }
  return buildIndexerLayoutProposalSet(proposals);
}
