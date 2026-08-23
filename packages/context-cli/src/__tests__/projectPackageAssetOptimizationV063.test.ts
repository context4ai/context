import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PackageDefinition } from "@c4a/context";
import type { PackageAssetFile } from "../project/packageAssets.js";
import { packageAssetDeliveryFingerprintInput } from "../project/packageAssetDelivery.js";
import { writeSelectedPackageKnowledge } from "../project/packageBuildContent.js";
import {
  isOptimizablePackageImage,
  optimizePackageAssetFiles,
  resolvePackageImageProcessor,
  type PackageImageProcessor,
} from "../project/packageAssetOptimization.js";

function pngBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 8));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

function webpBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(size, 12));
  bytes.set(Buffer.from("RIFF", "ascii"), 0);
  bytes.set(Buffer.from("WEBP", "ascii"), 8);
  return bytes;
}

function imageAsset(name: string, size: number): PackageAssetFile {
  return {
    knowledgeRelPath: `knowledge/assets/image/${name}.png`,
    packageRelPath: `others/assets/image/${name}.png`,
    bytes: pngBytes(size),
  };
}

describe("package asset image budgets", () => {
  test("compresses only when the default single-image budget is exceeded", async () => {
    const asset = imageAsset("example", 24);
    expect(isOptimizablePackageImage(asset)).toBe(true);
    const optimized = await optimizePackageAssetFiles({
      projectRoot: "/workspace",
      assets: [asset],
      maxImageBytes: 20,
      maxTotalImageBytes: 100,
      processor: { optimize: async () => webpBytes(12) },
    });
    expect(optimized.summary).toEqual({
      state: "applied",
      candidateFiles: 1,
      originalBytes: 24,
      outputBytes: 12,
      savedBytes: 12,
      maxImageBytes: 20,
      maxTotalImageBytes: 100,
      largestOutputBytes: 12,
      processor: "sharp",
      mode: "webp",
    });
    expect(optimized.assets[0]?.packageRelPath).toEndWith(".webp");

    const below = await optimizePackageAssetFiles({
      projectRoot: "/workspace",
      assets: [asset],
      maxImageBytes: 24,
      maxTotalImageBytes: 100,
    });
    expect(below.summary.state).toBe("not-needed");
  });

  test("compresses multiple images to the total budget and blocks impossible output", async () => {
    const images = [imageAsset("one", 30), imageAsset("two", 30)];
    const result = await optimizePackageAssetFiles({
      projectRoot: "/workspace",
      assets: images,
      maxImageBytes: 100,
      maxTotalImageBytes: 40,
      processor: { optimize: async () => webpBytes(15) },
    });
    expect(result.summary).toMatchObject({
      state: "applied",
      outputBytes: 30,
      maxTotalImageBytes: 40,
      largestOutputBytes: 15,
    });

    await expect(optimizePackageAssetFiles({
      projectRoot: "/workspace",
      assets: images,
      maxImageBytes: 100,
      maxTotalImageBytes: 40,
      processor: { optimize: async (bytes) => webpBytes(bytes.byteLength) },
    })).rejects.toMatchObject({
      detail: { reason_code: "package.assets.image-budget-exceeded" },
    });
  });

  test("uses a configured processor, content-addresses smaller output, and keeps other files", async () => {
    const image = imageAsset("source", 64);
    const csv: PackageAssetFile = {
      knowledgeRelPath: "knowledge/assets/sheet/data.csv",
      packageRelPath: "others/assets/sheet/data.csv",
      bytes: Buffer.from("a,b\n1,2\n", "utf8"),
    };
    const output = webpBytes(24);
    const processor: PackageImageProcessor = {
      optimize: async () => output,
    };
    const result = await optimizePackageAssetFiles({
      projectRoot: "/workspace",
      assets: [image, csv],
      definition: { processor: "sharp", mode: "lossless-webp" },
      processor,
    });
    const digest = createHash("sha256").update(output).digest("hex");
    expect(result.assets.map((asset) => asset.packageRelPath)).toEqual([
      `others/assets/image/${digest}.webp`,
      csv.packageRelPath,
    ]);
    expect(result.optimizedTargetByOriginal.get(image.packageRelPath)).toBe(
      `others/assets/image/${digest}.webp`,
    );
    expect(result.summary).toMatchObject({
      state: "applied",
      candidateFiles: 1,
      originalBytes: 64,
      outputBytes: 24,
      savedBytes: 40,
      processor: "sharp",
      mode: "lossless-webp",
    });
  });

  test("keeps the original when conversion is not smaller and rejects invalid output", async () => {
    const image = imageAsset("source", 32);
    const larger = await optimizePackageAssetFiles({
      projectRoot: "/workspace",
      assets: [image],
      definition: { processor: "sharp", mode: "webp", quality: 90 },
      processor: { optimize: async () => webpBytes(40) },
    });
    expect(larger.summary.state).toBe("configured-no-benefit");
    expect(larger.assets[0]?.packageRelPath).toBe(image.packageRelPath);

    await expect(optimizePackageAssetFiles({
      projectRoot: "/workspace",
      assets: [image],
      definition: { processor: "sharp", mode: "lossless-webp" },
      processor: { optimize: async () => Buffer.from("not-webp", "utf8") },
    })).rejects.toMatchObject({
      detail: { reason_code: "package.assets.optimizer-output-invalid" },
    });
  });

  test("rewrites package Markdown to the optimized content-addressed resource", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-package-assets-"));
    try {
      const sourceName = "source.png";
      const knowledgeAsset = join(projectRoot, "knowledge", "assets", "image", sourceName);
      await mkdir(dirname(knowledgeAsset), { recursive: true });
      await writeFile(knowledgeAsset, pngBytes(64));
      const content = `# Example\n\n![Diagram](../assets/image/${sourceName})\n`;
      const pagePath = join(projectRoot, "knowledge", "guides", "example.md");
      await mkdir(dirname(pagePath), { recursive: true });
      await writeFile(pagePath, content, "utf8");
      const pkg = {
        kind: "package.kb",
        name: "example-kb",
        outDir: "dist/example-kb",
        reads: [],
        writes: [],
        template: { path: "src/package-templates/kb", vars: {} },
        navigation: { foldDirectoryIndexes: true, maxInlineEntries: 50 },
        assets: { delivery: "bundle", optimize: { processor: "sharp", mode: "lossless-webp" } },
      } as PackageDefinition;
      const optimizedBytes = webpBytes(24);
      const written = await writeSelectedPackageKnowledge({
        projectRoot,
        pkg,
        files: [{ relPath: "guides/example.md", absPath: pagePath, content }],
        assetProcessor: { optimize: async () => optimizedBytes },
      });
      const digest = createHash("sha256").update(optimizedBytes).digest("hex");
      const outputPage = await readFile(
        join(projectRoot, "dist", "example-kb", "guides", "example.md"),
        "utf8",
      );
      expect(outputPage).toContain(`../others/assets/image/${digest}.webp`);
      expect(Buffer.from(await readFile(
        join(projectRoot, "dist", "example-kb", "others", "assets", "image", `${digest}.webp`),
      ))).toEqual(Buffer.from(optimizedBytes));
      expect(written.assetDelivery.optimization?.savedBytes).toBe(40);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("resolves the CLI-owned processor without a workspace dependency", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-package-processor-"));
    try {
      await writeFile(join(projectRoot, "package.json"), "{}\n", "utf8");
      expect(await resolvePackageImageProcessor(projectRoot, {
        delivery: "bundle",
        optimize: { processor: "sharp", mode: "lossless-webp" },
      })).toBeDefined();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("publishes Git raw links without taking ownership of author commits", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-package-git-assets-"));
    try {
      const assetPath = join(projectRoot, "knowledge", "assets", "image", "diagram.png");
      const pagePath = join(projectRoot, "knowledge", "guides", "example.md");
      await mkdir(dirname(assetPath), { recursive: true });
      await mkdir(dirname(pagePath), { recursive: true });
      await writeFile(assetPath, pngBytes(64));
      const content = "# Example\n\n![Diagram](../assets/image/diagram.png)\n";
      await writeFile(pagePath, content, "utf8");
      execFileSync("git", ["init"], { cwd: projectRoot });
      execFileSync("git", ["config", "user.email", "context@example.test"], { cwd: projectRoot });
      execFileSync("git", ["config", "user.name", "Context Test"], { cwd: projectRoot });
      execFileSync("git", ["add", "knowledge"], { cwd: projectRoot });
      execFileSync("git", ["commit", "-m", "add knowledge"], { cwd: projectRoot });
      execFileSync("git", ["remote", "add", "origin", "git@github.com:example/context-kb.git"], { cwd: projectRoot });
      const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
      const pkg = {
        kind: "package.kb",
        name: "example-kb",
        outDir: "dist/example-kb",
        reads: [],
        writes: [],
        template: { path: "src/package-templates/kb", vars: {} },
        navigation: { foldDirectoryIndexes: true, maxInlineEntries: 50 },
        assets: { delivery: "git-raw" },
      } as PackageDefinition;
      const written = await writeSelectedPackageKnowledge({
        projectRoot,
        pkg,
        files: [{ relPath: "guides/example.md", absPath: pagePath, content }],
      });
      const outputPage = await readFile(join(projectRoot, "dist", "example-kb", "guides", "example.md"), "utf8");
      expect(outputPage).toContain(
        `https://raw.githubusercontent.com/example/context-kb/${commit}/knowledge/assets/image/diagram.png`,
      );
      expect(written).toMatchObject({
        resources: 0,
        resourceBytes: 0,
        assetDelivery: { state: "git-raw", sourceFiles: 1, outputFiles: 0 },
      });

      const prefixed = await writeSelectedPackageKnowledge({
        projectRoot,
        pkg: {
          ...pkg,
          assets: {
            delivery: "git-raw",
            urlPrefix: "https://code.example.test/org/repo/raw/published-assets",
          },
        } as PackageDefinition,
        files: [{ relPath: "guides/example.md", absPath: pagePath, content }],
      });
      expect(prefixed.assetDelivery.git?.urlPrefix).toBe("https://code.example.test/org/repo/raw/published-assets");
      expect(await readFile(join(projectRoot, "dist", "example-kb", "guides", "example.md"), "utf8"))
        .toContain("https://code.example.test/org/repo/raw/published-assets/knowledge/assets/image/diagram.png");

      await writeFile(assetPath, pngBytes(80));
      const dirtyBuild = await writeSelectedPackageKnowledge({
        projectRoot,
        pkg,
        files: [{ relPath: "guides/example.md", absPath: pagePath, content }],
      });
      expect(dirtyBuild.assetDelivery.state).toBe("git-raw");
      expect(await readFile(join(projectRoot, "dist", "example-kb", "guides", "example.md"), "utf8"))
        .toContain(`https://raw.githubusercontent.com/example/context-kb/${commit}/knowledge/assets/image/diagram.png`);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses an explicit Git raw prefix when the Context workspace is outside Git", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-package-external-git-assets-"));
    try {
      const assetPath = join(projectRoot, "knowledge", "assets", "image", "diagram.png");
      const pagePath = join(projectRoot, "knowledge", "guides", "example.md");
      await mkdir(dirname(assetPath), { recursive: true });
      await mkdir(dirname(pagePath), { recursive: true });
      await writeFile(assetPath, pngBytes(64));
      const content = "# Example\n\n![Diagram](../assets/image/diagram.png)\n";
      await writeFile(pagePath, content, "utf8");
      const written = await writeSelectedPackageKnowledge({
        projectRoot,
        pkg: {
          kind: "package.kb",
          name: "example-kb",
          outDir: "dist/example-kb",
          reads: [],
          writes: [],
          template: { path: "src/package-templates/kb", vars: {} },
          navigation: { foldDirectoryIndexes: true, maxInlineEntries: 50 },
          assets: {
            delivery: "git-raw",
            urlPrefix: "https://code.example.test/org/resources/raw/published",
          },
        } as PackageDefinition,
        files: [{ relPath: "guides/example.md", absPath: pagePath, content }],
      });
      expect(written.assetDelivery).toMatchObject({
        state: "git-raw",
        sourceFiles: 1,
        outputFiles: 0,
        git: { urlPrefix: "https://code.example.test/org/resources/raw/published" },
      });
      expect(await readFile(join(projectRoot, "dist", "example-kb", "guides", "example.md"), "utf8"))
        .toContain("https://code.example.test/org/resources/raw/published/knowledge/assets/image/diagram.png");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("tracks Git-derived raw URLs in the package input identity", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-package-git-identity-"));
    try {
      const asset = imageAsset("diagram", 64);
      execFileSync("git", ["init"], { cwd: projectRoot });
      execFileSync("git", ["config", "user.email", "context@example.test"], { cwd: projectRoot });
      execFileSync("git", ["config", "user.name", "Context Test"], { cwd: projectRoot });
      await writeFile(join(projectRoot, "tracked.txt"), "first\n", "utf8");
      execFileSync("git", ["add", "tracked.txt"], { cwd: projectRoot });
      execFileSync("git", ["commit", "-m", "first"], { cwd: projectRoot });
      execFileSync("git", ["remote", "add", "origin", "git@github.com:example/one.git"], { cwd: projectRoot });

      const first = await packageAssetDeliveryFingerprintInput({
        projectRoot,
        assets: [asset],
        definition: { delivery: "git-raw" },
      });
      execFileSync("git", ["commit", "--allow-empty", "-m", "second"], { cwd: projectRoot });
      const afterCommit = await packageAssetDeliveryFingerprintInput({
        projectRoot,
        assets: [asset],
        definition: { delivery: "git-raw" },
      });
      expect(afterCommit).not.toEqual(first);

      execFileSync("git", ["remote", "set-url", "origin", "git@github.com:example/two.git"], { cwd: projectRoot });
      const afterRemote = await packageAssetDeliveryFingerprintInput({
        projectRoot,
        assets: [asset],
        definition: { delivery: "git-raw" },
      });
      expect(afterRemote).not.toEqual(afterCommit);

      const literal = await packageAssetDeliveryFingerprintInput({
        projectRoot,
        assets: [asset],
        definition: { delivery: "git-raw", urlPrefix: "https://cdn.example.test/published" },
      });
      execFileSync("git", ["commit", "--allow-empty", "-m", "third"], { cwd: projectRoot });
      expect(await packageAssetDeliveryFingerprintInput({
        projectRoot,
        assets: [asset],
        definition: { delivery: "git-raw", urlPrefix: "https://cdn.example.test/published" },
      })).toEqual(literal);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  test("allows explicit omission while reporting unresolved package references", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "context-package-omit-assets-"));
    try {
      const assetPath = join(projectRoot, "knowledge", "assets", "image", "diagram.png");
      const pagePath = join(projectRoot, "knowledge", "guides", "example.md");
      await mkdir(dirname(assetPath), { recursive: true });
      await mkdir(dirname(pagePath), { recursive: true });
      await writeFile(assetPath, pngBytes(32));
      const content = "# Example\n\n![Diagram](../assets/image/diagram.png)\n";
      await writeFile(pagePath, content, "utf8");
      const pkg = {
        kind: "package.kb",
        name: "example-kb",
        outDir: "dist/example-kb",
        reads: [],
        writes: [],
        template: { path: "src/package-templates/kb", vars: {} },
        navigation: { foldDirectoryIndexes: true, maxInlineEntries: 50 },
        assets: { delivery: "omit" },
      } as PackageDefinition;
      const written = await writeSelectedPackageKnowledge({
        projectRoot,
        pkg,
        files: [{ relPath: "guides/example.md", absPath: pagePath, content }],
      });
      expect(written.assetDelivery).toMatchObject({
        state: "omitted",
        sourceFiles: 1,
        outputFiles: 0,
        reasonCode: "package.assets.omitted-with-unresolved-links",
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
