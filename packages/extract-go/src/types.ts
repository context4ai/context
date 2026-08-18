export type GoSymbolKind = "struct" | "interface" | "type" | "function" | "method" | "const" | "var";

export interface GoSourceLocation {
  path: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface GoImport {
  alias: string;
  path: string;
}

export interface GoSymbol {
  id: string;
  kind: GoSymbolKind;
  name: string;
  qualifiedName: string;
  package: string;
  receiver?: string;
  exported: boolean;
  signature: string;
  doc?: string;
  location: GoSourceLocation;
}

export interface GoCall {
  id: string;
  callee: string;
  selectorPath: string[];
  receiver?: string;
  method: string;
  arguments: string[];
  assignedTo?: string;
  importPath?: string;
  enclosingSymbol?: string;
  location: GoSourceLocation;
}

export type GoHttpFramework = "net-http" | "hertz" | "gin" | "echo" | "chi" | "unknown";

export interface GoHttpRoute {
  id: string;
  framework: GoHttpFramework;
  method: string;
  path: string;
  handler: string;
  receiver: string;
  arguments: string[];
  middleware: string[];
  enclosingSymbol?: string;
  location: GoSourceLocation;
}

export interface GoFileIndex {
  path: string;
  package: string;
  imports: GoImport[];
  symbols: GoSymbol[];
  calls: GoCall[];
  routes: GoHttpRoute[];
  parseErrors: number;
  lines: number;
}

export interface GoIndexOptions {
  exportedOnly?: boolean;
  includeTests?: boolean;
  includeGenerated?: boolean;
  include?: readonly string[];
  excludeDirectories?: readonly string[];
}

export interface GoRepositoryStats {
  discoveredFiles: number;
  analyzedFiles: number;
  skippedTestFiles: number;
  skippedGeneratedFiles: number;
  parseErrors: number;
  symbols: number;
  calls: number;
  routes: number;
}

export interface GoRepositoryIndex {
  root: string;
  options: {
    exportedOnly: boolean;
    includeTests: boolean;
    includeGenerated: boolean;
    include: string[];
    excludeDirectories: string[];
  };
  stats: GoRepositoryStats;
  files: GoFileIndex[];
}
