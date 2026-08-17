import type { LarkSourceRegistryEntry } from "@c4a/context";
import type { DocumentSnapshotManifest } from "@c4a/extract";

export type LarkSourceIdentityKind = "url" | "docToken" | "wikiToken";

export interface LarkSourceIdentity {
  kind: LarkSourceIdentityKind;
  value: string;
}

export function larkSourceIdentities(source: LarkSourceRegistryEntry): LarkSourceIdentity[] {
  return [
    source.url !== undefined && source.url.trim().length > 0
      ? { kind: "url" as const, value: source.url }
      : undefined,
    source.docToken !== undefined && source.docToken.trim().length > 0
      ? { kind: "docToken" as const, value: source.docToken }
      : undefined,
    source.wikiToken !== undefined && source.wikiToken.trim().length > 0
      ? { kind: "wikiToken" as const, value: source.wikiToken }
      : undefined,
  ].filter((identity): identity is LarkSourceIdentity => identity !== undefined);
}

export function larkSourceIdentityDiagnostic(source: LarkSourceRegistryEntry): string | null {
  const identities = larkSourceIdentities(source);
  if (identities.length === 1) return null;
  return `lark source ${source.name} must declare exactly one of url, docToken, or wikiToken`;
}

export function larkSnapshotIdentityDiagnostic(
  source: LarkSourceRegistryEntry,
  manifest: DocumentSnapshotManifest,
): string | null {
  const sourceDiagnostic = larkSourceIdentityDiagnostic(source);
  if (sourceDiagnostic !== null) return sourceDiagnostic;

  const identity = larkSourceIdentities(source)[0];
  if (identity === undefined) return `lark source ${source.name} is missing url, docToken, or wikiToken`;

  const manifestSource = manifest.metadata?.source;
  if (manifestSource === undefined || manifestSource[identity.kind] !== identity.value) {
    return `snapshot identity is stale for lark source ${source.name}: rerun context run capture:lark:${source.name}`;
  }
  return null;
}
