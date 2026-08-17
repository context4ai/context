#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildProviderBundle, loadProvider } from "@c4a/agent-graph";

const packageRoot = resolve(import.meta.dir, "..");
const packageJson = JSON.parse(
  await readFile(resolve(packageRoot, "package.json"), "utf8"),
) as { version: string };
const providerPath = resolve(packageRoot, "context-workflow", "provider.yaml");
const outputPath = resolve(packageRoot, "dist", "providers", "context");
const provider = await loadProvider(providerPath);

if (provider.manifest.version !== packageJson.version) {
  throw new Error(
    `Context workflow Provider version ${provider.manifest.version} does not match @c4a/context-cli ${packageJson.version}`,
  );
}

const manifest = await buildProviderBundle(provider, outputPath);
process.stdout.write(
  `  Context workflow → dist/providers/context/ (${manifest.files.length} files · ${manifest.digest})\n`,
);
