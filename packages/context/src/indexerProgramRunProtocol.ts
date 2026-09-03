import {
  indexerMainRunRequestSchema,
  indexerMainRunResultSchema,
  validateIndexerMainRunRequest,
  type IndexerMainRunRequest,
  type IndexerMainRunResult,
} from "./indexerMainRunProtocol.js";

export const indexerProgramRunRequestSchema = indexerMainRunRequestSchema;
export const indexerProgramRunResultSchema = indexerMainRunResultSchema;

export type IndexerProgramRunRequest = IndexerMainRunRequest;
export type IndexerProgramRunResult = IndexerMainRunResult;

export function validateIndexerProgramRunRequest(
  value: unknown,
): IndexerProgramRunRequest {
  return validateIndexerMainRunRequest(value);
}
