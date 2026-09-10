import { importManagedDocument } from "./managedDocumentImport.js";
import { importLarkDocument } from "./larkDocumentImport.js";

async function importOne(root: string, value: unknown) {
  return value && typeof value === "object" && "type" in value && value.type === "lark"
    ? importLarkDocument(root, value) : importManagedDocument(root, value);
}

/** Each source is independently committed. A batch receipt identifies exactly
 * which imports succeeded so a retry need not repeat remote acquisition. */
export async function importSourceDocuments(root: string, value: unknown) {
  if (!Array.isArray(value)) return importOne(root, value);
  if (value.length === 0) throw new TypeError("Source import batch must contain at least one document.");
  const results = [];
  for (const [index, item] of value.entries()) {
    try { results.push({ index, accepted: true, result: await importOne(root, item) }); }
    catch (error) { results.push({ index, accepted: false, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { outcome: results.every((item) => item.accepted) ? "imported" : "partial", results };
}
