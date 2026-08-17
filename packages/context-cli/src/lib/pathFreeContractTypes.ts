export type CommandViewClass = "production-semantic" | "human-view" | "debug-only" | "out-of-scope";

export interface CommandMatrixEntry {
  command: string;
  view: CommandViewClass;
  handles: readonly string[];
  notes: string;
}

export interface PathFieldInventoryEntry {
  field: string;
  policy: "remove-from-default" | "external-input" | "human-only" | "debug-only" | "internal-only";
  semanticReplacement: string;
  debugEquivalent: string;
}
