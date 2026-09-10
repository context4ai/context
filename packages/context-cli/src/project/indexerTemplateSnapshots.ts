import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { canonicalIndexerJson, indexerProtocolDigest } from "@c4a/context";
import { atomicWriteFile } from "../lib/atomicWrite.js";

const ROOT = [".tmp", "context-runtime", "indexer", "template-snapshots"];
const REF = "context.indexer.template-snapshot-ref/v1";
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function snapshotPath(root: string, digest: string) {
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) throw new TypeError("Invalid template snapshot digest");
  return join(root, ...ROOT, `${digest.slice(7)}.json`);
}

/** Immutable templates are shared between request records. Snapshots are written
 * before the ledger transaction: an interrupted prepare may leave an unused blob,
 * but cannot publish a request pointing to a not-yet-written template. */
export async function encodeTemplateSnapshots(root: string, value: unknown): Promise<unknown> {
  const spec = object(value);
  const validation = object(spec?.validation);
  if (spec?.protocol !== "context.indexer.main-run-spec/v1" || !validation) return value;
  const store = async (template: unknown) => {
    if (!object(template)?.contract) return template;
    const source = object(template)!;
    const contract = object(source.contract)!;
    const sections = Array.isArray(contract.sections) ? contract.sections : [];
    const canBind = [contract.template_id, contract.profile, contract.reader_goal].every(item => typeof item === "string") &&
      sections.every(section => object(section)?.reader_goal === contract.reader_goal);
    const binding = canBind ? { template_id: contract.template_id, profile: contract.profile, reader_goal: contract.reader_goal } : undefined;
    const sharedContract = { ...contract };
    if (binding) {
      for (const key of ["template_id", "profile", "reader_goal"]) delete sharedContract[key];
      sharedContract.sections = sections.map(section => { const copy = { ...object(section) }; delete copy.reader_goal; return copy; });
    }
    const shared = binding ? { ...source, contract: sharedContract } : template;
    const digest = indexerProtocolDigest(shared);
    const path = snapshotPath(root, digest);
    let existing: string | undefined;
    try { existing = await readFile(path, "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existing !== undefined) {
      if (indexerProtocolDigest(JSON.parse(existing)) !== digest) throw new TypeError("Template snapshot integrity mismatch");
    } else {
      await mkdir(join(root, ...ROOT), { recursive: true });
      await atomicWriteFile(path, canonicalIndexerJson(shared));
    }
    return { protocol: REF, digest, ...(binding ? { binding } : {}) };
  };
  const projected = { ...validation };
  if (validation.page_template !== undefined) projected.page_template = await store(validation.page_template);
  const articles = object(validation.article_templates);
  if (articles) projected.article_templates = Object.fromEntries(await Promise.all(Object.entries(articles).map(async ([key, template]) => [key, await store(template)])));
  return { ...spec, validation: projected };
}

/** Old inline requests and custom templates remain readable. The hydrated
 * request is still checked against its original spec digest by the store. */
export async function hydrateTemplateSnapshots(root: string, value: unknown): Promise<unknown> {
  const spec = object(value);
  const validation = object(spec?.validation);
  if (spec?.protocol !== "context.indexer.main-run-spec/v1" || !validation) return value;
  const resolve = async (template: unknown) => {
    const ref = object(template);
    if (ref?.protocol !== REF) return template;
    if (typeof ref.digest !== "string") throw new TypeError("Template snapshot has no digest");
    let raw: string;
    try { raw = await readFile(snapshotPath(root, ref.digest), "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      throw new TypeError(`Template snapshot ${ref.digest} is missing; restore the matching runtime snapshot before resuming this request.`);
    }
    const decoded: unknown = JSON.parse(raw);
    if (indexerProtocolDigest(decoded) !== ref.digest) throw new TypeError("Template snapshot integrity mismatch");
    const binding = object(ref.binding);
    if (!binding) return decoded;
    const shared = object(decoded);
    const contract = object(shared?.contract);
    if (!shared || !contract || !Array.isArray(contract.sections) ||
        ![binding.template_id, binding.profile, binding.reader_goal].every(item => typeof item === "string")) {
      throw new TypeError("Invalid template snapshot binding");
    }
    return { ...shared, contract: { ...contract, ...binding,
      sections: contract.sections.map(section => ({ ...object(section), reader_goal: binding.reader_goal })) } };
  };
  const projected = { ...validation };
  if (validation.page_template !== undefined) projected.page_template = await resolve(validation.page_template);
  const articles = object(validation.article_templates);
  if (articles) projected.article_templates = Object.fromEntries(await Promise.all(Object.entries(articles).map(async ([key, template]) => [key, await resolve(template)])));
  return { ...spec, validation: projected };
}
