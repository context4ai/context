import {
  Kind,
  Source,
  parse,
  type DefinitionNode,
  type DocumentNode,
  type FieldDefinitionNode,
  type GraphQLError,
  type NameNode,
  type OperationDefinitionNode,
  type TypeDefinitionNode,
  type TypeExtensionNode,
} from "graphql";
import type {
  ContractDiagnostic,
  ContractDocumentCatalog,
  ContractEndpoint,
  ContractLocator,
  ContractOperation,
  ContractReference,
  ContractType,
} from "./contractTypes.js";

interface ParsedGraphQl {
  path: string;
  ast: DocumentNode | null;
  error: GraphQLError | null;
}

const TYPE_DEFINITION_KINDS = new Set<string>([
  Kind.OBJECT_TYPE_DEFINITION,
  Kind.INTERFACE_TYPE_DEFINITION,
  Kind.INPUT_OBJECT_TYPE_DEFINITION,
  Kind.ENUM_TYPE_DEFINITION,
  Kind.UNION_TYPE_DEFINITION,
  Kind.SCALAR_TYPE_DEFINITION,
]);
const TYPE_EXTENSION_KINDS = new Set<string>([
  Kind.OBJECT_TYPE_EXTENSION,
  Kind.INTERFACE_TYPE_EXTENSION,
  Kind.INPUT_OBJECT_TYPE_EXTENSION,
  Kind.ENUM_TYPE_EXTENSION,
  Kind.UNION_TYPE_EXTENSION,
  Kind.SCALAR_TYPE_EXTENSION,
]);

function empty(path: string): ContractDocumentCatalog {
  return { path, format: "graphql", version: null, disposition: "analyzed", endpoints: [], operations: [], types: [], references: [], diagnostics: [] };
}

function parseSource(path: string, source: string): ParsedGraphQl {
  try {
    return { path, ast: parse(new Source(source, path), { noLocation: false }), error: null };
  } catch (error) {
    return { path, ast: null, error: error as GraphQLError };
  }
}

function locator(path: string, node: { loc?: { startToken: { line: number; column: number } } }, qualifiedItemPath: string): ContractLocator {
  return {
    path,
    line: node.loc?.startToken.line ?? 1,
    column: node.loc?.startToken.column ?? 1,
    qualified_item_path: qualifiedItemPath,
  };
}

function namedDefinition(value: DefinitionNode): value is (TypeDefinitionNode | TypeExtensionNode) & { name: NameNode } {
  return (TYPE_DEFINITION_KINDS.has(value.kind) || TYPE_EXTENSION_KINDS.has(value.kind)) && "name" in value;
}

function fieldsOf(value: DefinitionNode): readonly FieldDefinitionNode[] {
  return "fields" in value && Array.isArray(value.fields)
    ? value.fields as readonly FieldDefinitionNode[]
    : [];
}

function kindName(kind: string): string {
  return kind
    .replace(/(?:Type)?(?:Definition|Extension)$/u, "")
    .replace(/([a-z])([A-Z])/gu, "$1-$2")
    .toLowerCase();
}

function deprecated(field: FieldDefinitionNode): boolean {
  return field.directives?.some((directive) => directive.name.value === "deprecated") ?? false;
}

function rootOperationNames(parsed: readonly ParsedGraphQl[], schemaDefinitionCount: number): Map<string, string> {
  const roots = schemaDefinitionCount === 0
    ? new Map<string, string>([["Query", "query"], ["Mutation", "mutation"], ["Subscription", "subscription"]])
    : new Map<string, string>();
  for (const document of parsed) {
    for (const definition of document.ast?.definitions ?? []) {
      if (definition.kind !== Kind.SCHEMA_DEFINITION && definition.kind !== Kind.SCHEMA_EXTENSION) continue;
      for (const operation of definition.operationTypes ?? []) roots.set(operation.type.name.value, operation.operation);
    }
  }
  return roots;
}

function operationName(operation: OperationDefinitionNode, ordinal: number, path: string): string {
  return operation.name?.value ?? `${path}#anonymous-${operation.operation}:${ordinal}`;
}

function syntaxDiagnostic(document: ParsedGraphQl): ContractDiagnostic | null {
  if (document.error === null) return null;
  const location = document.error.locations?.[0];
  return {
    code: "contract-source-unsupported",
    severity: "error",
    locator: { path: document.path, line: location?.line ?? 1, column: location?.column ?? 1, qualified_item_path: "file" },
    detail: document.error.message,
  };
}

export function parseGraphQlSources(files: Readonly<Record<string, string>>): Map<string, ContractDocumentCatalog> {
  const parsed = Object.entries(files)
    .filter(([path]) => /\.(?:graphql|gql)$/iu.test(path))
    .map(([path, source]) => parseSource(path, source));
  const catalogs = new Map(parsed.map((document) => [document.path, empty(document.path)]));
  const bases = new Map<string, Array<{ path: string; definition: DefinitionNode }>>();
  const schemaDefinitions: Array<{ path: string; definition: DefinitionNode }> = [];
  for (const document of parsed) {
    for (const definition of document.ast?.definitions ?? []) {
      if (definition.kind === Kind.SCHEMA_DEFINITION) schemaDefinitions.push({ path: document.path, definition });
      if (!TYPE_DEFINITION_KINDS.has(definition.kind) || !namedDefinition(definition)) continue;
      const entries = bases.get(definition.name.value) ?? [];
      entries.push({ path: document.path, definition });
      bases.set(definition.name.value, entries);
    }
  }
  for (const [name, entries] of bases) {
    if (entries.length < 2) continue;
    for (const entry of entries) {
      const catalog = catalogs.get(entry.path)!;
      catalog.disposition = "unsupported";
      catalog.diagnostics.push({ code: "graphql-type-definition-ambiguous", severity: "error", locator: locator(entry.path, entry.definition, `type:${name}`), detail: `multiple registered GraphQL base definitions exist for ${name}` });
    }
  }
  if (schemaDefinitions.length > 1) {
    for (const entry of schemaDefinitions) {
      const catalog = catalogs.get(entry.path)!;
      catalog.disposition = "unsupported";
      catalog.diagnostics.push({
        code: "graphql-schema-definition-ambiguous",
        severity: "error",
        locator: locator(entry.path, entry.definition, "schema"),
        detail: "multiple registered GraphQL schema definitions exist",
      });
    }
  }
  const roots = rootOperationNames(parsed, schemaDefinitions.length);
  for (const document of parsed) {
    const catalog = catalogs.get(document.path)!;
    const syntax = syntaxDiagnostic(document);
    if (syntax !== null) {
      catalog.disposition = "unsupported";
      catalog.diagnostics.push(syntax);
      continue;
    }
    let executableOrdinal = 0;
    for (const definition of document.ast!.definitions) {
      if (definition.kind === Kind.OPERATION_DEFINITION) {
        executableOrdinal += 1;
        const name = operationName(definition, executableOrdinal, document.path);
        catalog.operations.push({ operation_ref: `${document.path}#operation:${name}`, protocol: "graphql", operation_kind: definition.operation, name, parent: "executable-document", deprecated: false, locator: locator(document.path, definition, `operation:${name}`) });
        continue;
      }
      if (!namedDefinition(definition)) continue;
      const name = definition.name.value;
      const extension = TYPE_EXTENSION_KINDS.has(definition.kind);
      const fields = fieldsOf(definition);
      const type: ContractType = {
        type_ref: `${document.path}#type:${name}${extension ? ":extension" : ""}`,
        protocol: "graphql",
        kind: kindName(definition.kind),
        name,
        extension,
        field_names: fields.map((field) => field.name.value).sort(),
        locator: locator(document.path, definition, `type:${name}${extension ? ":extension" : ""}`),
      };
      catalog.types.push(type);
      if (extension) {
        const base = bases.get(name) ?? [];
        if (base.length !== 1) {
          catalog.disposition = "unsupported";
          catalog.diagnostics.push({
            code: base.length === 0 ? "graphql-extension-base-missing" : "graphql-extension-base-ambiguous",
            severity: "error",
            locator: type.locator,
            detail: base.length === 0 ? `GraphQL extension base ${name} is not registered` : `GraphQL extension base ${name} is ambiguous`,
          });
        } else {
          const reference: ContractReference = { reference_ref: `${document.path}#extension:${name}`, protocol: "graphql", target_path: base[0]!.path, target_item_path: `type:${name}`, locator: type.locator };
          catalog.references.push(reference);
        }
      }
      const operationKind = roots.get(name);
      if (operationKind === undefined) continue;
      const endpoint: ContractEndpoint = { endpoint_ref: `${document.path}#root:${name}`, protocol: "graphql", path_or_type: name, locator: type.locator };
      catalog.endpoints.push(endpoint);
      for (const field of fields) {
        const fieldName = field.name.value;
        const operation: ContractOperation = { operation_ref: `${document.path}#root:${name}:field:${fieldName}`, protocol: "graphql", operation_kind: operationKind, name: fieldName, parent: name, deprecated: deprecated(field), locator: locator(document.path, field, `operation:${operationKind}:${name}.${fieldName}`) };
        catalog.operations.push(operation);
      }
    }
  }
  return catalogs;
}
