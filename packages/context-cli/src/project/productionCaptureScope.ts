import type { DocumentSourceStatus } from "./statusTypes.js";
import type { ProductionStage } from "./productionStage.js";
import { productionRequestedSources } from "./productionScope.js";
import type { ProductionRequirements } from "./productionRequirements.js";

/** Whether a source ref names this document source (a whole source or a path in it). */
export function documentSourceMatches(source: DocumentSourceStatus, ref: string): boolean {
  return [source.name, source.id].filter(Boolean).some(name =>
    ref === `${source.type}:${name}` || ref === `docs:${name}` ||
    ref.startsWith(`${source.type}:${name}#`) || ref.startsWith(`${source.type}:${name}/`));
}

/** Captured, or settled with a reported acquisition warning. */
export function documentSourceSettled(source: DocumentSourceStatus): boolean {
  return source.snapshotReady || source.acquisitionWarning !== undefined;
}

const documentRef = (source: DocumentSourceStatus) => `${source.type}:${source.name}`;

/** Production needs only its own request's documents. Documents of another
 * request that still wait for capture are deferred instead of blocking it. */
export function productionCaptureDocuments(stage: ProductionStage, documents: readonly DocumentSourceStatus[]) {
  const requested = productionRequestedSources(stage);
  const own = documents.filter(source => requested.some(ref => documentSourceMatches(source, ref)));
  const deferred = documents.filter(source => !own.includes(source) && !documentSourceSettled(source)).map(documentRef);
  return { documents: own, deferred };
}

/** Before a stage exists: the targets of requirements whose documents are all
 * captured can start production now; the other waiting documents are deferred. */
export function capturedRequirementTargets(requirements: ProductionRequirements, documents: readonly DocumentSourceStatus[]) {
  const ready = requirements.requirements.filter(item => {
    const refs = [...item.target_scope.targets, ...item.evidence_source_scope?.targets ?? []].map(target => target.source_ref);
    return documents.filter(source => refs.some(ref => documentSourceMatches(source, ref))).every(documentSourceSettled);
  });
  const targets = [...new Set(ready.flatMap(item => item.target_scope.targets.map(target => target.source_ref)))];
  const readyRefs = ready.flatMap(item => [...item.target_scope.targets, ...item.evidence_source_scope?.targets ?? []].map(target => target.source_ref));
  const deferred = documents.filter(source => !documentSourceSettled(source) && !readyRefs.some(ref => documentSourceMatches(source, ref))).map(documentRef);
  return { targets, deferred };
}
