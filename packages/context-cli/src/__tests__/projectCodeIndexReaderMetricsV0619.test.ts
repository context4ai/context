import { expect, test } from "bun:test";
import { measureCodeIndexMarkdown } from "../project/codeIndexAuditMetrics.js";

test("code-index reader metrics exclude Context lifecycle annotations", () => {
  const readerText = [
    "# Module contract",
    "",
    "The `sample.api` entry exposes the stable contract from `src/index.ts`.",
  ].join("\n");
  const annotated = [
    "# Module contract",
    "",
    '<!-- context:section id="contract" source_ref="repo:sample#symbol:src/index.ts:api:function@digest" -->',
    "<!-- context:source_refs",
    '["repo:sample#symbol:src/index.ts:api:function@digest", "repo:sample#symbol:src/runtime.ts:run:function@digest"]',
    "/context:source_refs -->",
    "The `sample.api` entry exposes the stable contract from `src/index.ts`.",
    "<!-- /context:section -->",
  ].join("\n");

  expect(measureCodeIndexMarkdown(annotated)).toEqual(measureCodeIndexMarkdown(readerText));
});
