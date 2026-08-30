import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { auditParserPublisherReadiness } from "../commands/parserPublisherAudit.js";
import {
  NPM_TRUSTED_PUBLISHER,
  PARSER_RELEASE_PACKAGES,
} from "../commands/releasePackages.js";

const VERSION = "0.7.0-preview.2";
const COMMIT = "a".repeat(40);

function receipts() {
  return {
    schema: "context.parser-publisher-receipts/v1",
    preview_version: VERSION,
    confirmations: PARSER_RELEASE_PACKAGES.map((pkg) => ({
      package: pkg.name,
      publisher: NPM_TRUSTED_PUBLISHER,
      confirmed_at: "2026-08-29T01:00:00.000Z",
      confirmation_ref: `npm-settings:${pkg.name}`,
    })),
  };
}

function registryFixture(options: { workflow?: string } = {}): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://registry.test/attestations/")) {
      const packageName = decodeURIComponent(url.slice("https://registry.test/attestations/".length));
      const bytes = Buffer.from(`archive:${packageName}`);
      const statement = {
        _type: "https://in-toto.io/Statement/v1",
        subject: [{
          name: `pkg:npm/%40${packageName.slice(1)}@${VERSION}`,
          digest: { sha512: createHash("sha512").update(bytes).digest("hex") },
        }],
        predicateType: "https://slsa.dev/provenance/v1",
        predicate: {
          buildDefinition: {
            externalParameters: {
              workflow: {
                ref: `refs/tags/v${VERSION}`,
                repository: "https://github.com/context4ai/context",
                path: options.workflow ?? ".github/workflows/publish.yml",
              },
            },
            resolvedDependencies: [{
              uri: `git+https://github.com/context4ai/context@refs/tags/v${VERSION}`,
              digest: { gitCommit: COMMIT },
            }],
          },
          runDetails: {
            metadata: {
              invocationId: "https://github.com/context4ai/context/actions/runs/1/attempts/1",
            },
          },
        },
      };
      return new Response(JSON.stringify({
        attestations: [{
          predicateType: "https://slsa.dev/provenance/v1",
          bundle: {
            dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString("base64") },
          },
        }],
      }), { status: 200 });
    }
    const match = /^https:\/\/registry\.test\/(.+)\/0\.7\.0-preview\.2$/u.exec(url);
    if (match === null) return new Response("not found", { status: 404 });
    const packageName = decodeURIComponent(match[1]!);
    const bytes = Buffer.from(`archive:${packageName}`);
    return new Response(JSON.stringify({
      name: packageName,
      version: VERSION,
      dist: {
        integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
        attestations: {
          url: `https://registry.test/attestations/${encodeURIComponent(packageName)}`,
          provenance: { predicateType: "https://slsa.dev/provenance/v1" },
        },
      },
    }), { status: 200 });
  }) as typeof fetch;
}

describe("parser publisher readiness audit", () => {
  test("closes every parser coordinate against publisher confirmation and npm provenance", async () => {
    const result = await auditParserPublisherReadiness({
      releaseVersion: VERSION,
      receipts: receipts(),
      fetchImpl: registryFixture(),
      registry: "https://registry.test",
    });

    expect(result.state).toBe("ready");
    expect(result.packages.map((item) => item.package)).toEqual(
      PARSER_RELEASE_PACKAGES.map((pkg) => pkg.name),
    );
    expect(result.packages.every((item) => item.source_commit === COMMIT)).toBe(true);
    expect(result.audit_digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  test("rejects missing confirmations and provenance from another workflow", async () => {
    const missing = receipts();
    missing.confirmations.pop();
    await expect(auditParserPublisherReadiness({
      releaseVersion: VERSION,
      receipts: missing,
      fetchImpl: registryFixture(),
      registry: "https://registry.test",
    })).rejects.toThrow(/missing Trusted Publisher confirmation/);

    await expect(auditParserPublisherReadiness({
      releaseVersion: VERSION,
      receipts: receipts(),
      fetchImpl: registryFixture({ workflow: ".github/workflows/other.yml" }),
      registry: "https://registry.test",
    })).rejects.toThrow(/wrong repository, workflow, or ref/);
  });
});
