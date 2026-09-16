import { expect, test } from "bun:test";
import { createReviewFeedbackCodec } from "../project/reviewFeedbackCode.js";
import { reviewBodyDiff, reviewHtmlJson } from "../project/reviewSiteModel.js";
const codec = createReviewFeedbackCodec();
const feedback = { scope: "all", idsHash: "a".repeat(64), contentHash: "b".repeat(64), baselineHash: "c".repeat(64),
  statuses: ["revised", "approved", "rejected", "pending"] as Array<"revised"|"approved"|"rejected"|"pending">,
  repairs: [{ index: 0, instruction: "补全步骤\nUse 'example' </script> 🧭" }] };
test("feedback is lossless, bounded and tamper evident", () => {
  const code = codec.encode(feedback);
  expect(codec.decode(code)).toEqual(feedback);
  expect(() => codec.decode(code.slice(0,-1) + (code.endsWith("0") ? "1" : "0"))).toThrow();
  expect(() => codec.encode({ ...feedback, repairs: [] })).toThrow();
  expect(() => codec.encode({ ...feedback, repairs: [...feedback.repairs, ...feedback.repairs] })).toThrow();
  expect(() => codec.encode({ ...feedback, statuses: ["pending"] })).toThrow();
  expect(reviewHtmlJson(feedback)).not.toContain("</script>");
});
test("diff omits unchanged text, retains modified and removed blocks without splitting fences", () => {
  const old = "## API\n\nSame paragraph\n\nOld parameter\n\n```sh\n# comment\nrun\n```";
  const next = old.replace("Old parameter", "New parameter");
  const html = reviewBodyDiff(old, next);
  expect(html).toContain("New parameter");
  expect(html).toContain("Old parameter");
  expect(html).not.toContain("Same paragraph");
  expect(html).not.toContain("# comment");
  expect(reviewBodyDiff("", "```sh\n# comment\nrun\n```")).toContain("<pre><code># comment\nrun</code></pre>");
});
