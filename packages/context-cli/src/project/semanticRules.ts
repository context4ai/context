import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

export interface SemanticRuleDescriptor {
  id: string;
  resource_id?: string;
  path: string;
  applies_to: readonly string[];
  source?: string;
}

export interface SemanticRuleSet {
  schema: "context.semantic-ruleset.v1";
  scope: "align" | "compile";
  handle: string;
  rules_version: string;
  digest: string;
  required: Array<SemanticRuleDescriptor & {
    content_digest: string;
    content_available: boolean;
    reason: string;
  }>;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function workflowRootCandidates(): string[] {
  const runtimeDir = dirname(fileURLToPath(import.meta.url));
  return [
    join(runtimeDir, "providers", "context"),
    join(runtimeDir, "..", "..", "context-workflow"),
  ];
}

function semanticRuleMetadata(
  scope: "align" | "compile",
  filePath: string,
): SemanticRuleDescriptor {
  const content = readFileSync(filePath, "utf8").replaceAll("\r\n", "\n");
  const end = content.indexOf("\n---\n", 4);
  if (!content.startsWith("---\n") || end === -1) {
    throw new Error(`semantic workflow resource requires YAML frontmatter: ${filePath}`);
  }
  const parsed = YAML.parse(content.slice(4, end)) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`semantic workflow resource frontmatter must be an object: ${filePath}`);
  }
  const metadata = parsed as Record<string, unknown>;
  const resourceId = metadata.id;
  const appliesTo = metadata["applies-to"];
  const prefix = `context.semantic.${scope}.`;
  if (
    typeof resourceId !== "string" ||
    !resourceId.startsWith(prefix) ||
    !Array.isArray(appliesTo) ||
    !appliesTo.every((value): value is string =>
      typeof value === "string" && value.length > 0
    )
  ) {
    throw new Error(
      `semantic workflow resource must declare id ${prefix}* and string applies-to entries: ${filePath}`,
    );
  }
  return {
    id: resourceId.slice(prefix.length),
    resource_id: resourceId,
    path: `resources/semantic/${scope}/${basename(filePath)}`,
    applies_to: appliesTo,
    source: "context-workflow",
  };
}

export function semanticRuleDescriptors(
  scope: "align" | "compile",
): SemanticRuleDescriptor[] {
  for (const root of workflowRootCandidates()) {
    const directory = join(root, "resources", "semantic", scope);
    if (!existsSync(directory)) continue;
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => semanticRuleMetadata(scope, join(directory, entry.name)));
  }
  throw new Error(
    `Context ${scope} semantic workflow resources are missing. Rebuild or reinstall @c4a/context-cli.`,
  );
}

function ruleContent(rulePath: string): {
  content: string;
  available: boolean;
  filePath?: string;
} {
  for (const root of workflowRootCandidates()) {
    const absolute = join(root, rulePath);
    if (existsSync(absolute)) {
      return {
        content: readFileSync(absolute, "utf8"),
        available: true,
        filePath: absolute,
      };
    }
  }
  return { content: `missing:${rulePath}`, available: false };
}

export function requiredSemanticRuleResource(input: {
  rules: SemanticRuleSet;
  id: string;
}): {
  descriptor: SemanticRuleSet["required"][number];
  filePath: string;
} | undefined {
  const descriptor = input.rules.required.find((rule) => rule.id === input.id);
  if (descriptor === undefined) return undefined;
  const content = ruleContent(descriptor.path);
  return descriptor.content_available && content.filePath !== undefined
    ? { descriptor, filePath: content.filePath }
    : undefined;
}

export function semanticRuleSet(input: {
  scope: "align" | "compile";
  required: ReadonlyArray<{ id: string; reason: string }>;
}): SemanticRuleSet {
  const resolved = semanticRuleDescriptors(input.scope).map((rule) => {
    const content = ruleContent(rule.path);
    return {
      ...rule,
      resource_id: rule.resource_id ?? `context.semantic.${input.scope}.${rule.id}`,
      content_digest: sha256(content.content),
      content_available: content.available,
    };
  });
  const rulesVersion = sha256(resolved
    .map((rule) => `${rule.id}\0${rule.content_digest}`)
    .sort()
    .join("\n"));
  const byId = new Map(resolved.map((rule) => [rule.id, rule]));
  const required = input.required.map((item) => {
    const rule = byId.get(item.id);
    if (rule === undefined) {
      throw new Error(
        `Context ${input.scope} semantic rule is not declared by a Provider resource: ${item.id}`,
      );
    }
    return { ...rule, reason: item.reason };
  });
  const digest = sha256(JSON.stringify({
    scope: input.scope,
    rules_version: rulesVersion,
    required: required.map((rule) => ({ id: rule.id, content_digest: rule.content_digest, reason: rule.reason })),
  }));
  return {
    schema: "context.semantic-ruleset.v1",
    scope: input.scope,
    handle: `context-rules:${input.scope}:${digest.slice("sha256:".length, "sha256:".length + 16)}`,
    rules_version: rulesVersion,
    digest,
    required,
  };
}
