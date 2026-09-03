export interface StyleLocator {
  path: string;
  line: number;
  column: number;
  qualified_item_path: string;
}

export interface StyleImport {
  import_ref: string;
  kind: "import" | "use" | "forward";
  specifier: string | null;
  specifier_digest: string;
  resolution: "registered" | "external" | "builtin" | "package-or-load-path" | "unresolved";
  resolved_path: string | null;
  locator: StyleLocator;
}

export interface StyleToken {
  token_ref: string;
  name: string;
  syntax: "custom-property" | "scss-variable" | "property-rule";
  configurable: boolean;
  value_digest: string | null;
  locator: StyleLocator;
}

export interface StyleTokenReference {
  reference_ref: string;
  name: string;
  owner_qualified_item_path: string;
  locator: StyleLocator;
}

export interface StyleSelector {
  selector_ref: string;
  selector_digest: string;
  class_names: string[];
  id_names: string[];
  type_names: string[];
  pseudo_classes: string[];
  attribute_names: string[];
  locator: StyleLocator;
}

export interface StyleVariantState {
  evidence_ref: string;
  selector_ref: string;
  evidence_kind: "pseudo-class" | "state-attribute" | "class-modifier";
  name: string;
  locator: StyleLocator;
}

export interface StyleComponentCandidate {
  candidate_ref: string;
  name: string;
  basis: "module-file" | "class-root";
  selector_ref: string | null;
  locator: StyleLocator;
}

export interface StyleDiagnostic {
  code:
    | "style-import-dynamic-unsupported"
    | "style-import-unresolved"
    | "style-selector-dynamic-identity-omitted"
    | "style-selector-unsupported"
    | "style-source-unsupported";
  severity: "warning" | "error";
  locator: StyleLocator;
  detail: string;
}

export interface StyleDocumentCatalog {
  path: string;
  syntax: "css" | "scss" | "excluded";
  disposition: "analyzed" | "unsupported" | "excluded";
  imports: StyleImport[];
  tokens: StyleToken[];
  token_references: StyleTokenReference[];
  selectors: StyleSelector[];
  variants_and_states: StyleVariantState[];
  component_candidates: StyleComponentCandidate[];
  diagnostics: StyleDiagnostic[];
}
