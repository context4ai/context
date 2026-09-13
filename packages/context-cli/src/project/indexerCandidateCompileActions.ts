import {
  buildIndexerCandidateCompile,
  canonicalIndexerJson,
  indexerArtifactResultSchema,
  type IndexerAcceptedAuthorResultInput,
} from "@c4a/context";

// Pure offline projection helpers. Current production never reads or writes
// Provider compilation ledgers, readiness records or accepted-run stores here.

interface AcceptedAuthorRecord {
  request: unknown;
  run_result: unknown;
  accepted_record: unknown;
  artifact_result: unknown;
  run_envelope: unknown;
  post_author_envelope?: unknown | null;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

function currentResultRef(item: AcceptedAuthorRecord) {
  const accepted = record(item.accepted_record, "accepted author record");
  const artifact = indexerArtifactResultSchema.parse(item.artifact_result);
  return {
    workset_digest: accepted.workset_digest,
    execution_request_digest: accepted.execution_request_digest,
    acceptance_digest: accepted.acceptance_digest,
    artifact_result_digest: artifact.output_digest,
  };
}

function canonicalResultRefs(value: unknown): unknown[] {
  return array(value, "accepted_result_refs")
    .map((item, index) => {
      const ref = record(item, `accepted_result_refs[${index}]`);
      const keys = Object.keys(ref).sort();
      const expected = [
        "acceptance_digest",
        "artifact_result_digest",
        "execution_request_digest",
        "workset_digest",
      ];
      if (
        canonicalIndexerJson(keys) !== canonicalIndexerJson(expected) ||
        expected.some((key) => typeof ref[key] !== "string")
      ) {
        throw new TypeError("accepted_result_refs must contain exact Result identities");
      }
      return ref;
    })
    .sort((left, right) => canonicalIndexerJson(left).localeCompare(canonicalIndexerJson(right)));
}

function renderedByResult(value: unknown): Map<string, unknown[]> {
  const entries = array(value, "rendered_artifacts").map((item, index) => {
    const entry = record(item, `rendered_artifacts[${index}]`);
    if (
      typeof entry.artifact_result_digest !== "string" ||
      !Array.isArray(entry.artifacts) ||
      Object.keys(entry).some((key) =>
        key !== "artifact_result_digest" && key !== "artifacts"
      )
    ) {
      throw new TypeError("rendered_artifacts entries must bind one explicit ArtifactResult");
    }
    return [entry.artifact_result_digest, entry.artifacts] as const;
  });
  const mapped = new Map(entries);
  if (mapped.size !== entries.length) {
    throw new TypeError("rendered_artifacts contains duplicate Result bindings");
  }
  return mapped;
}

export function buildProjectIndexerCandidateCompileFromRecords(input: {
  markdown_projection?: Parameters<typeof buildIndexerCandidateCompile>[0]["markdown_projection"];
  render_cache?: Parameters<typeof buildIndexerCandidateCompile>[0]["render_cache"];
  value: unknown;
  records: readonly AcceptedAuthorRecord[];
  operator_contract: unknown;
  profile_contract: unknown;
}) {
  const value = record(input.value, "Candidate compile input");
  if (value.protocol !== "context.indexer.candidate-compile-input/v1") {
    throw new TypeError("Candidate compile input protocol is invalid");
  }
  const expectedRefs = input.records.map(currentResultRef)
    .sort((left, right) => canonicalIndexerJson(left).localeCompare(canonicalIndexerJson(right)));
  const suppliedRefs = canonicalResultRefs(value.accepted_result_refs);
  if (canonicalIndexerJson(expectedRefs) !== canonicalIndexerJson(suppliedRefs)) {
    throw new TypeError("Candidate compile does not reference the exact current accepted Result set");
  }
  const rendered = renderedByResult(value.rendered_artifacts);
  const acceptedResults: IndexerAcceptedAuthorResultInput[] = input.records.map((item) => {
    const artifact = indexerArtifactResultSchema.parse(item.artifact_result);
    const artifacts = rendered.get(artifact.output_digest) ?? [];
    rendered.delete(artifact.output_digest);
    return {
      run_result: item.run_result,
      accepted_record: item.accepted_record,
      run_envelope: item.run_envelope,
      post_author_envelope: item.post_author_envelope,
      rendered_artifacts: artifacts,
    };
  });
  if (rendered.size > 0) {
    throw new TypeError("Candidate compile contains rendered output for an unaccepted Result");
  }
  return buildIndexerCandidateCompile({
    markdown_projection: input.markdown_projection,
    render_cache: input.render_cache,
    layout_proposal_set: value.layout_proposal_set,
    layout_transition: value.layout_transition,
    layout_change_confirmations: array(
      value.layout_change_confirmations,
      "layout_change_confirmations",
    ),
    accepted_results: acceptedResults,
    profile_contract: input.profile_contract,
    operator_contract: input.operator_contract,
  });
}

function readableArtifactName(outputPath: string, artifactKind: string): string {
  const filename = outputPath.split("/").at(-1)?.replace(/\.md$/iu, "") ?? "";
  const kindSuffix = `-${artifactKind.toLocaleLowerCase()}`;
  const semanticName = filename.toLocaleLowerCase().endsWith(kindSuffix)
    ? filename.slice(0, -kindSuffix.length)
    : filename;
  const words = semanticName.replace(/[-_]+/gu, " ").trim();
  return words.length === 0
    ? artifactKind
    : `${words[0]!.toLocaleUpperCase()}${words.slice(1)}`;
}

export function indexerCandidateTitle(
  markdown: string,
  outputPath: string,
  artifactKind: string,
): string {
  return /^#\s+(.+)$/mu.exec(markdown)?.[1]?.trim() ||
    readableArtifactName(outputPath, artifactKind);
}

export function indexerCandidateSummary(markdown: string, title: string): string {
  const paragraph = markdown
    .split(/\n\s*\n/gu)
    .map((value) => value.trim())
    .find((value) => value.length > 0 && !/^#/u.test(value) && !/^<!--/u.test(value));
  if (paragraph === undefined) return `Knowledge page for ${title}.`;
  const normalized = paragraph.replace(/\s+/gu, " ");
  const sentence = /^.{1,240}?[.!?。！？](?=\s|$)/u.exec(normalized)?.[0];
  if (sentence !== undefined) return sentence;
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239).trimEnd()}…`;
}
