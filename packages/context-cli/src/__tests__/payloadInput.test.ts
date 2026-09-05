import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { readPayloadTextFromStdin } from "../project/payloadInput.js";

describe("payload stdin", () => {
  test("finishes a newline-terminated JSON object without waiting for EOF", async () => {
    const stdin = new PassThrough();
    const reading = readPayloadTextFromStdin(stdin);

    stdin.write('{"stage":"partition"}\n');

    expect(await reading).toBe('{"stage":"partition"}\n');
    expect(stdin.readableFlowing).toBe(false);
    stdin.destroy();
  });

  test("keeps YAML input open until EOF", async () => {
    const stdin = new PassThrough();
    let settled = false;
    const reading = readPayloadTextFromStdin(stdin).then((value) => {
      settled = true;
      return value;
    });

    stdin.write("stage: partition\n");
    await Promise.resolve();
    expect(settled).toBe(false);

    stdin.end();
    expect(await reading).toBe("stage: partition\n");
  });
});
