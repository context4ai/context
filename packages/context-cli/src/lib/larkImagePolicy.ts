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
