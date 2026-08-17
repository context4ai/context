import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { detectTechStack } from "../techStack.js";

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));
const techRepo = fileURLToPath(new URL("./fixtures/repo-tech", import.meta.url));
const singleRepo = fileURLToPath(new URL("./fixtures/repo-single", import.meta.url));

describe("detectTechStack", () => {
  test("detects configured tech stack labels", async () => {
    const stack = await detectTechStack(techRepo);
    expect(stack).toEqual(
      expect.arrayContaining([
        "typescript",
        "react",
        "nextjs",
        "nestjs",
        "typeorm",
        "prisma",
        "express",
        "vue",
      ])
    );
  });

  test("always includes typescript", async () => {
    const stack = await detectTechStack(singleRepo);
    expect(stack).toEqual(expect.arrayContaining(["typescript"]));
  });

  test("ignores missing package.json", async () => {
    const stack = await detectTechStack(fixturesDir);
    expect(stack).toEqual(expect.arrayContaining(["typescript"]));
  });
});
