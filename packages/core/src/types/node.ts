export enum NodeType {
  Product = "product",
  Package = "package",
  Symbol = "symbol",
}

export enum ProductKind {
  Domain = "domain",
  Application = "application",
  Story = "story",
}

export enum PackageKind {
  App = "app",
  Service = "service",
  Lib = "lib",
  Cli = "cli",
}

export enum SymbolKind {
  Function = "function",
  Class = "class",
  Interface = "interface",
  Variable = "variable",
  Type = "type",
  Enum = "enum",
  Component = "component",
  Prop = "prop",
  Method = "method",
  Endpoint = "endpoint",
  Config = "config",
  Hook = "hook",
  Process = "process",
}

export type NodeKind = ProductKind | PackageKind | SymbolKind;

export enum Grounding {
  Code = "code",
  Concept = "concept",
}

export enum Visibility {
  Exported = "exported",
  Public = "public",
  Protected = "protected",
  Internal = "internal",
}

export interface NodeRecord {
  id: string;
  type: NodeType;
  kind: NodeKind;
  grounding: Grounding;
  name: string;
  language: string | null;
  visibility: Visibility | null;
  source_id: string | null;
  valid_from: number | null;
  valid_until: number | null;
  created_at: string;
  updated_at: string;
}
