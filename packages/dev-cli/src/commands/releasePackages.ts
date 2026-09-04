import { createHash } from "node:crypto";
import {
  INDEXER_EVIDENCE_ADAPTER_ABI,
  INDEXER_PARSER_CAPABILITY_SPECS,
  indexerProtocolDigest,
} from "@c4a/context";

export type PackageEntry = { name: string; dir: string };

export type ReleaseChannel = "preview" | "rc" | "latest";
export type ReleasePublishTag = ReleaseChannel;

export interface ReleasePublishPlan {
  schema: "context.release-publish-plan/v1";
  version: string;
  channel: ReleaseChannel;
  publish_tag: ReleasePublishTag;
  packages: Array<{
    name: string;
    directory: string;
    exact_spec: string;
  }>;
}

export type ParserReleasePackageEntry = PackageEntry & {
  capabilities: readonly string[];
  export: string;
};

export const NPM_TRUSTED_PUBLISHER = {
  repository: "context4ai/context",
  workflow: ".github/workflows/publish.yml",
  environment: "npm",
} as const;

export const PARSER_EVIDENCE_ABI = INDEXER_EVIDENCE_ADAPTER_ABI;
export const PARSER_EVIDENCE_ABI_DIGEST = indexerProtocolDigest({
  protocol: PARSER_EVIDENCE_ABI,
});

function canonicalReleaseJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalReleaseJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalReleaseJson(item)}`)
    .join(",")}}`;
}

export function releaseEvidenceDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalReleaseJson(value)).digest("hex")}`;
}

function parserReleasePackages(): ParserReleasePackageEntry[] {
  const packages = new Map<string, ParserReleasePackageEntry>();
  for (const spec of INDEXER_PARSER_CAPABILITY_SPECS) {
    if (!spec.release_metadata) continue;
    const key = `${spec.package}\u0000${spec.export}`;
    const existing = packages.get(key);
    if (existing === undefined) {
      packages.set(key, {
        name: spec.package,
        dir: spec.package.replace(/^@c4a\//u, ""),
        export: spec.export,
        capabilities: [spec.capability],
      });
    } else {
      packages.set(key, {
        ...existing,
        capabilities: [...existing.capabilities, spec.capability].sort(),
      });
    }
  }
  return [...packages.values()];
}

export const PARSER_RELEASE_PACKAGES: readonly ParserReleasePackageEntry[] =
  parserReleasePackages();

export const PUBLISH_PACKAGES: PackageEntry[] = [
  { name: "@c4a/core", dir: "core" },
  { name: "@c4a/context", dir: "context" },
  { name: "@c4a/extract", dir: "extract" },
  { name: "@c4a/extract-ts", dir: "extract-ts" },
  { name: "@c4a/extract-go", dir: "extract-go" },
  { name: "@c4a/extract-rush", dir: "extract-rush" },
  { name: "@c4a/extract-thrift", dir: "extract-thrift" },
  { name: "@c4a/extract-proto", dir: "extract-proto" },
  { name: "@c4a/extract-mdx", dir: "extract-mdx" },
  { name: "@c4a/extract-contract", dir: "extract-contract" },
  { name: "@c4a/extract-style", dir: "extract-style" },
  { name: "@c4a/extract-sql", dir: "extract-sql" },
  { name: "@c4a/context-cli", dir: "context-cli" },
];

const PREVIEW_2_INTRODUCED_PARSER_PACKAGES = new Set([
  "@c4a/extract-thrift",
  "@c4a/extract-proto",
  "@c4a/extract-mdx",
  "@c4a/extract-contract",
  "@c4a/extract-style",
  "@c4a/extract-sql",
]);

export function releaseChannel(version: string): ReleaseChannel {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(preview|rc)\.(\d+))?$/u.exec(version);
  if (match === null) {
    throw new TypeError(
      `Unsupported release version ${version}; only final, preview.N, and rc.N are publishable`,
    );
  }
  const prerelease = match[4];
  if (prerelease === "preview") return "preview";
  if (prerelease === "rc") return "rc";
  return "latest";
}

export function releasePublishPlan(version: string): ReleasePublishPlan {
  const channel = releaseChannel(version);
  const packages = releasePackagesForVersion(version);
  return {
    schema: "context.release-publish-plan/v1",
    version,
    channel,
    publish_tag: channel,
    packages: packages.map((pkg) => ({
      name: pkg.name,
      directory: `packages/${pkg.dir}/dist`,
      exact_spec: `${pkg.name}@${version}`,
    })),
  };
}

export function releasePackagesForVersion(version: string): PackageEntry[] {
  const channel = releaseChannel(version);
  const preview = /-preview\.(\d+)$/u.exec(version);
  const parserReady = channel !== "preview" || Number(preview?.[1] ?? 0) >= 2;
  return PUBLISH_PACKAGES.filter((pkg) =>
    parserReady || !PREVIEW_2_INTRODUCED_PARSER_PACKAGES.has(pkg.name)
  );
}

export function parserReleaseMetadata(version: string): {
  schema: "context.parser-release-metadata/v1";
  version: string;
  registry: "https://registry.npmjs.org";
  abi: typeof PARSER_EVIDENCE_ABI;
  abi_digest: string;
  coordinates: Array<{
    package: string;
    version: string;
    export: string;
    capabilities: readonly string[];
    publisher: typeof NPM_TRUSTED_PUBLISHER;
  }>;
} {
  const published = new Set(
    releasePackagesForVersion(version).map((pkg) => `${pkg.name}\u0000${pkg.dir}`),
  );
  for (const parser of PARSER_RELEASE_PACKAGES) {
    if (!published.has(`${parser.name}\u0000${parser.dir}`)) {
      throw new TypeError(`${parser.name} is missing from the release package allowlist`);
    }
  }
  return {
    schema: "context.parser-release-metadata/v1",
    version,
    registry: "https://registry.npmjs.org",
    abi: PARSER_EVIDENCE_ABI,
    abi_digest: PARSER_EVIDENCE_ABI_DIGEST,
    coordinates: PARSER_RELEASE_PACKAGES.map((parser) => ({
      package: parser.name,
      version,
      export: parser.export,
      capabilities: [...parser.capabilities],
      publisher: NPM_TRUSTED_PUBLISHER,
    })),
  };
}

export function releasePackageDirectories(version?: string): string[] {
  const packages = version === undefined ? PUBLISH_PACKAGES : releasePackagesForVersion(version);
  return packages.map((pkg) => `packages/${pkg.dir}/dist`);
}

export function renderPublishedPackages(version: string): string {
  return [
    "## Published packages",
    "",
    ...releasePackagesForVersion(version).map((pkg) => `- \`${pkg.name}@${version}\``),
  ].join("\n");
}

export function upsertPublishedPackages(
  releaseBody: string,
  version: string,
): string {
  const section = renderPublishedPackages(version);
  const lines = releaseBody.replace(/\r\n/g, "\n").trimEnd().split("\n");
  const start = lines.findIndex((line) => line.trim() === "## Published packages");

  if (start < 0) {
    const body = lines.join("\n").trim();
    return body ? `${body}\n\n${section}\n` : `${section}\n`;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index]!.trim())) {
      end = index;
      break;
    }
  }

  const before = lines.slice(0, start);
  const after = lines.slice(end);
  return [...before, section, ...after].join("\n").trimEnd() + "\n";
}
