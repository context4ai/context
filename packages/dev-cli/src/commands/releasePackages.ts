export type PackageEntry = { name: string; dir: string };

export const PUBLISH_PACKAGES: PackageEntry[] = [
  { name: "@c4a/core", dir: "core" },
  { name: "@c4a/context", dir: "context" },
  { name: "@c4a/extract", dir: "extract" },
  { name: "@c4a/extract-ts", dir: "extract-ts" },
  { name: "@c4a/extract-go", dir: "extract-go" },
  { name: "@c4a/extract-rush", dir: "extract-rush" },
  { name: "@c4a/context-cli", dir: "context-cli" },
];

export function releasePackageDirectories(): string[] {
  return PUBLISH_PACKAGES.map((pkg) => `packages/${pkg.dir}/dist`);
}

export function renderPublishedPackages(version: string): string {
  return [
    "## Published packages",
    "",
    ...PUBLISH_PACKAGES.map((pkg) => `- \`${pkg.name}@${version}\``),
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
