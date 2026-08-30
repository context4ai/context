import {
  releaseEvidenceDigest,
  type ReleasePublishPlan,
} from "./releasePackages.js";
import {
  parseReleaseRegistrySnapshotReceipt,
} from "./releaseRegistrySnapshot.js";

export type NpmRegistryRunner = (args: readonly string[]) => Promise<string>;

interface ReleaseInstallSmokeReceipt {
  schema: "context.release-install-smoke/v1";
  state: "accepted";
  registry: string;
  version: string;
  channel: string;
  packages: string[];
  capability_manifest_digest: string;
  catalog_skills: string[];
  forward: {
    installed: Array<{ name: string; version: string }>;
    graph: { input_digest: string; output_digest: string };
    parsers: Array<{ package: string; disposition: string; result_digest: string }>;
  };
  receipt_digest: string;
}

export interface ReleasePromotionReceipt {
  schema: "context.release-dist-tag-promotion/v1";
  state: "accepted" | "not-required";
  registry: string;
  version: string;
  publish_tag: string;
  promotion_tag: "latest" | null;
  promoted_packages: string[];
  previous_latest: Record<string, string | null>;
  install_smoke_receipt_digest: string;
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

function parseInstallSmokeReceipt(
  value: unknown,
  plan: ReleasePublishPlan,
  registry: string,
): ReleaseInstallSmokeReceipt {
  const raw = object(value, "release install smoke receipt");
  const { receipt_digest: receiptDigest, ...payload } = raw;
  if (
    raw.schema !== "context.release-install-smoke/v1" ||
    raw.state !== "accepted" ||
    raw.registry !== registry ||
    raw.version !== plan.version ||
    raw.channel !== plan.channel ||
    !Array.isArray(raw.packages) ||
    !Array.isArray(raw.catalog_skills)
  ) {
    throw new TypeError("release install smoke receipt does not match the publish plan");
  }
  const expectedPackages = plan.packages.map((pkg) => pkg.exact_spec);
  if (
    raw.packages.length !== expectedPackages.length ||
    raw.packages.some((item, index) => item !== expectedPackages[index])
  ) {
    throw new TypeError("release install smoke receipt does not cover every exact package");
  }
  if (
    string(receiptDigest, "release install smoke receipt digest") !==
      releaseEvidenceDigest(payload)
  ) {
    throw new TypeError("release install smoke receipt digest is invalid");
  }
  const forward = object(raw.forward, "release install smoke forward result");
  const graph = object(forward.graph, "release install smoke graph result");
  const expectedParserCount = inputParserPackageCount(plan);
  if (
    !Array.isArray(forward.installed) ||
    forward.installed.length !== plan.packages.length ||
    !Array.isArray(forward.parsers) ||
    forward.parsers.length !== expectedParserCount ||
    !/^sha256:[a-f0-9]{64}$/u.test(string(graph.input_digest, "graph input digest")) ||
    !/^sha256:[a-f0-9]{64}$/u.test(string(graph.output_digest, "graph output digest")) ||
    !/^sha256:[a-f0-9]{64}$/u.test(
      string(raw.capability_manifest_digest, "capability manifest digest"),
    )
  ) {
    throw new TypeError("release install smoke receipt lacks Graph, parser, or package evidence");
  }
  return raw as unknown as ReleaseInstallSmokeReceipt;
}

function inputParserPackageCount(plan: ReleasePublishPlan): number {
  return plan.packages.filter((pkg) =>
    pkg.name === "@c4a/extract-thrift" ||
    pkg.name === "@c4a/extract-proto" ||
    pkg.name === "@c4a/extract-mdx" ||
    pkg.name === "@c4a/extract-contract" ||
    pkg.name === "@c4a/extract-style" ||
    pkg.name === "@c4a/extract-sql"
  ).length;
}

async function readDistTags(
  packageName: string,
  registry: string,
  run: NpmRegistryRunner,
): Promise<Record<string, string>> {
  const output = await run([
    "view",
    packageName,
    "dist-tags",
    "--json",
    `--registry=${registry}`,
  ]);
  const parsed = object(JSON.parse(output), `${packageName} dist-tags`);
  return Object.fromEntries(
    Object.entries(parsed).map(([tag, value]) => [tag, string(value, `${packageName} ${tag}`)]),
  );
}

async function rollbackLatest(input: {
  packageNames: readonly string[];
  previousLatest: Readonly<Record<string, string | null>>;
  registry: string;
  run: NpmRegistryRunner;
}): Promise<void> {
  const failures: string[] = [];
  for (const packageName of [...input.packageNames].reverse()) {
    try {
      const previous = input.previousLatest[packageName];
      if (previous === null) {
        await input.run([
          "dist-tag",
          "rm",
          packageName,
          "latest",
          `--registry=${input.registry}`,
        ]);
      } else {
        await input.run([
          "dist-tag",
          "add",
          `${packageName}@${previous}`,
          "latest",
          `--registry=${input.registry}`,
        ]);
      }
    } catch (error) {
      failures.push(`${packageName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`release dist-tag rollback failed: ${failures.join("; ")}`);
  }
}

export async function promoteReleaseDistTags(input: {
  plan: ReleasePublishPlan;
  installSmokeReceipt: unknown;
  registrySnapshotReceipt: unknown;
  registry: string;
  run: NpmRegistryRunner;
}): Promise<ReleasePromotionReceipt> {
  const smoke = parseInstallSmokeReceipt(
    input.installSmokeReceipt,
    input.plan,
    input.registry,
  );
  const registrySnapshot = parseReleaseRegistrySnapshotReceipt(
    input.registrySnapshotReceipt,
    input.plan,
    input.registry,
  );
  const previousLatest: Record<string, string | null> = {};
  const promotedPackages: string[] = [];
  if (input.plan.promotion_tag === "latest") {
    for (const pkg of registrySnapshot.packages) {
      previousLatest[pkg.name] = pkg.dist_tags.latest ?? null;
    }
    try {
      for (const pkg of input.plan.packages) {
        await input.run([
          "dist-tag",
          "add",
          pkg.exact_spec,
          "latest",
          `--registry=${input.registry}`,
        ]);
        promotedPackages.push(pkg.name);
      }
      for (const pkg of input.plan.packages) {
        const tags = await readDistTags(pkg.name, input.registry, input.run);
        if (tags.latest !== input.plan.version) {
          throw new Error(`${pkg.name} latest resolved to ${String(tags.latest)}`);
        }
      }
    } catch (error) {
      try {
        await rollbackLatest({
          packageNames: promotedPackages,
          previousLatest,
          registry: input.registry,
          run: input.run,
        });
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "release dist-tag promotion and rollback both failed",
        );
      }
      throw error;
    }
  }
  const payload = {
    schema: "context.release-dist-tag-promotion/v1" as const,
    state: input.plan.promotion_tag === null ? "not-required" as const : "accepted" as const,
    registry: input.registry,
    version: input.plan.version,
    publish_tag: input.plan.publish_tag,
    promotion_tag: input.plan.promotion_tag,
    promoted_packages: promotedPackages,
    previous_latest: previousLatest,
    install_smoke_receipt_digest: smoke.receipt_digest,
  };
  return { ...payload, receipt_digest: releaseEvidenceDigest(payload) };
}
