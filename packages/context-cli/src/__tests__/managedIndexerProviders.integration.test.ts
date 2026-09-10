import { afterEach, expect, test } from "bun:test";
import { cp, mkdir, readFile, rm, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import YAML from "yaml";
import { hostActionInputDigest, type HostActionResult, type JsonValue } from "@c4a/agent-graph";
import { buildIndexerProviderResolutionActionOutput, indexerProviderBundleIntegrity, loadIndexerRegistry,
  resolvedProviderReceiptDigest, validateIndexerProviderContractReferences, type ResolvedProviderBundle } from "@c4a/context";
import { createDocumentRevisionWorkspace, DOCUMENT_REVISION_SOURCE_REF } from "./projectDocumentRevisionV074.fixture.js";
import { listCliBundledIndexers, defaultCliIndexerAssetsRoot } from "../project/indexerCliBundledProvider.js";
import { completeCurrentIndexerProviderSelection } from "../project/indexerCurrentProviderSetup.js";
import { completeCurrentIndexerProviderResolution } from "../project/indexerCurrentProviderContinuation.js";
import { readCurrentIndexerProviderSetup } from "../project/indexerCurrentProviderState.js";
import { validateProjectIndexerSelectionProposal } from "../project/indexerSelectionProposal.js";
import { indexerProviderResolutionHostLocation } from "../project/indexerProviderDispatcher.js";
import { collectIndexerBundleFiles } from "../project/indexerDistributionBuild.js";
import { resolveCurrentProjectIndexerPrimaryAuthority } from "../project/indexerCurrentPrimaryAuthority.js";
import { approvedRevisionContext } from "../project/approvedRevisionContext.js";
import { importManagedDocument } from "../project/managedDocumentImport.js";
import { loadIndexerCustomization } from "../project/indexerCustomization.js";
import { buildCurrentIndexerInstructionMaterializationRequest, materializeCurrentIndexerInstructions } from "../project/indexerCurrentInstructionMaterialization.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test.each(["note", "sessions"] as const)("%s template overrides reach Author and revision by declared template ID", async (type) => {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  const saved = await importManagedDocument(root, { type, name: "20260908/access-help.md", markdown: "# Access help\n\nAsk the owner to restore access." });
  const { registry } = await loadIndexerRegistry(root);
  registry.requirements[0]!.target_scope.targets = [{ source_ref: saved.source_ref, module_refs: [] }];
  registry.requirements[0]!.evidence_source_scope.targets = [{ source_ref: saved.source_ref, module_refs: [] }];
  const indexer = registry.indexers[0]!;
  const bundle = (await listCliBundledIndexers()).bundles.find((item) => item.skill === `context-${type}-indexer`)!;
  indexer.profile = { primary: { id: "faq-support", provider: "primary" } };
  indexer.providers = [{ id: "primary", role: "primary", skill: bundle.skill, version: bundle.version,
    integrity: bundle.integrity, distribution: bundle.distribution }];
  indexer.customization = { mode: "extend" };
  const customRoot = join(root, "src/indexer", indexer.id);
  const overridePath = join(customRoot, "templates", `${type}-faq-support.md`);
  const origin = `<!-- @context-indexer-origin ${bundle.skill}@${bundle.version} profile=faq-support -->\n`;
  const override = `${origin}# Access reference\n\nGroup related access questions as sections.\n`;
  const append = `${origin}Explain the owner escalation boundary.\n`;
  await mkdir(join(customRoot, "templates"), { recursive: true });
  await writeFile(overridePath, override);
  await writeFile(join(customRoot, "instructions.md"), append);
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify({ ...registry, indexers: [] }));
  expect(await completeCurrentIndexerProviderSelection({ projectRoot: root, currentRegistry: { ...registry, indexers: [] },
    semantic: { stage: "provider-selection", host_visible_skills: [], indexers: [indexer] } })).toBe("selection-applied");

  const current = (await loadIndexerRegistry(root)).registry;
  const authority = await resolveCurrentProjectIndexerPrimaryAuthority({ projectRoot: root, registry: current, indexer_id: indexer.id });
  const customization = await loadIndexerCustomization({ workspaceRoot: root, projectRef: root,
    indexer, manifest: authority.manifest, providerIntegrity: authority.provider.integrity });
  const request = buildCurrentIndexerInstructionMaterializationRequest({ authority, customization, stage: "author" });
  const author = await materializeCurrentIndexerInstructions({ request, authority, customization, workspaceRoot: root });
  const revision = await approvedRevisionContext(root, { source_refs: [saved.source_ref], markdown: "# Access help\n" });
  const resources = revision.providers[0]!.resources;
  expect(author.resources.filter((item) => item.kind === "template").map((item) => item.content)).toEqual([override]);
  expect(resources.find((item) => item.path === overridePath)?.content).toBe(override);
  expect(resources.some((item) => item.path.endsWith("/templates/faq-support.md"))).toBe(false);
  expect(resources.find((item) => item.path === join(customRoot, "instructions.md"))?.content).toBe(append);
  expect(resources.map((item) => item.content).sort()).toEqual(author.resources.map((item) => item.content).sort());

  // A subsequent edit is read from the registered workspace files, not a stale
  // setup snapshot or a separately supplied ladder plan.
  const changed = `${override}\nInclude the current support channel.\n`;
  await writeFile(overridePath, changed);
  const resumed = await approvedRevisionContext(root, { source_refs: [saved.source_ref], markdown: "# Access help\n" });
  expect(resumed.providers[0]!.resources.find((item) => item.path === overridePath)?.content).toBe(changed);
}, 30_000);

test.each(["note", "sessions"] as const)("selected %s extension reaches the same code authority and approved revision", async (type) => {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  const saved = await importManagedDocument(root, { type, name: "20260907/reason.md", markdown: "# Rationale\n\nThe choice is agreed; the fallback is only proposed.",
    ...(type === "sessions" ? { changes: [{ mr: "https://git.example.org/team/project/pull/42" }] } : {}) });
  const { registry } = await loadIndexerRegistry(root);
  registry.requirements[0]!.evidence_source_scope.targets.push({ source_ref: saved.source_ref, module_refs: [] });
  const indexer = registry.indexers[0]!;
  indexer.read_scope.refs = ["requirement:workspace-knowledge#evidence_source_scope"];
  const bundle = (await listCliBundledIndexers()).bundles.find((item) => item.skill === `context-${type}-indexer`)!;
  indexer.providers.push({ id: "contextual", role: "extension", skill: bundle.skill, version: bundle.version,
    integrity: bundle.integrity, distribution: bundle.distribution });
  indexer.profile.additional = [{ id: `${type}/component-library`, provider: "contextual", kind: "extension" }];
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify({ ...registry, indexers: [] }));
  expect(await completeCurrentIndexerProviderSelection({ projectRoot: root, currentRegistry: { ...registry, indexers: [] },
    semantic: { stage: "provider-selection", host_visible_skills: [], indexers: [indexer] } })).toBe("selection-applied");
  const current = (await loadIndexerRegistry(root)).registry;
  const authority = await resolveCurrentProjectIndexerPrimaryAuthority({ projectRoot: root, registry: current, indexer_id: indexer.id });
  expect(authority.manifest.id).toBe("context-code-indexer");
  const invalidManifest = structuredClone(authority.layers.find((layer) => layer.layer.id === "contextual")!.manifest);
  invalidManifest.provides.source_roles = ["not-a-declared-layout-role"];
  expect(() => validateIndexerProviderContractReferences({ manifest: invalidManifest,
    selected_profiles: [`${type}/component-library`], profile_contract: authority.profile_contract,
    operator_contract: authority.operator_contract })).toThrow("unregistered layout source role");
  expect(authority.primary_execution.resources.some((resource) => resource.ref === `bundle:${bundle.skill}/references/indexer.md`)).toBe(true);
  expect(authority.composition_plan?.active_profiles).toContainEqual(expect.objectContaining({ id: `${type}/component-library`, kind: "extension" }));
  const context = await approvedRevisionContext(root, { source_refs: [DOCUMENT_REVISION_SOURCE_REF, saved.source_ref], markdown: "# Existing guide\n" });
  expect(context.providers).toHaveLength(1);
  expect(context.providers[0]!.resources.some((resource) => resource.provider === "contextual" && resource.path.endsWith("references/writing.md"))).toBe(true);
  expect(context.sources).toMatchObject([{ source_ref: saved.source_ref, path: await realpath(join(root, saved.path)) }]);
  if (type === "sessions") expect(context.sources[0]!.changes).toEqual([{ mr: "https://git.example.org/team/project/pull/42" }]);
  expect((await loadIndexerRegistry(root)).registry.indexers).toHaveLength(1);
}, 30_000);

test("a Host-declared business Sessions Provider replaces the default without CLI installation", async () => {
  const root = await createDocumentRevisionWorkspace(); roots.push(root);
  const saved = await importManagedDocument(root, { type: "sessions", name: "20260907/review-policy.md", markdown: "# Review process\n\nTwo reviewers agreed to the urgent-change rule." });
  const businessRoot = join(root, "business-skill");
  await cp(join(defaultCliIndexerAssetsRoot(), "bundles/context-sessions-indexer"), businessRoot, { recursive: true });
  const manifestPath = join(businessRoot, "context-indexer.yaml");
  const manifest = YAML.parse(await readFile(manifestPath, "utf8"));
  manifest.id = "context-sessions-indexer-business";
  await writeFile(manifestPath, YAML.stringify(manifest));
  const skillPath = join(businessRoot, "SKILL.md");
  await writeFile(skillPath, (await readFile(skillPath, "utf8")).replace("name: context-sessions-indexer\n", `name: ${manifest.id}\n`));
  const files = await collectIndexerBundleFiles(businessRoot);
  const integrity = indexerProviderBundleIntegrity(files);
  const { registry } = await loadIndexerRegistry(root);
  registry.requirements[0]!.target_scope.targets = [{ source_ref: saved.source_ref, module_refs: [] }];
  registry.requirements[0]!.evidence_source_scope.targets = [{ source_ref: saved.source_ref, module_refs: [] }];
  const indexer = registry.indexers[0]!;
  indexer.profile = { primary: { id: "decision-record", provider: "business" } };
  indexer.providers = [{ id: "business", role: "primary", skill: manifest.id, version: manifest.version, integrity,
    distribution: { kind: "workspace", locator: "workspace://business-skill" } }];
  await writeFile(join(root, "src/indexers.yaml"), YAML.stringify({ ...registry, indexers: [] }));
  expect(await completeCurrentIndexerProviderSelection({ projectRoot: root, currentRegistry: { ...registry, indexers: [] },
    semantic: { stage: "provider-selection", host_visible_skills: [{ skill: manifest.id, version: manifest.version, source_type: "workspace" }], indexers: [indexer] } })).toBe("provider-resolution-required");
  const state = (await readCurrentIndexerProviderSetup(root))!;
  const validation = await validateProjectIndexerSelectionProposal({ projectRoot: root, value: state.proposal });
  const request = validation.resolution_requests[0]!;
  const now = new Date();
  const envelope: ResolvedProviderBundle = { protocol: "context.indexer.resolved-provider-bundle/v1", request: { indexer_id: request.provider.indexer_id, provider_id: request.provider.provider_id, skill: request.provider.skill, version: request.provider.version, distribution: request.provider.distribution },
    resolved: { integrity, manifest_digest: files.find((item) => item.path === "context-indexer.yaml")!.digest, issuer: "business", trust: "verified" },
    transport: { kind: "directory", path: businessRoot, expires_at: new Date(now.getTime() + 300_000).toISOString() }, files,
    receipt: { resolver: "test-host/1.0.0", resolved_at: now.toISOString(), authority_ref: "host-visible-skill:business", receipt_digest: integrity } };
  envelope.receipt.receipt_digest = resolvedProviderReceiptDigest(envelope);
  const output = buildIndexerProviderResolutionActionOutput({ request, envelope, now });
  const location = indexerProviderResolutionHostLocation(request);
  const hostResult: HostActionResult = { schema: "agent-graph.host-action-result.v1", handler: location.materialize.handler,
    input_digest: hostActionInputDigest(location), output: { schema: location.materialize.output_schema, inline: output as unknown as JsonValue },
    receipt: { adapter: "test-host", adapter_version: "1.0.0" } };
  expect(await completeCurrentIndexerProviderResolution({ projectRoot: root, hostResult })).toBe("selection-applied");
  const applied = (await loadIndexerRegistry(root)).registry;
  expect(applied.indexers[0]!.providers.map((provider) => provider.skill)).toEqual([manifest.id]);
  const context = await approvedRevisionContext(root, { source_refs: [saved.source_ref], markdown: "# Policy\n" });
  expect(context.providers[0]!.provider.skill).toBe(manifest.id);
  expect(context.providers[0]!.resources.some((resource) => resource.path.endsWith("templates/decision-record.md"))).toBe(true);
  expect(context.sources[0]!.changes).toBeUndefined();
}, 30_000);
