import { expect, test } from "bun:test";
import { createArticleSourceReference } from "@c4a/context";
import { createArticleReferenceObserver } from "../project/articleReferenceObservation.js";
import { SourceReadError, SourceUnavailableError } from "../project/gitObjectReader.js";

const reference = (text: string, start_line = 1, end_line = start_line) => createArticleSourceReference("note:sample", { path: "sample.md", start_line, end_line }, text);

test("digest matching needs no baseline and follows signing CRLF and final-empty-line rules", async () => {
  const signed = reference("first\r\nsecond\r\n", 2, 3);
  const observe = createArticleReferenceObserver(async () => "heading\r\nfirst\r\nsecond\r\n");
  expect(await observe(signed)).toMatchObject({ state: "moved", reference: { locator: { start_line: 3, end_line: 4 } } });
});

test("original position wins; multiple relocated matches remain ambiguous", async () => {
  const signed = reference("same\n");
  expect(await createArticleReferenceObserver(async () => "same\nsame\n")(signed)).toMatchObject({ state: "current" });
  expect(await createArticleReferenceObserver(async () => "header\nsame\nsame\n")(signed)).toMatchObject({ state: "ambiguous" });
  expect(await createArticleReferenceObserver(async () => "different\n")(signed)).toMatchObject({ state: "not-found" });
});

test("capture gaps and absent files differ from failed observations", async () => {
  const signed = reference("old table\n");
  const read = Object.assign(async () => "Resource unavailable\n", { incomplete: async () => true });
  expect(await createArticleReferenceObserver(read)(signed)).toMatchObject({ state: "unavailable", reason: "source-capture-incomplete" });
  expect(await createArticleReferenceObserver(async () => { throw new SourceUnavailableError("missing"); })(signed)).toMatchObject({ state: "unavailable" });
  await expect(createArticleReferenceObserver(async () => { throw new SourceReadError("timeout"); })(signed)).rejects.toThrow("timeout");
});

test("several citations with the same length use the same exact matching rules", async () => {
  const text = "preamble\none\ntwo\nthree\n";
  const observe = createArticleReferenceObserver(async () => text);
  expect((await observe(reference("one\n"))).reference.locator.start_line).toBe(2);
  expect((await observe(reference("two\n"))).reference.locator.start_line).toBe(3);
  expect(await observe(reference("missing\n"))).toMatchObject({ state: "not-found" });
});
