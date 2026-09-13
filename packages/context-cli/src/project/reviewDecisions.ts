import { readCandidateRecords } from "./candidateLedger.js";

export async function readRejectedDecisions(projectRoot: string): Promise<Map<string, string>> {
  return new Map((await readCandidateRecords(projectRoot))
    .filter(record => record.status === "rejected")
    .map(record => [record.candidate_id, record.fingerprint]));
}
