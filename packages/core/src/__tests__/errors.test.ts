import { describe, expect, test } from "bun:test";
import { C4AError, ErrorCode, mapErrorCodeToStatus } from "../errors/index.js";

describe("C4AError", () => {
  test("constructs with code, message, and details", () => {
    const error = new C4AError(ErrorCode.VALIDATION_FAILED, "Invalid", {
      field: "name",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(C4AError);
    expect(error.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(error.message).toBe("Invalid");
    expect(error.details).toEqual({ field: "name" });
    expect(error.toResponse()).toEqual({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Invalid",
      details: { field: "name" },
    });
  });

  test("omits details when not provided", () => {
    const error = new C4AError(ErrorCode.UNKNOWN, "Oops");
    expect(error.details).toBeUndefined();
    expect(error.toResponse()).toEqual({
      code: ErrorCode.UNKNOWN,
      message: "Oops",
    });
  });
});

describe("ErrorCode", () => {
  test("exposes defined error codes", () => {
    expect(ErrorCode.VALIDATION_FAILED).toBeDefined();
    expect(ErrorCode.STORAGE_FAILED).toBeDefined();
    expect(ErrorCode.PARSE_FAILED).toBeDefined();
    expect(ErrorCode.ENTITY_NOT_FOUND).toBeDefined();
    expect(ErrorCode.ENTITY_DUPLICATE).toBeDefined();
    expect(ErrorCode.RELATION_INVALID).toBeDefined();
    expect(ErrorCode.BATCH_PARTIAL_FAILURE).toBeDefined();
    expect(ErrorCode.STORAGE_CONFLICT).toBeDefined();
    expect(ErrorCode.QUERY_INVALID_PARAMS).toBeDefined();
    expect(ErrorCode.DAEMON_OFFLINE).toBeDefined();
    expect(ErrorCode.SOURCE_NOT_FOUND).toBeDefined();
    expect(ErrorCode.REPO_PATH_NOT_FOUND).toBeDefined();
    expect(ErrorCode.COMMIT_NOT_FOUND).toBeDefined();
    expect(ErrorCode.INDEX_IN_PROGRESS).toBeDefined();
    expect(ErrorCode.DIGEST_NOT_FOUND).toBeDefined();
    expect(ErrorCode.INVALID_REGEX).toBeDefined();
    expect(ErrorCode.SOURCE_ACCESS_DENIED).toBeDefined();
    expect(ErrorCode.SUB_PATH_CONFLICT).toBeDefined();
  });
});

describe("mapErrorCodeToStatus", () => {
  test("maps error codes to HTTP status", () => {
    expect(mapErrorCodeToStatus(ErrorCode.VALIDATION_FAILED)).toBe(400);
    expect(mapErrorCodeToStatus(ErrorCode.ENTITY_NOT_FOUND)).toBe(404);
    expect(mapErrorCodeToStatus(ErrorCode.ENTITY_DUPLICATE)).toBe(409);
    expect(mapErrorCodeToStatus(ErrorCode.BATCH_PARTIAL_FAILURE)).toBe(200);
    expect(mapErrorCodeToStatus(ErrorCode.DAEMON_OFFLINE)).toBe(503);
    expect(mapErrorCodeToStatus(ErrorCode.SOURCE_NOT_FOUND)).toBe(404);
    expect(mapErrorCodeToStatus(ErrorCode.REPO_PATH_NOT_FOUND)).toBe(422);
    expect(mapErrorCodeToStatus(ErrorCode.COMMIT_NOT_FOUND)).toBe(422);
    expect(mapErrorCodeToStatus(ErrorCode.INDEX_IN_PROGRESS)).toBe(409);
    expect(mapErrorCodeToStatus(ErrorCode.DIGEST_NOT_FOUND)).toBe(404);
    expect(mapErrorCodeToStatus(ErrorCode.INVALID_REGEX)).toBe(400);
    expect(mapErrorCodeToStatus(ErrorCode.SOURCE_ACCESS_DENIED)).toBe(403);
    expect(mapErrorCodeToStatus(ErrorCode.SUB_PATH_CONFLICT)).toBe(409);
  });
});
