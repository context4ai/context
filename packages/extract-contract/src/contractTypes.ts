export interface ContractLocator {
  path: string;
  line: number;
  column: number;
  qualified_item_path: string;
}

export interface ContractEndpoint {
  endpoint_ref: string;
  protocol: "openapi" | "graphql";
  path_or_type: string;
  locator: ContractLocator;
}

export interface ContractOperation {
  operation_ref: string;
  protocol: "openapi" | "graphql";
  operation_kind: string;
  name: string;
  parent: string;
  deprecated: boolean;
  locator: ContractLocator;
}

export interface ContractType {
  type_ref: string;
  protocol: "openapi" | "graphql";
  kind: string;
  name: string;
  extension: boolean;
  field_names: string[];
  locator: ContractLocator;
}

export interface ContractReference {
  reference_ref: string;
  protocol: "openapi" | "graphql";
  target_path: string;
  target_item_path: string;
  locator: ContractLocator;
}

export interface ContractDiagnostic {
  code:
    | "contract-source-unsupported"
    | "graphql-extension-base-ambiguous"
    | "graphql-extension-base-missing"
    | "graphql-schema-definition-ambiguous"
    | "graphql-type-definition-ambiguous"
    | "openapi-external-ref-cycle"
    | "openapi-ref-base-uri-unsupported"
    | "openapi-ref-missing"
    | "openapi-ref-out-of-scope"
    | "openapi-ref-pointer-missing"
    | "openapi-ref-target-unsupported";
  severity: "warning" | "error";
  locator: ContractLocator;
  detail: string;
}

export interface ContractDocumentCatalog {
  path: string;
  format: "openapi" | "openapi-fragment" | "graphql" | "excluded";
  version: string | null;
  disposition: "analyzed" | "unsupported" | "excluded";
  endpoints: ContractEndpoint[];
  operations: ContractOperation[];
  types: ContractType[];
  references: ContractReference[];
  diagnostics: ContractDiagnostic[];
}
