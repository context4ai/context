import type { IndexerEvidenceAdapterResult } from "@c4a/core";

export type ConfigFormat = "json" | "yaml" | "toml" | "excluded";
export type ConfigValueType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "datetime";
export type ConfigValueClassification =
  | "container"
  | "scalar"
  | "secret-like"
  | "reference-like"
  | "enum-allowlisted";
export type ConfigBoundaryCandidate =
  | "entry"
  | "route"
  | "build"
  | "protocol"
  | "runtime"
  | "dependency";

export interface ConfigLocator {
  path: string;
  line: number;
  column: number;
  qualified_item_path: string;
}

export interface ConfigValueFact {
  config_ref: string;
  key_path: string[];
  value_type: ConfigValueType;
  classification: ConfigValueClassification;
  boundary_candidate: ConfigBoundaryCandidate | null;
  value_digest: string | null;
  normalized_value?: string | number | boolean | null;
  locator: ConfigLocator;
}

export interface ConfigDiagnostic {
  code:
    | "config-source-unsupported"
    | "config-enum-value-not-allowlisted";
  severity: "warning" | "error";
  locator: ConfigLocator;
  detail: string;
}

export interface ConfigDocumentCatalog {
  path: string;
  format: ConfigFormat;
  disposition: "analyzed" | "unsupported" | "excluded";
  values: ConfigValueFact[];
  diagnostics: ConfigDiagnostic[];
}

export type ConfigAllowlistedScalar = string | number | boolean | null;

export interface ConfigScalarAllowlistEntry {
  path: string;
  key_path: readonly string[];
  allowed_values: readonly ConfigAllowlistedScalar[];
}

export interface ConfigParseOptions {
  non_sensitive_enums?: readonly ConfigScalarAllowlistEntry[];
}

export interface ConfigEvidenceAdapterInvocation {
  adapter: IndexerEvidenceAdapterResult["adapter"];
  authorized_scope: IndexerEvidenceAdapterResult["authorized_scope"];
  input_digest: string;
  precedence: number;
  module_refs?: Readonly<Record<string, string | null>>;
  role?: "primary-owner" | "enricher";
}
