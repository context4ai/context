import {
  releaseEvidenceDigest,
  type ReleasePublishPlan,
} from "./releasePackages.js";

export type NpmRegistryView = (args: readonly string[]) => Promise<string | null>;

export interface ReleaseRegistryPackageSnapshot {
  name: string;
  exact_spec: string;
  exact_version: string | null;
  dist_tags: Record<string, string>;
}

export interface ReleaseRegistrySnapshotReceipt {
  schema: "context.release-registry-snapshot/v1";
  state: "accepted";
  registry: string;
  version: string;
  channel: ReleasePublishPlan["channel"];
  publish_tag: ReleasePublishPlan["publish_tag"];
  captured_at: string;
  packages: ReleaseRegistryPackageSnapshot[];
  receipt_digest: string;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function parseDistTags(output: string | null, packageName: string): Record<string, string> {
  if (output === null) return {};
  const parsed = object(JSON.parse(output), `${packageName} dist-tags`);
  return Object.fromEntries(
    Object.entries(parsed)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tag, version]) => [tag, string(version, `${packageName} ${tag}`)]),
  );
}

function parseExactVersion(output: string | null, exactSpec: string): string | null {
  if (output === null) return null;
  return string(JSON.parse(output), `${exactSpec} version`);
}

export async function captureReleaseRegistryState(input: {
  plan: ReleasePublishPlan;
  registry: string;
  capturedAt: string;
  view: NpmRegistryView;
}): Promise<ReleaseRegistrySnapshotReceipt> {
  if (!Number.isFinite(Date.parse(input.capturedAt))) {
    throw new TypeError("release registry snapshot capturedAt must be an ISO timestamp");
  }
  const packages: ReleaseRegistryPackageSnapshot[] = [];
  for (const pkg of input.plan.packages) {
    const [tagsOutput, versionOutput] = await Promise.all([
      input.view([
        "view",
        pkg.name,
        "dist-tags",
        "--json",
        `--registry=${input.registry}`,
      ]),
      input.view([
        "view",
        pkg.exact_spec,
        "version",
        "--json",
        `--registry=${input.registry}`,
      ]),
    ]);
    const exactVersion = parseExactVersion(versionOutput, pkg.exact_spec);
    if (exactVersion !== null && exactVersion !== input.plan.version) {
      throw new TypeError(
        `${pkg.exact_spec} resolved to unexpected version ${exactVersion}`,
      );
    }
    packages.push({
      name: pkg.name,
      exact_spec: pkg.exact_spec,
      exact_version: exactVersion,
      dist_tags: parseDistTags(tagsOutput, pkg.name),
    });
  }
  const payload = {
    schema: "context.release-registry-snapshot/v1" as const,
    state: "accepted" as const,
    registry: input.registry,
    version: input.plan.version,
    channel: input.plan.channel,
    publish_tag: input.plan.publish_tag,
    captured_at: input.capturedAt,
    packages,
  };
  return { ...payload, receipt_digest: releaseEvidenceDigest(payload) };
}

export function parseReleaseRegistrySnapshotReceipt(
  value: unknown,
  plan: ReleasePublishPlan,
  registry: string,
): ReleaseRegistrySnapshotReceipt {
  const raw = object(value, "release registry snapshot receipt");
  const { receipt_digest: receiptDigest, ...payload } = raw;
  if (
    raw.schema !== "context.release-registry-snapshot/v1" ||
    raw.state !== "accepted" ||
    raw.registry !== registry ||
    raw.version !== plan.version ||
    raw.channel !== plan.channel ||
    raw.publish_tag !== plan.publish_tag ||
    !Number.isFinite(Date.parse(string(raw.captured_at, "registry snapshot captured_at"))) ||
    !Array.isArray(raw.packages) ||
    raw.packages.length !== plan.packages.length
  ) {
    throw new TypeError("release registry snapshot receipt does not match the publish plan");
  }
  for (const [index, expected] of plan.packages.entries()) {
    const pkg = object(raw.packages[index], `registry snapshot package ${index}`);
    if (
      pkg.name !== expected.name ||
      pkg.exact_spec !== expected.exact_spec ||
      (pkg.exact_version !== null && pkg.exact_version !== plan.version)
    ) {
      throw new TypeError("release registry snapshot package does not match the publish plan");
    }
    const tags = object(pkg.dist_tags, `${expected.name} registry snapshot dist-tags`);
    for (const [tag, version] of Object.entries(tags)) {
      string(tag, `${expected.name} dist-tag name`);
      string(version, `${expected.name} ${tag}`);
    }
  }
  if (string(receiptDigest, "release registry snapshot receipt digest") !== releaseEvidenceDigest(payload)) {
    throw new TypeError("release registry snapshot receipt digest is invalid");
  }
  return raw as unknown as ReleaseRegistrySnapshotReceipt;
}
