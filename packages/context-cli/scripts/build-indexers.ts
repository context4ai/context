#!/usr/bin/env bun

import { resolve } from "node:path";
import { materializeBundledIndexerDistribution } from "../src/project/indexerDistributionBuild.js";

const packageRoot = resolve(import.meta.dir, "..");
const manifest = await materializeBundledIndexerDistribution({
  packageRoot,
  outputRoot: resolve(packageRoot, "dist", "indexers"),
});

process.stdout.write(
  `  Indexers → dist/indexers/ (${manifest.bundles.length} Bundles · contract + release manifest)\n`,
);
