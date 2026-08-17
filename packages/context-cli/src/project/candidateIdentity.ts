import type { KnowledgeCollection } from "@c4a/context";
import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import { assertSafeEntityId } from "./entityId.js";

export function candidateIdFromViewRef(viewRef: string): string {
  const separator = viewRef.indexOf(":");
  if (separator <= 0 || separator === viewRef.length - 1) {
    throw new ContextError(ExitCode.WorkspaceStateError, `view_ref cannot derive candidate_id: ${viewRef}`, {
      category: ErrorCategory.SchemaInvalid,
      view_ref: viewRef,
    });
  }
  const candidateId = `${viewRef.slice(0, separator)}/${viewRef.slice(separator + 1)}`;
  assertSafeEntityId(candidateId);
  return candidateId;
}

export function viewRefFromCollectionNodeRef(collection: KnowledgeCollection, nodeRef: string): string {
  assertSafeEntityId(nodeRef);
  return `${collection}:${nodeRef}`;
}

export function candidateIdFromCollectionNodeRef(collection: KnowledgeCollection, nodeRef: string): string {
  return candidateIdFromViewRef(viewRefFromCollectionNodeRef(collection, nodeRef));
}

export function nodeRefFromViewRef(viewRef: string): string | undefined {
  const separator = viewRef.indexOf(":");
  if (separator <= 0 || separator === viewRef.length - 1) return undefined;
  return viewRef.slice(separator + 1);
}
