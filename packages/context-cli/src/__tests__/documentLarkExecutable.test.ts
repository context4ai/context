import { test, expect } from "bun:test";
import { checkLarkCli } from "../lib/feishu.js";

test("Context uses a private Lark executable when configured", async () => {
  const previous = process.env.CONTEXT_LARK_CLI_BIN;
  process.env.CONTEXT_LARK_CLI_BIN = process.execPath;
  try {
    expect(await checkLarkCli()).toMatch(/^v?\d+\./u);
  } finally {
    if (previous === undefined) delete process.env.CONTEXT_LARK_CLI_BIN;
    else process.env.CONTEXT_LARK_CLI_BIN = previous;
  }
});
