export interface MdxLocator {
  path: string;
  line: number;
  column: number;
}

export interface MdxPublicTarget {
  target_ref: string;
  export_name: string;
  source_module?: string;
}

export interface MdxImportBinding {
  source_module: string;
  imported_name: string;
  local_name: string;
  locator: MdxLocator;
}

export interface MdxExportBinding {
  exported_name: string;
  source_module: string | null;
  local_name: string | null;
  locator: MdxLocator;
}

export interface MdxComponentReference {
  component_name: string;
  root_name: string;
  source_module: string | null;
  imported_name: string | null;
  target_ref: string | null;
  example_ref: string | null;
  locator: MdxLocator;
}

export type MdxExampleKind =
  | "code-block"
  | "demo-host"
  | "sandbox-host"
  | "story-host"
  | "document-host";

export interface MdxExample {
  example_ref: string;
  kind: MdxExampleKind;
  language: string | null;
  meta_tokens: string[];
  content_digest: string;
  component_names: string[];
  target_refs: string[];
  parse_supported: boolean;
  locator: MdxLocator;
}

export interface MdxDiagnostic {
  code: "mdx-code-block-syntax-unsupported" | "mdx-source-unsupported";
  severity: "warning" | "error";
  locator: MdxLocator;
  detail: string;
}

export interface MdxDocumentCatalog {
  path: string;
  disposition: "analyzed" | "unsupported" | "excluded";
  imports: MdxImportBinding[];
  exports: MdxExportBinding[];
  components: MdxComponentReference[];
  examples: MdxExample[];
  diagnostics: MdxDiagnostic[];
}

export interface MdxAstNode {
  type?: string;
  name?: string | null;
  value?: string;
  lang?: string | null;
  meta?: string | null;
  children?: unknown;
  data?: unknown;
  position?: {
    start?: { line?: number; column?: number };
  };
}
