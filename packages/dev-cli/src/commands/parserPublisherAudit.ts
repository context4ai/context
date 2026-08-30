import { createHash } from "node:crypto";
import { z } from "zod";
import {
  NPM_TRUSTED_PUBLISHER,
  parserReleaseMetadata,
} from "./releasePackages.js";

const publisherSchema = z.object({
  repository: z.literal(NPM_TRUSTED_PUBLISHER.repository),
  workflow: z.literal(NPM_TRUSTED_PUBLISHER.workflow),
  environment: z.literal(NPM_TRUSTED_PUBLISHER.environment),
}).strict();

const confirmationSchema = z.object({
  package: z.string().min(1),
  publisher: publisherSchema,
  confirmed_at: z.string().datetime({ offset: true }),
  confirmation_ref: z.string().min(1),
}).strict();

export const parserPublisherReceiptsSchema = z.object({
  schema: z.literal("context.parser-publisher-receipts/v1"),
  preview_version: z.string().regex(/^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/u),
  confirmations: z.array(confirmationSchema),
}).strict();

export type ParserPublisherReceipts = z.infer<typeof parserPublisherReceiptsSchema>;

interface RegistryPackageVersion {
  name?: string;
  version?: string;
  dist?: {
    integrity?: string;
    attestations?: { url?: string; provenance?: { predicateType?: string } };
  };
}

interface AttestationResponse {
  attestations?: Array<{
    predicateType?: string;
    bundle?: { dsseEnvelope?: { payload?: string } };
  }>;
}

interface ProvenanceStatement {
  subject?: Array<{ name?: string; digest?: { sha512?: string } }>;
  predicateType?: string;
  predicate?: {
    buildDefinition?: {
      externalParameters?: {
        workflow?: { ref?: string; repository?: string; path?: string };
      };
      resolvedDependencies?: Array<{ uri?: string; digest?: { gitCommit?: string } }>;
    };
    runDetails?: { metadata?: { invocationId?: string } };
  };
}

export interface ParserPublisherAuditResult {
  schema: "context.parser-publisher-audit/v1";
  state: "ready";
  preview_version: string;
  publisher: typeof NPM_TRUSTED_PUBLISHER;
  packages: Array<{
    package: string;
    version: string;
    integrity: string;
    provenance_url: string;
    invocation_id: string;
    source_commit: string;
  }>;
  audit_digest: string;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function packageMetadataUrl(registry: string, packageName: string, version: string): string {
  const encodedName = encodeURIComponent(packageName);
  return `${registry.replace(/\/$/u, "")}/${encodedName}/${encodeURIComponent(version)}`;
}

function expectedPackagePurl(packageName: string, version: string): string {
  const encodedName = packageName.startsWith("@")
    ? `%40${packageName.slice(1).replace("/", "/")}`
    : packageName;
  return `pkg:npm/${encodedName}@${version}`;
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new TypeError(`registry request failed (${response.status}): ${url}`);
  }
  return response.json();
}

function decodeProvenance(response: AttestationResponse): ProvenanceStatement {
  const attestation = response.attestations?.find(
    (item) => item.predicateType === "https://slsa.dev/provenance/v1",
  );
  const encoded = attestation?.bundle?.dsseEnvelope?.payload;
  if (encoded === undefined) throw new TypeError("SLSA provenance attestation is missing");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as ProvenanceStatement;
}

function integrityHex(integrity: string): string {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/u.exec(integrity);
  if (match === null) throw new TypeError("registry package lacks sha512 integrity");
  return Buffer.from(match[1]!, "base64").toString("hex");
}

function validateProvenance(input: {
  packageName: string;
  version: string;
  integrity: string;
  statement: ProvenanceStatement;
}): { invocationId: string; sourceCommit: string } {
  const workflow = input.statement.predicate?.buildDefinition?.externalParameters?.workflow;
  if (
    input.statement.predicateType !== "https://slsa.dev/provenance/v1" ||
    workflow?.repository !== `https://github.com/${NPM_TRUSTED_PUBLISHER.repository}` ||
    workflow.path !== NPM_TRUSTED_PUBLISHER.workflow ||
    workflow.ref !== `refs/tags/v${input.version}`
  ) {
    throw new TypeError(`${input.packageName}@${input.version} provenance has the wrong repository, workflow, or ref`);
  }
  const subject = input.statement.subject?.find(
    (item) => item.name === expectedPackagePurl(input.packageName, input.version),
  );
  if (subject?.digest?.sha512 !== integrityHex(input.integrity)) {
    throw new TypeError(`${input.packageName}@${input.version} provenance subject digest is invalid`);
  }
  const dependency = input.statement.predicate?.buildDefinition?.resolvedDependencies?.find(
    (item) => item.uri === `git+https://github.com/${NPM_TRUSTED_PUBLISHER.repository}@refs/tags/v${input.version}`,
  );
  const sourceCommit = dependency?.digest?.gitCommit;
  const invocationId = input.statement.predicate?.runDetails?.metadata?.invocationId;
  if (!sourceCommit?.match(/^[a-f0-9]{40}$/u) || !invocationId?.startsWith("https://github.com/")) {
    throw new TypeError(`${input.packageName}@${input.version} provenance lacks source commit or invocation identity`);
  }
  return { invocationId, sourceCommit };
}

export async function auditParserPublisherReadiness(input: {
  releaseVersion: string;
  receipts: unknown;
  fetchImpl?: typeof fetch;
  registry?: string;
}): Promise<ParserPublisherAuditResult> {
  const receipts = parserPublisherReceiptsSchema.parse(input.receipts);
  const metadata = parserReleaseMetadata(input.releaseVersion);
  const expectedPackages = metadata.coordinates.map((coordinate) => coordinate.package);
  const confirmations = new Map<string, z.infer<typeof confirmationSchema>>();
  for (const confirmation of receipts.confirmations) {
    if (confirmations.has(confirmation.package)) {
      throw new TypeError(`duplicate Trusted Publisher confirmation for ${confirmation.package}`);
    }
    confirmations.set(confirmation.package, confirmation);
  }
  const unexpected = [...confirmations.keys()].filter((name) => !expectedPackages.includes(name));
  if (unexpected.length > 0) throw new TypeError(`unexpected parser publisher confirmation: ${unexpected.join(", ")}`);
  for (const packageName of expectedPackages) {
    if (!confirmations.has(packageName)) {
      throw new TypeError(`missing Trusted Publisher confirmation for ${packageName}`);
    }
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const registry = (input.registry ?? metadata.registry).replace(/\/$/u, "");
  const packages = [];
  for (const packageName of expectedPackages) {
    const packageValue = await fetchJson(
      fetchImpl,
      packageMetadataUrl(registry, packageName, receipts.preview_version),
    ) as RegistryPackageVersion;
    if (packageValue.name !== packageName || packageValue.version !== receipts.preview_version) {
      throw new TypeError(`${packageName} preview coordinate did not resolve exactly`);
    }
    const integrity = packageValue.dist?.integrity;
    const provenanceUrl = packageValue.dist?.attestations?.url;
    if (
      integrity === undefined ||
      provenanceUrl === undefined ||
      packageValue.dist?.attestations?.provenance?.predicateType !== "https://slsa.dev/provenance/v1"
    ) {
      throw new TypeError(`${packageName}@${receipts.preview_version} lacks npm provenance metadata`);
    }
    const provenance = decodeProvenance(
      await fetchJson(fetchImpl, provenanceUrl) as AttestationResponse,
    );
    const verified = validateProvenance({
      packageName,
      version: receipts.preview_version,
      integrity,
      statement: provenance,
    });
    packages.push({
      package: packageName,
      version: receipts.preview_version,
      integrity,
      provenance_url: provenanceUrl,
      invocation_id: verified.invocationId,
      source_commit: verified.sourceCommit,
    });
  }
  const payload = {
    schema: "context.parser-publisher-audit/v1" as const,
    state: "ready" as const,
    preview_version: receipts.preview_version,
    publisher: NPM_TRUSTED_PUBLISHER,
    packages,
  };
  return { ...payload, audit_digest: sha256(payload) };
}
