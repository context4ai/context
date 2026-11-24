import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const builder = resolve(import.meta.dir, "../../../../plugins/context/skills/context-plan/templates/research-report/build.mjs");

function build(chapters: Record<string, string>, extra: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "research-report-"));
  mkdirSync(join(root, "ch"));
  for (const [name, content] of Object.entries(chapters)) writeFileSync(join(root, "ch", name), content, "utf8");
  const out = join(root, "out.html");
  const result = spawnSync("node", [builder, join(root, "ch"), out, ...extra], { encoding: "utf8" });
  const html = result.status === 0 ? readFileSync(out, "utf8") : "";
  rmSync(root, { recursive: true, force: true });
  return { status: result.status, stderr: result.stderr, html };
}

test("chapter titles, links and options cannot inject markup or scripts", () => {
  const { status, html } = build({
    "01-a.md": "# <img src=x onerror=alert(1)> & \"Q\"\n\n## Sub\n\n[bad](javascript:alert(1)) [ok](https://example.com/x) [rel](b.md)\n",
  }, ["--title=T & <b>"]);
  expect(status).toBe(0);
  expect(html).not.toContain("<img src=x");
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('href="https://example.com/x"');
  expect(html).toContain('href="b.md"');
  expect(html).toContain('data-title="&lt;img src=x onerror=alert(1)&gt; &amp; &quot;Q&quot;"');
  expect(html).toContain("<title>T &amp; &lt;b&gt;</title>");
  // Client navigation is built from text nodes, never by concatenating titles into markup.
  expect(html).not.toContain("innerHTML");
});

test("chart colours and numbers are validated with their location", () => {
  const color = build({ "01-a.md": '# A\n\n```chart\n{"type":"scatter","points":[{"x":1,"y":2,"label":"p","color":"red\\" onload=\\"x"}]}\n```\n' });
  expect(color.status).not.toBe(0);
  expect(color.stderr).toContain("01-a.md");
  expect(color.stderr).toContain("points[0].color");
  const value = build({ "01-a.md": '# A\n\n```chart\n{"type":"matrix","columns":["c"],"rows":["r"],"values":[["9\\"/>"]]}\n```\n' });
  expect(value.stderr).toContain("values[0][0] must be a finite number");
  const empty = build({ "01-a.md": '# A\n\n```chart\n{"rows":[]}\n```\n' });
  expect(empty.stderr).toContain("at least one row");
  const zero = build({ "01-a.md": '# A\n\n```chart\n{"type":"matrix","max":0,"columns":["c"],"rows":["r"],"values":[[0]]}\n```\n' });
  expect(zero.status).toBe(0);
  expect(zero.html).not.toContain("NaN");
  expect(zero.html).not.toContain("Infinity");
});
