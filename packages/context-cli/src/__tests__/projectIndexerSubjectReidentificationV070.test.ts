import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalIndexerNodeRef,
  indexerResolvedSubjectKeySchemaDigest,
  indexerSubjectKeySchemaDigest,
  type IndexerResolvedSubjectKeySchema,
  type IndexerSubjectKey,
  type IndexerSubjectKeyContract,
} from "@c4a/context";
import { runCliInDir } from "./projectBuildVerifyV060Helpers.js";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

const OLD_CONTRACT: IndexerSubjectKeyContract = {
  version: 1,
  namespace: { operator: "canonical-source-module-namespace" },
  kinds: [{
    id: "application",
    local_key: { operator: "canonical-module-identity" },
  }],
  normalization: ["trim", "unicode-nfc", "preserve-case"],
};

const NEW_CONTRACT: IndexerSubjectKeyContract = {
  ...OLD_CONTRACT,
  version: 2,
  namespace: { operator: "canonical-service-namespace" },
};

const OLD_SUBJECT: IndexerSubjectKey = {
  protocol: "context.subject-key/v1",
  namespace: "example/app",
  kind: "application",
  local_key: "main",
};

const NEW_SUBJECT: IndexerSubjectKey = {
  ...OLD_SUBJECT,
  namespace: "service/example-app",
};

function resolved(
  schema: IndexerSubjectKeyContract,
  providerVersion: string,
): IndexerResolvedSubjectKeySchema {
  const profile = "example/framework-application";
  const payload: Omit<IndexerResolvedSubjectKeySchema, "resolved_digest"> = {
    protocol: "context.indexer.resolved-subject-key-schema/v1",
    indexer_id: "workspace-code",
    profile,
    authority: {
      kind: "provider-extension",
      extends: "component-library",
      provider_layer_id: "framework",
      provider_id: "example-indexer",
      provider_version: providerVersion,
      provider_integrity: digest("a"),
      manifest_digest: digest("b"),
    },
    schema,
    schema_digest: indexerSubjectKeySchemaDigest(profile, schema),
  };
  return {
    ...payload,
    resolved_digest: indexerResolvedSubjectKeySchemaDigest(payload),
  };
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "context-subject-reidentification-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({
    name: "subject-reidentification-fixture",
    private: true,
    context: { project: true, entry: "src/index.ts" },
  }, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src", "index.ts"), "export {};\n", "utf8");
  return root;
}

async function payload(root: string, name: string, value: unknown): Promise<string> {
  const path = join(root, `${name}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

async function run(root: string, command: string, value: unknown) {
  const path = await payload(root, command, value);
  return JSON.parse(await runCliInDir(root, [
    "indexer", command, "--input", path, "--format", "json",
  ]));
}

describe("project SubjectKey re-identification Actions", () => {
  test("requires and consumes one exact human authorization", async () => {
    const root = await project();
    const transition = {
      project_ref: "project:example",
      old_schema: resolved(OLD_CONTRACT, "1.2.0"),
      new_schema: resolved(NEW_CONTRACT, "2.0.0"),
      approved_subjects: [{
        node_ref: canonicalIndexerNodeRef(OLD_SUBJECT),
        subject_key: OLD_SUBJECT,
      }],
      proposed_mappings: [{
        old_node_ref: canonicalIndexerNodeRef(OLD_SUBJECT),
        new_subject_key: NEW_SUBJECT,
      }],
    };
    const required = await run(root, "validate-subject-key-schemas", {
      protocol: "context.indexer.subject-key-validation-input/v1",
      ...transition,
    });
    expect(required).toMatchObject({
      outcome: "index-subject-reidentification-required",
      graph_outcome: "blocked",
      report: {
        classification: "identity-breaking",
        activation_allowed: true,
        gate_required: true,
      },
    });

    const confirmed = await run(root, "confirm-subject-reidentification", {
      protocol: "context.indexer.subject-reidentification-confirmation-input/v1",
      ...transition,
      report: required.report,
      authorized_by: "human:reviewer",
      authorized_at: "2026-08-28T08:00:00.000Z",
    });
    expect(confirmed.authorization).toMatchObject({
      non_delegable: true,
      project_ref: "project:example",
      report_digest: required.report.report_digest,
    });

    const current = await run(root, "validate-subject-key-schemas", {
      protocol: "context.indexer.subject-key-validation-input/v1",
      ...transition,
      report: required.report,
      authorization: confirmed.authorization,
    });
    expect(current).toMatchObject({
      outcome: "subject-key-schema-current",
      graph_outcome: "completed",
      authorization_digest: confirmed.authorization.authorization_digest,
    });
  });

  test("blocks an incomplete mapping before the Gate", async () => {
    const root = await project();
    const result = await run(root, "validate-subject-key-schemas", {
      protocol: "context.indexer.subject-key-validation-input/v1",
      project_ref: "project:example",
      old_schema: resolved(OLD_CONTRACT, "1.2.0"),
      new_schema: resolved(NEW_CONTRACT, "2.0.0"),
      approved_subjects: [{
        node_ref: canonicalIndexerNodeRef(OLD_SUBJECT),
        subject_key: OLD_SUBJECT,
      }],
      proposed_mappings: [],
    });
    expect(result).toMatchObject({
      outcome: "index-subject-reidentification-invalid",
      graph_outcome: "failed",
      report: {
        activation_allowed: false,
        issues: ["missing-mapping"],
      },
    });
  });
});
