import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import {
  canonicalIndexerJson,
  indexerProtocolDigest,
  loadIndexerProviderManifest,
  validateIndexerControlledInvocation,
  type IndexerControlledInvocation,
  type IndexerExecution,
  type ResolvedProviderBundle,
} from "@c4a/context";
import { collectIndexerBundleFiles } from "./indexerDistributionBuild.js";
import {
  validateStagedIndexerProviderBundle,
  type StagedIndexerProviderBundle,
} from "./indexerProviderStage.js";
import { validateIndexerProgramStaticSource } from "./indexerProgramStaticValidation.js";

export interface IndexerControlledLaunch {
  protocol: "context.indexer.controlled-launch/v1";
  invocation_digest: string;
  resource: IndexerControlledInvocation["resource"];
  runtime: "node";
  executable: string;
  entry_path: string;
  args: string[];
  cwd: string;
  environment: "empty";
  shell: false;
  limits: IndexerControlledInvocation["limits"];
  runtime_receipt: {
    staged_receipt_digest: string;
    launch_digest: string;
  };
}

function sameFiles(
  actual: readonly { path: string; digest: string }[],
  expected: readonly { path: string; digest: string }[],
): boolean {
  return actual.length === expected.length && actual.every((file, index) =>
    file.path === expected[index]?.path && file.digest === expected[index]?.digest
  );
}

function sameExecution(left: IndexerExecution, right: IndexerExecution): boolean {
  return canonicalIndexerJson(left) === canonicalIndexerJson(right);
}

function declaredExecution(
  invocation: IndexerControlledInvocation,
  manifest: Awaited<ReturnType<typeof loadIndexerProviderManifest>>,
): IndexerExecution {
  if (invocation.resource === "program") {
    if (manifest.provider.program === undefined) {
      throw new TypeError("controlled launch Provider does not declare a program");
    }
    return manifest.provider.program.execution;
  }
  if (invocation.resource === "activation-detector") {
    if (manifest.activation.detector === undefined) {
      throw new TypeError("controlled launch Provider does not declare an activation detector");
    }
    return manifest.activation.detector.execution;
  }
  if (manifest.authoring_inspector === undefined) {
    throw new TypeError("controlled launch Provider does not declare an authoring inspector");
  }
  return manifest.authoring_inspector.execution;
}

function expectedCapabilities(
  invocation: IndexerControlledInvocation,
  manifest: Awaited<ReturnType<typeof loadIndexerProviderManifest>>,
): readonly string[] {
  if (invocation.resource === "program") return manifest.provider.program!.capabilities;
  if (invocation.resource === "activation-detector") {
    return manifest.activation.detector!.capabilities;
  }
  return manifest.authoring_inspector!.capabilities;
}

function assertProviderIdentity(input: {
  invocation: IndexerControlledInvocation;
  bundle: ResolvedProviderBundle;
  staged: StagedIndexerProviderBundle;
}): void {
  const provider = input.invocation.provider;
  if (
    provider.indexer_id !== input.bundle.request.indexer_id ||
    provider.provider_id !== input.bundle.request.provider_id ||
    provider.skill !== input.bundle.request.skill ||
    provider.version !== input.bundle.request.version ||
    provider.bundle_integrity !== input.bundle.resolved.integrity ||
    provider.manifest_digest !== input.bundle.resolved.manifest_digest ||
    provider.provider_fingerprint !== input.staged.provider_fingerprint
  ) {
    throw new TypeError("controlled invocation does not match the staged Provider identity");
  }
}

async function assertRealStagedEntry(
  staged: StagedIndexerProviderBundle,
  entry: string,
): Promise<string> {
  if (!isAbsolute(staged.stage_path)) {
    throw new TypeError("controlled launch requires an absolute content-addressed stage path");
  }
  const file = staged.files.find((candidate) => candidate.path === entry);
  if (file === undefined) throw new TypeError(`controlled launch entry is absent from Bundle: ${entry}`);
  const stageRealPath = await realpath(staged.stage_path);
  const entryPath = join(staged.stage_path, entry);
  const status = await lstat(entryPath);
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new TypeError("controlled launch entry must be a real staged file");
  }
  const entryRealPath = await realpath(entryPath);
  const relativeEntry = relative(stageRealPath, entryRealPath);
  if (relativeEntry.startsWith("..") || isAbsolute(relativeEntry)) {
    throw new TypeError("controlled launch entry escapes its content-addressed stage");
  }
  return entryRealPath;
}

function launchDigest(value: Omit<IndexerControlledLaunch, "runtime_receipt">): string {
  return indexerProtocolDigest(value);
}

function launchPayload(
  value: IndexerControlledLaunch,
): Omit<IndexerControlledLaunch, "runtime_receipt"> {
  return {
    protocol: value.protocol,
    invocation_digest: value.invocation_digest,
    resource: value.resource,
    runtime: value.runtime,
    executable: value.executable,
    entry_path: value.entry_path,
    args: value.args,
    cwd: value.cwd,
    environment: value.environment,
    shell: value.shell,
    limits: value.limits,
  };
}

export async function buildIndexerControlledLaunch(input: {
  invocation: unknown;
  bundle: ResolvedProviderBundle;
  staged: StagedIndexerProviderBundle;
  nodeExecutable?: string;
}): Promise<IndexerControlledLaunch> {
  const invocation = validateIndexerControlledInvocation(input.invocation);
  validateStagedIndexerProviderBundle(input.staged, input.bundle);
  const actualFiles = await collectIndexerBundleFiles(input.staged.stage_path);
  if (!sameFiles(actualFiles, input.staged.files)) {
    throw new TypeError("controlled launch Provider stage changed after validation");
  }
  assertProviderIdentity({ invocation, bundle: input.bundle, staged: input.staged });
  const manifest = await loadIndexerProviderManifest(input.staged.stage_path);
  const execution = declaredExecution(invocation, manifest);
  if (!sameExecution(execution, invocation.execution)) {
    throw new TypeError("controlled invocation execution differs from the staged manifest");
  }
  const capabilities = expectedCapabilities(invocation, manifest);
  const canonicalCapabilities = [...capabilities].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  if (canonicalIndexerJson(canonicalCapabilities) !== canonicalIndexerJson(invocation.capabilities)) {
    throw new TypeError("controlled invocation capabilities differ from the staged manifest/protocol");
  }
  const entryPath = await assertRealStagedEntry(input.staged, execution.entry);
  validateIndexerProgramStaticSource({
    path: execution.entry,
    source: await readFile(entryPath),
  });
  const stagePath = await realpath(input.staged.stage_path);
  const executable = input.nodeExecutable ?? process.execPath;
  if (!isAbsolute(executable)) throw new TypeError("controlled launch Node executable must be absolute");
  const base: Omit<IndexerControlledLaunch, "runtime_receipt"> = {
    protocol: "context.indexer.controlled-launch/v1",
    invocation_digest: invocation.invocation_digest,
    resource: invocation.resource,
    runtime: "node",
    executable,
    entry_path: entryPath,
    args: [...execution.args],
    cwd: stagePath,
    environment: "empty",
    shell: false,
    limits: invocation.limits,
  };
  return {
    ...base,
    runtime_receipt: {
      staged_receipt_digest: input.staged.receipt_digest,
      launch_digest: launchDigest(base),
    },
  };
}

export async function validateIndexerControlledLaunch(input: {
  launch: IndexerControlledLaunch;
  invocation: unknown;
  staged: StagedIndexerProviderBundle;
}): Promise<void> {
  const invocation = validateIndexerControlledInvocation(input.invocation);
  const launch = input.launch;
  const stagePath = await realpath(input.staged.stage_path);
  const entryPath = await realpath(join(input.staged.stage_path, invocation.execution.entry));
  if (
    launch.protocol !== "context.indexer.controlled-launch/v1" ||
    launch.invocation_digest !== invocation.invocation_digest ||
    launch.resource !== invocation.resource ||
    launch.runtime !== "node" ||
    !isAbsolute(launch.executable) ||
    launch.entry_path !== entryPath ||
    launch.cwd !== stagePath ||
    canonicalIndexerJson(launch.args) !== canonicalIndexerJson(invocation.execution.args) ||
    launch.environment !== "empty" ||
    launch.shell !== false ||
    canonicalIndexerJson(launch.limits) !== canonicalIndexerJson(invocation.limits) ||
    launch.runtime_receipt.staged_receipt_digest !== input.staged.receipt_digest
  ) {
    throw new TypeError("controlled launch does not match its invocation/stage");
  }
  if (launch.runtime_receipt.launch_digest !== launchDigest(launchPayload(launch))) {
    throw new TypeError("controlled launch runtime receipt digest is invalid");
  }
}
