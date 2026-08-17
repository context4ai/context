export type LarkCaptureFidelitySeverity = "warning" | "error";

export interface LarkCaptureFidelityIssue {
  severity: LarkCaptureFidelitySeverity;
  impact: "evidence" | "projection";
  code: string;
  block_type: string;
  count: number;
  reason: string;
}

export const LARK_EMPTY_SUB_PAGE_LIST_CODE = "lark.capture.sub-page-list-empty";

export interface LarkCaptureFidelityReport {
  status: "complete" | "warning" | "error";
  evidence_status: "complete" | "error";
  projection_status: "complete" | "generic" | "warning" | "error";
  discovered: Record<string, number>;
  converted: Record<string, number>;
  skipped: Array<{
    block_type: string;
    count: number;
    reason: string;
  }>;
  issues: LarkCaptureFidelityIssue[];
}

function sortedCounts(counts: ReadonlyMap<string, number>): Record<string, number> {
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export class FidelityTracker {
  readonly discovered = new Map<string, number>();
  readonly converted = new Map<string, number>();
  readonly skipped = new Map<string, { blockType: string; reason: string; count: number }>();
  readonly issues = new Map<string, LarkCaptureFidelityIssue>();

  discover(blockType: string): void {
    this.discovered.set(blockType, (this.discovered.get(blockType) ?? 0) + 1);
  }

  convert(blockType: string): void {
    this.converted.set(blockType, (this.converted.get(blockType) ?? 0) + 1);
  }

  skip(blockType: string, reason: string, severity: LarkCaptureFidelitySeverity): void {
    const key = `${blockType}\0${reason}`;
    const current = this.skipped.get(key);
    this.skipped.set(key, { blockType, reason, count: (current?.count ?? 0) + 1 });
    const code = severity === "error" ? "lark.capture.fidelity-loss" : "lark.capture.unsupported-empty-block";
    const issueKey = `${severity}\0${code}\0${blockType}\0${reason}`;
    const issue = this.issues.get(issueKey);
    this.issues.set(issueKey, {
      severity,
      impact: "projection",
      code,
      block_type: blockType,
      count: (issue?.count ?? 0) + 1,
      reason,
    });
  }

  flag(
    blockType: string,
    reason: string,
    severity: LarkCaptureFidelitySeverity,
    code = severity === "error" ? "lark.capture.fidelity-loss" : "lark.capture.fidelity-warning",
    impact: LarkCaptureFidelityIssue["impact"] = severity === "error" ? "evidence" : "projection",
  ): void {
    const issueKey = `${severity}\0${impact}\0${code}\0${blockType}\0${reason}`;
    const issue = this.issues.get(issueKey);
    this.issues.set(issueKey, {
      severity,
      impact,
      code,
      block_type: blockType,
      count: (issue?.count ?? 0) + 1,
      reason,
    });
  }

  report(): LarkCaptureFidelityReport {
    const discovered = sortedCounts(this.discovered);
    const converted = sortedCounts(this.converted);
    const skipped = [...this.skipped.values()]
      .sort((left, right) => left.blockType.localeCompare(right.blockType) || left.reason.localeCompare(right.reason))
      .map((item) => ({ block_type: item.blockType, count: item.count, reason: item.reason }));
    for (const blockType of new Set([
      ...Object.keys(discovered),
      ...Object.keys(converted),
      ...skipped.map((item) => item.block_type),
    ])) {
      const skippedCount = skipped
        .filter((item) => item.block_type === blockType)
        .reduce((sum, item) => sum + item.count, 0);
      if ((converted[blockType] ?? 0) + skippedCount !== (discovered[blockType] ?? 0)) {
        throw new TypeError(
          `Lark XML projection fidelity does not close for ${blockType}: ` +
          `discovered ${discovered[blockType] ?? 0}, converted ${converted[blockType] ?? 0}, skipped ${skippedCount}`,
        );
      }
    }
    const issues = [...this.issues.values()]
      .sort((left, right) => left.severity.localeCompare(right.severity) || left.block_type.localeCompare(right.block_type));
    const evidenceStatus: LarkCaptureFidelityReport["evidence_status"] = issues.some(
      (issue) => issue.impact === "evidence" && issue.severity === "error",
    ) ? "error" : "complete";
    const projectionIssues = issues.filter((issue) => issue.impact === "projection");
    const projectionStatus: LarkCaptureFidelityReport["projection_status"] = projectionIssues.some(
      (issue) => issue.severity === "error",
    )
      ? "error"
      : projectionIssues.some((issue) => issue.code === "lark.capture.generic-projection")
        ? "generic"
        : projectionIssues.length > 0
          ? "warning"
          : "complete";
    return {
      status: evidenceStatus === "error" || projectionStatus === "error"
        ? "error"
        : issues.length > 0 ? "warning" : "complete",
      evidence_status: evidenceStatus,
      projection_status: projectionStatus,
      discovered,
      converted,
      skipped,
      issues,
    };
  }
}
