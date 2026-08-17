import { describe, expect, test } from "bun:test";
import {
  DAEMON_HEARTBEAT_INTERVAL,
  DAEMON_OFFLINE_THRESHOLD,
  DEFAULT_CLOUD_LIBRARY_NAME,
  DEFAULT_WORKSPACE_NAME,
} from "../constants.js";

describe("phase0 constants", () => {
  test("match PRD values", () => {
    expect(DEFAULT_WORKSPACE_NAME).toBe("My Brain");
  });
});

describe("source management constants", () => {
  test("match PRD values", () => {
    expect(DEFAULT_CLOUD_LIBRARY_NAME).toBe("My Drive");
    expect(DAEMON_HEARTBEAT_INTERVAL).toBe(30_000);
    expect(DAEMON_OFFLINE_THRESHOLD).toBe(60_000);
  });
});
