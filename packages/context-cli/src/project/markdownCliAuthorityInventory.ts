import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface InventoryReference {
  path: string;
  anchors: string[];
}

interface MarkdownCliAuthorityInventory {
  schema: "context.markdown-cli-authority-inventory/v1";
  authority: "context-sdk-cli";
  capabilities: Array<{
    id: string;
    implementations: InventoryReference[];
    behavior_evidence: InventoryReference[];
  }>;
}

export const EXPECTED_MARKDOWN_CLI_AUTHORITY_CAPABILITIES = [
  "source-capture-and-snapshot-digest",
  "safe-file-lark-markdown-mdx-materialization",
  "markdown-ast-span-and-canonical-source-ref",
  "node-artifact-section-edge-schema-and-view-projection",
  "source-scope-owner-identity-digest-stale-conflict",
  "layout-resolver-conditional-confirmation-and-review",
  "protected-value-integrity",
  "revision-sidecar-incremental-stale-and-conflict",
  "verify-build-and-package-projection",
  "section-intent-collection-package-mapping",
] as const;

export interface MarkdownCliAuthorityIssue {
  capability_id: string;
  kind: "missing-file" | "missing-anchor" | "invalid-owner-path";
  path: string;
  anchor: string | null;
}

export interface MarkdownCliAuthorityReport {
  schema: "context.markdown-cli-authority-report/v1";
  authority: "context-sdk-cli";
  inventory_digest: string;
  capabilities: Array<{
    id: string;
    implementation_paths: string[];
    behavior_evidence_paths: string[];
    current: boolean;
  }>;
  issues: MarkdownCliAuthorityIssue[];
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseInventory(bytes: Uint8Array, label: string): MarkdownCliAuthorityInventory {
  let value: MarkdownCliAuthorityInventory;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as MarkdownCliAuthorityInventory;
  } catch (error) {
    throw new TypeError(`${label} is not valid JSON: ${String(error)}`);
  }
  if (value.schema !== "context.markdown-cli-authority-inventory/v1" ||
    value.authority !== "context-sdk-cli" || !Array.isArray(value.capabilities)) {
    throw new TypeError(`${label} is not a Markdown CLI authority inventory`);
  }
  const ids = value.capabilities.map((capability) => capability.id);
  if (new Set(ids).size !== ids.length ||
    ids.length !== EXPECTED_MARKDOWN_CLI_AUTHORITY_CAPABILITIES.length ||
    ids.some((id, index) => id !== EXPECTED_MARKDOWN_CLI_AUTHORITY_CAPABILITIES[index])) {
    throw new TypeError(`${label} does not contain the exact ordered CLI authority capability set`);
  }
  for (const capability of value.capabilities) {
    if (!Array.isArray(capability.implementations) || capability.implementations.length === 0 ||
      !Array.isArray(capability.behavior_evidence) || capability.behavior_evidence.length === 0) {
      throw new TypeError(`${capability.id} must bind implementation and behavior evidence`);
    }
  }
  return value;
}

function isCliAuthorityPath(path: string): boolean {
  return path.startsWith("packages/context/") ||
    path.startsWith("packages/context-cli/") ||
    path.startsWith("packages/extract/");
}

async function inspectReference(input: {
  repositoryRoot: string;
  capabilityId: string;
  reference: InventoryReference;
}): Promise<MarkdownCliAuthorityIssue[]> {
  if (!isCliAuthorityPath(input.reference.path)) {
    return [{
      capability_id: input.capabilityId,
      kind: "invalid-owner-path",
      path: input.reference.path,
      anchor: null,
    }];
  }
  let content: string;
  try {
    content = await readFile(join(input.repositoryRoot, input.reference.path), "utf8");
  } catch {
    return [{
      capability_id: input.capabilityId,
      kind: "missing-file",
      path: input.reference.path,
      anchor: null,
    }];
  }
  return input.reference.anchors
    .filter((anchor) => !content.includes(anchor))
    .map((anchor) => ({
      capability_id: input.capabilityId,
      kind: "missing-anchor" as const,
      path: input.reference.path,
      anchor,
    }));
}

export async function inspectMarkdownCliAuthorityInventory(input: {
  repositoryRoot: string;
  inventoryPath?: string;
}): Promise<MarkdownCliAuthorityReport> {
  const inventoryPath = input.inventoryPath ??
    "plugins/context/migrations/0.7.0-markdown-cli-authority.json";
  const bytes = await readFile(join(input.repositoryRoot, inventoryPath));
  const inventory = parseInventory(bytes, inventoryPath);
  const capabilities: MarkdownCliAuthorityReport["capabilities"] = [];
  const issues: MarkdownCliAuthorityIssue[] = [];
  for (const capability of inventory.capabilities) {
    const references = [...capability.implementations, ...capability.behavior_evidence];
    const capabilityIssues = (await Promise.all(references.map((reference) => inspectReference({
      repositoryRoot: input.repositoryRoot,
      capabilityId: capability.id,
      reference,
    })))).flat();
    issues.push(...capabilityIssues);
    capabilities.push({
      id: capability.id,
      implementation_paths: capability.implementations.map((item) => item.path),
      behavior_evidence_paths: capability.behavior_evidence.map((item) => item.path),
      current: capabilityIssues.length === 0,
    });
  }
  return {
    schema: "context.markdown-cli-authority-report/v1",
    authority: inventory.authority,
    inventory_digest: sha256(bytes),
    capabilities,
    issues: issues.sort((left, right) =>
      compareText(`${left.capability_id}:${left.path}:${left.anchor ?? ""}`,
        `${right.capability_id}:${right.path}:${right.anchor ?? ""}`)
    ),
  };
}
