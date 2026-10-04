import { expect, test } from "bun:test";
import { importUrlSchema, importsRegistrySchema } from "../imports.js";

test("absolute import entrances preserve spelling and resolve independently of the reader page", () => {
  const entrances = [
    "https://example.org",
    "http://example.org:8080/docs/",
    "HTTPS://Example.ORG:443/docs?view=full#usage",
    "https://example.org/docs/%E6%8C%87%E5%8D%97?file=a%2Fb&label=a%20b#section%201",
    "https://example.org/docs?q=one|two&pattern=%5Cw%2B#overview",
    "http://[::1]:8080/docs?revision=v1.2.3",
    "https://docs.example.org/path/../guide?url=https%3A%2F%2Fexample.net%2F",
  ];
  for (const entrance of entrances) {
    expect(importUrlSchema.parse(entrance)).toBe(entrance);
    for (const base of ["https://reader.example.net/nested/", "http://reader.example.net/"]) {
      expect(new URL(entrance, base).href).toBe(new URL(entrance).href);
    }
    const declaration = importsRegistrySchema.parse({ protocol: "context.imports/v1",
      imports: { guide: { url: entrance } } });
    expect(declaration.imports.guide?.url).toBe(entrance);
  }
});

test("import entrances reject relative or repaired authority spellings", () => {
  for (const entrance of [
    "https:example.org/docs", "http:example.org/docs",
    "https:/example.org/docs", "https:///example.org/docs", "https:////example.org/docs",
    "//example.org/docs", "/docs", "example.org/docs",
    "https:\\example.org/docs", "https://example.org\\docs",
    "https://example.org/docs?q=\\w", "https://", "https://?q=guide", "https://#guide",
    "https://example.org:invalid/docs", "https://[invalid]/docs",
  ]) {
    expect(importUrlSchema.safeParse(entrance).success).toBe(false);
  }
});

test("import entrances reject credentials, control characters and non-reader schemes", () => {
  for (const entrance of [
    "https://user:secret@example.org/docs", "https://user@example.org/docs",
    "https://:secret@example.org/docs", "https://user%40mail:p%3Ass@example.org/docs",
    "https://example.org/\u0000docs", "https://example.org/\u007fdocs",
    " https://example.org/docs", "https://example.org/docs ",
    "https://example.org/a b", "https://example.org/a\nb", "https://example.org/a\rb",
    "https://example.org/a\tb", "https://example.org/a\u00a0b",
    "https://example.org/<docs>", "javascript:alert(1)", "file:///docs/guide.md", "ftp://example.org/docs",
  ]) {
    expect(importUrlSchema.safeParse(entrance).success).toBe(false);
  }
});
