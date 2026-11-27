import type { LarkExternalResource } from "./larkDocxXml.js";
import type { LarkResourceMaterializationItem, LarkResourceMaterializationPolicy } from "./larkResourceMaterialization.js";

export class LarkResourceBudgetError extends Error {}

/** Preserve a visible, traceable placeholder without claiming to have read the image. */
export function omitLarkImage(
  resource: LarkExternalResource,
  policy: LarkResourceMaterializationPolicy,
  items: LarkResourceMaterializationItem[],
  replacements: Map<string, string>,
  mediaType?: string,
  failure?: string,
): boolean {
  if (resource.kind !== "image" && !mediaType?.startsWith("image/")) return false;
  const gif = mediaType === "image/gif" || /\.gif$/iu.test(resource.title ?? "") ||
    Object.entries(resource.attributes).some(([key, value]) =>
      ["mime_type", "content_type"].includes(key) && value === "image/gif");
  if (!failure && policy.images !== "reference-only" && !(gif && policy.gifs === "reference-only")) return false;
  const title = (resource.title ?? "image").replace(/[\r\n<>]/gu, " ");
  replacements.set(resource.locator, `> Image omitted: ${title}. ${failure ? "Resource size limit exceeded." : "Excluded by selected policy."} See the source document. <!-- ${resource.locator} -->`);
  items.push({ kind: resource.kind, locator: resource.locator, status: "reference-only",
    required: false, asset_paths: [], reason_code: failure ? "image-budget-exceeded" : "image-excluded-by-policy",
    reason: failure ?? "Image bytes were not retained; the selected image policy preserves a placeholder and source reference" });
  return true;
}

/** Reason codes of resources the selected capture policy keeps as references; never a capture failure. */
export const LARK_POLICY_EXCLUSION_REASON_CODES: ReadonlySet<string> = new Set([
  "image-excluded-by-policy",
  "file-excluded-by-policy",
  "whiteboard-excluded-by-policy",
]);

/** File attachments and whiteboards (including non-inline diagrams) excluded by the selected policy keep a placeholder. */
export function omitLarkResourceByPolicy(
  resource: LarkExternalResource,
  policy: LarkResourceMaterializationPolicy,
  items: LarkResourceMaterializationItem[],
  replacements: Map<string, string>,
): boolean {
  const excluded = resource.kind === "file" ? policy.files === "reference-only"
    : (resource.kind === "whiteboard" || resource.kind === "diagram" && resource.inline_content !== true) && policy.whiteboards === "reference-only";
  if (!excluded) return false;
  const label = resource.kind === "file" ? "File" : resource.kind === "diagram" ? "Diagram" : "Whiteboard";
  const title = (resource.title ?? label.toLowerCase()).replace(/[\r\n<>]/gu, " ");
  replacements.set(resource.locator, `> ${label} omitted: ${title}. Excluded by selected policy. See the source document. <!-- ${resource.locator} -->`);
  items.push({ kind: resource.kind, locator: resource.locator, status: "reference-only", required: false, asset_paths: [],
    reason_code: resource.kind === "file" ? "file-excluded-by-policy" : "whiteboard-excluded-by-policy",
    reason: `${label} bytes were not retained; the selected resource policy preserves a placeholder and source reference` });
  return true;
}
