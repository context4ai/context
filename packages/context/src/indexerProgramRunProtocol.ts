import { z } from "zod";
import {
  indexerMainRunRequestSchema,
  indexerMainRunResultSchema,
  validateIndexerMainRunRequest,
  type IndexerMainRunRequest,
  type IndexerMainRunResult,
} from "./indexerMainRunProtocol.js";
import {
  indexerMaterialAnswerRunRequestSchema,
  indexerMaterialAnswerRunResultSchema,
  validateIndexerMaterialAnswerRunRequest,
  type IndexerMaterialAnswerRunRequest,
  type IndexerMaterialAnswerRunResult,
} from "./indexerMaterialAnswerRunProtocol.js";

export const indexerProgramRunRequestSchema = z.discriminatedUnion("operation", [
  indexerMainRunRequestSchema,
  indexerMaterialAnswerRunRequestSchema,
]);

export const indexerProgramRunResultSchema = z.discriminatedUnion("operation", [
  indexerMainRunResultSchema,
  indexerMaterialAnswerRunResultSchema,
]);

export type IndexerProgramRunRequest =
  | IndexerMainRunRequest
  | IndexerMaterialAnswerRunRequest;

export type IndexerProgramRunResult =
  | IndexerMainRunResult
  | IndexerMaterialAnswerRunResult;

export function validateIndexerProgramRunRequest(
  value: unknown,
): IndexerProgramRunRequest {
  const request = indexerProgramRunRequestSchema.parse(value);
  return request.operation === "main-index"
    ? validateIndexerMainRunRequest(request)
    : validateIndexerMaterialAnswerRunRequest(request);
}
