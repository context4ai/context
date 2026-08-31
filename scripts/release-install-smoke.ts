import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  PARSER_RELEASE_PACKAGES,
  releaseEvidenceDigest,
  releasePublishPlan,
} from "../packages/dev-cli/src/commands/releasePackages.js";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new TypeError(`${name} requires a value`);
  }
  return value;
}

async function rootVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8")) as {
    version?: string;
  };
  if (typeof pkg.version !== "string") throw new TypeError("root package version is missing");
  return pkg.version;
}

const version = option("--version") ?? await rootVersion();
const registry = option("--registry") ?? "https://registry.npmjs.org";
const receiptPath = option("--receipt");
const plan = releasePublishPlan(version);
const parserPackages = PARSER_RELEASE_PACKAGES.filter((parser) =>
  plan.packages.some((pkg) => pkg.name === parser.name)
);
const scratchRoot = resolve(projectRoot, ".tmp");
await mkdir(scratchRoot, { recursive: true });
const installRoot = await mkdtemp(resolve(scratchRoot, "release-install-smoke-"));

const fixtures = {
  "@c4a/extract-thrift": [
    "fixture.thrift",
    "service Fixture { string ping(1: string value) }",
  ],
  "@c4a/extract-proto": [
    "fixture.proto",
    'syntax = "proto3"; service Fixture { rpc Ping (Request) returns (Reply); } message Request {} message Reply {}',
  ],
  "@c4a/extract-mdx": [
    "fixture.mdx",
    "import {Button} from '@fixture/ui'\n\n# Fixture\n\n<Button />",
  ],
  "@c4a/extract-contract": [
    "openapi.yaml",
    'openapi: "3.1.0"\ninfo: { title: Fixture, version: "1" }\npaths:\n  /ping:\n    get:\n      operationId: ping\n      responses: { "200": { description: ok } }',
  ],
  "@c4a/extract-style": ["fixture.css", ".button:hover { color: red; }"],
  "@c4a/extract-sql": ["fixture.sql", "SELECT id FROM users;"],
} as const;

const runnerSource = `
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const version = ${JSON.stringify(version)};
const packageNames = ${JSON.stringify(plan.packages.map((pkg) => pkg.name))};
const parserPackages = ${JSON.stringify(parserPackages)};
const fixtures = ${JSON.stringify(fixtures)};
const installed = [];
for (const name of packageNames) {
  const manifest = JSON.parse(await readFile(join(root, "node_modules", ...name.split("/"), "package.json"), "utf8"));
  if (manifest.name !== name || manifest.version !== version) {
    throw new TypeError(\`installed identity mismatch for \${name}\`);
  }
  installed.push({ name, version: manifest.version });
}

for (const name of ["@c4a/core", "@c4a/context", "@c4a/extract", "@c4a/extract-ts", "@c4a/extract-go", "@c4a/extract-rush"]) {
  await import(name);
}

const agentGraph = await import("@c4a/agent-graph");
const location = {
  schema: "agent-graph.resource-location.host-action.v1",
  id: "context.release-smoke",
  kind: "procedure",
  mediaType: "application/json",
  revision: "sha256:" + createHash("sha256").update(version).digest("hex"),
  materialize: {
    handler: "context.release-smoke/v1",
    input: { schema: "context.release-smoke-input/v1", value: { version } },
    output_schema: "context.release-smoke-output/v1",
  },
};
const hostResult = {
  schema: "agent-graph.host-action-result.v1",
  handler: location.materialize.handler,
  input_digest: agentGraph.hostActionInputDigest(location),
  output: { schema: location.materialize.output_schema, inline: { state: "accepted", version } },
  receipt: { adapter: "release-install-smoke", adapter_version: "1.0.0" },
};
await agentGraph.validateHostActionResult(location, hostResult);
const graphReceipt = await agentGraph.hostActionResourceReadReceipt(location, hostResult);

const parserResults = [];
for (const parserPackage of parserPackages) {
  const module = await import(parserPackage.name);
  const parser = module[parserPackage.export];
  if (typeof parser !== "function") throw new TypeError(\`\${parserPackage.name} lacks \${parserPackage.export}\`);
  const [path, source] = fixtures[parserPackage.name];
  const files = { [path]: source };
  const invocation = {
    adapter: {
      id: "community-release-install-smoke",
      package: parserPackage.name,
      export: parserPackage.export,
      version,
      digest: \`sha256:\${createHash("sha256").update(\`\${parserPackage.name}@\${version}\`).digest("hex")}\`,
    },
    authorized_scope: {
      source_ref: "source:release-install-smoke",
      module_refs: [],
      scope_digest: \`sha256:\${createHash("sha256").update("release-install-smoke-scope").digest("hex")}\`,
    },
    input_digest: \`sha256:\${createHash("sha256").update(JSON.stringify(files)).digest("hex")}\`,
    precedence: 1,
    ...(parserPackage.name === "@c4a/extract-sql" ? { dialects: { [path]: "postgresql" } } : {}),
  };
  const result = parser(files, invocation);
  const evidenceFile = result?.files?.find((file) => file.normalized_path === path);
  if (result?.protocol !== "context.indexer.evidence-adapter-result/v1" || evidenceFile?.disposition !== "analyzed") {
    throw new TypeError(\`\${parserPackage.name} failed its anonymous Evidence ABI fixture\`);
  }
  parserResults.push({
    package: parserPackage.name,
    export: parserPackage.export,
    disposition: evidenceFile.disposition,
    result_digest: result.output_digest,
  });
}

process.stdout.write(JSON.stringify({
  installed,
  graph: {
    input_digest: hostResult.input_digest,
    output_digest: graphReceipt.digest,
  },
  parsers: parserResults,
}));
`;

try {
  await writeFile(resolve(installRoot, "package.json"), `${JSON.stringify({
    private: true,
    type: "module",
  }, null, 2)}\n`);
  await execFileAsync("npm", [
    "install",
    "--ignore-scripts",
    "--no-package-lock",
    `--registry=${registry}`,
    ...plan.packages.map((pkg) => pkg.exact_spec),
  ], { cwd: installRoot, maxBuffer: 64 * 1024 * 1024 });

  const cliPath = resolve(installRoot, "node_modules", ".bin", "context");
  const capabilitiesRun = await execFileAsync(cliPath, ["indexer", "capabilities", "--format", "json"], {
    cwd: installRoot,
    maxBuffer: 32 * 1024 * 1024,
  });
  const catalogRun = await execFileAsync(cliPath, ["indexer", "catalog", "--format", "json"], {
    cwd: installRoot,
    maxBuffer: 32 * 1024 * 1024,
  });
  const capabilities = JSON.parse(capabilitiesRun.stdout) as {
    protocol?: string;
    version?: string;
    dist_tag?: string;
    manifest_digest?: string;
    capabilities?: Array<{ id?: string; state?: string }>;
  };
  const catalog = JSON.parse(catalogRun.stdout) as {
    protocol?: string;
    version?: string;
    bundles?: Array<{ skill?: string }>;
  };
  if (
    capabilities.protocol !== "context.indexer.release-capability-manifest/v1" ||
    capabilities.version !== version ||
    capabilities.dist_tag !== plan.channel ||
    typeof capabilities.manifest_digest !== "string"
  ) {
    throw new TypeError("installed Context CLI returned an invalid release capability manifest");
  }
  const expectedSkills = new Set(
    (capabilities.capabilities ?? []).flatMap((capability) => {
      if (capability.state !== "ready") return [];
      if (capability.id === "code-indexer") return ["context-code-indexer"];
      if (capability.id === "markdown-indexer") return ["context-markdown-indexer"];
      return [];
    }),
  );
  const actualSkills = new Set((catalog.bundles ?? []).map((bundle) => bundle.skill));
  if (
    catalog.protocol !== "context.indexer.cli-bundled-catalog/v1" ||
    catalog.version !== version ||
    expectedSkills.size !== actualSkills.size ||
    [...expectedSkills].some((skill) => !actualSkills.has(skill))
  ) {
    throw new TypeError("installed Context CLI catalog does not match its capability manifest");
  }

  await writeFile(resolve(installRoot, "smoke.mjs"), runnerSource);
  const runner = await execFileAsync(process.execPath, [resolve(installRoot, "smoke.mjs")], {
    cwd: installRoot,
    maxBuffer: 32 * 1024 * 1024,
  });
  const forward = JSON.parse(runner.stdout) as unknown;
  const payload = {
    schema: "context.release-install-smoke/v1" as const,
    state: "accepted" as const,
    registry,
    version,
    channel: plan.channel,
    packages: plan.packages.map((pkg) => pkg.exact_spec),
    capability_manifest_digest: capabilities.manifest_digest,
    catalog_skills: [...actualSkills].sort(),
    forward,
  };
  const receipt = { ...payload, receipt_digest: releaseEvidenceDigest(payload) };
  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  if (receiptPath !== undefined) {
    const absoluteReceipt = resolve(projectRoot, receiptPath);
    await mkdir(dirname(absoluteReceipt), { recursive: true });
    await writeFile(absoluteReceipt, output);
  }
  process.stdout.write(output);
} finally {
  await rm(installRoot, { recursive: true, force: true });
}
