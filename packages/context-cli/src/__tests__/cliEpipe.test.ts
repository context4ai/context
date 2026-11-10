import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// Requires a current build (bun run build).
test("output piped to a reader that closes early does not crash the CLI", () => {
  const cli = resolve(import.meta.dir, "../../dist/cli.js");
  // `true` exits without reading, so the CLI's write hits a closed pipe; stderr stays readable.
  const out = execFileSync("bash", ["-c", `{ node '${cli}' task adjust --schema --format json | true; echo "exit=\${PIPESTATUS[0]}"; } 2>&1`], { encoding: "utf8" });
  expect(out).not.toContain("EPIPE");
  expect(out.trim()).toEndWith("exit=0");
});
