import { readFile } from "node:fs/promises";
import ts from "typescript";
import { withProjectWriteLock } from "./writeLock.js";
import { safeProjectTarget } from "./durableMultiFileTransaction.js";
import { durableContentDigest, runDurableSingleFileTransaction } from "./durableSingleFileTransaction.js";

export interface ConfigurationSource { type: "repo" | "file" | "lark"; name: string }

/** Only edit statically recognizable declarations. Dynamic expressions retain
 * the ordinary manual configuration path, rather than being evaluated or guessed. */
export function generateSourceConfiguration(text: string, selected: ConfigurationSource[]): string | undefined {
  const file = ts.createSourceFile("index.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (ts.transpileModule(text, { reportDiagnostics: true }).diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) return undefined;
  const imports = file.statements.filter(ts.isImportDeclaration).filter(node =>
    ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "@c4a/context");
  if (imports.length !== 1) return undefined;
  const bindings = imports[0]!.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings) || imports[0]!.importClause?.isTypeOnly) return undefined;
  const aliases = new Map(bindings.elements.filter(item => !item.isTypeOnly).map(item =>
    [item.propertyName?.text ?? item.name.text, item.name.text]));
  const call = (node: ts.Node | undefined, api: string): node is ts.CallExpression =>
    !!node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === aliases.get(api);
  const exports = file.statements.filter(ts.isExportAssignment);
  if (exports.length !== 1 || !call(exports[0]!.expression, "defineProject")) return undefined;
  const definition = exports[0]!.expression as ts.CallExpression;
  const object = definition.arguments[0];
  if (definition.arguments.length !== 1 || !object || !ts.isObjectLiteralExpression(object)) return undefined;
  if (object.properties.some(item => !ts.isPropertyAssignment(item) || !ts.isIdentifier(item.name))) return undefined;
  const properties = object.properties.filter(ts.isPropertyAssignment);
  if (new Set(properties.map(item => item.name.getText(file))).size !== properties.length) return undefined;
  const array = (name: string) => {
    const value = properties.find(item => item.name.getText(file) === name)?.initializer;
    return value && ts.isArrayLiteralExpression(value) ? value : undefined;
  };
  const sources = array("sources"), phases = array("phases");
  if (!sources || !phases) return undefined;
  const variables = new Map<string, ts.Expression>();
  for (const statement of file.statements) if (ts.isVariableStatement(statement)) {
    if (!(statement.declarationList.flags & ts.NodeFlags.Const)) return undefined;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) variables.set(declaration.name.text, declaration.initializer);
    }
  }
  // No top-level execution: it could mutate the declarative arrays after loading.
  if (file.statements.some(node => !ts.isImportDeclaration(node) && !ts.isVariableStatement(node) && !ts.isExportAssignment(node))) return undefined;
  const identity = (expression: ts.Expression | undefined): string | undefined => {
    const node = expression && ts.isIdentifier(expression) ? variables.get(expression.text) : expression;
    if (!call(node, "source")) return undefined;
    const args = [...node.arguments];
    if (!args[0] || !ts.isStringLiteral(args[0])) return undefined;
    let name = args[0].text;
    let options = args[1];
    const namespaced = !!options && ts.isStringLiteral(options);
    if (namespaced) { name += `/${(options as ts.StringLiteral).text}`; options = args[2]; }
    if (args.length > (namespaced ? 3 : 2)) return undefined;
    // A one-argument reference is registry-resolved, not implicitly a repo.
    // Only the namespace/module overload has a documented repo default.
    if (!namespaced && !options) return undefined;
    let type = "repo";
    if (options) {
      // Never infer through spreads, computed keys, duplicate keys or getters:
      // their runtime value can override the first apparent type property.
      if (!ts.isObjectLiteralExpression(options) || options.properties.length !== 1) return undefined;
      const prop = options.properties[0];
      if (!prop || !ts.isPropertyAssignment(prop) ||
          !(ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) || prop.name.text !== "type" ||
          !ts.isStringLiteral(prop.initializer)) return undefined;
      type = prop.initializer.text;
    }
    return `${type}:${name}`;
  };
  const existing = new Set<string>(), captured = new Set<string>();
  for (const node of sources.elements) {
    const key = identity(node);
    if (!key || existing.has(key)) return undefined;
    existing.add(key);
  }
  for (const expression of phases.elements) {
    const node = ts.isIdentifier(expression) ? variables.get(expression.text) : expression;
    if (!call(node, "captureLark") && !call(node, "captureFile")) return undefined;
    const options = node.arguments[0];
    if (!options || !ts.isObjectLiteralExpression(options) || options.properties.some(ts.isSpreadAssignment)) return undefined;
    const prop = options.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(file) === "source");
    const key = prop && ts.isPropertyAssignment(prop) ? identity(prop.initializer) : undefined;
    if (!key || captured.has(key)) return undefined;
    captured.add(key);
  }
  const additions: string[] = [], captures: string[] = [], needed = new Set<string>();
  const api = (name: string) => { if (!aliases.has(name)) needed.add(name); return aliases.get(name) ?? name; };
  for (const item of selected) {
    const key = `${item.type}:${item.name}`;
    if (existing.has(key) && (item.type === "repo" || captured.has(key))) continue;
    const reference = `${api("source")}(${JSON.stringify(item.name)}, { type: ${JSON.stringify(item.type)} })`;
    if (!existing.has(key)) { additions.push(reference); existing.add(key); }
    if (item.type !== "repo" && !captured.has(key)) {
      captures.push(`${api(item.type === "lark" ? "captureLark" : "captureFile")}({ source: ${reference} })`);
      captured.add(key);
    }
  }
  if (!additions.length && !captures.length) return text;
  // Avoid introducing imports that collide with local declarations or other imports.
  const identifiers = new Set<string>();
  const visit = (node: ts.Node) => { if (ts.isIdentifier(node)) identifiers.add(node.text); ts.forEachChild(node, visit); };
  visit(file);
  if ([...needed].some(name => identifiers.has(name))) return undefined;
  const edits: Array<{ start: number; end: number; value: string }> = [];
  for (const [node, values] of [[sources, additions], [phases, captures]] as const) if (values.length) {
    const at = node.elements.length ? node.elements[node.elements.length - 1]!.end : node.getStart(file) + 1;
    edits.push({ start: at, end: at, value: `${node.elements.length ? "," : ""}\n    ${values.join(",\n    ")}` });
  }
  if (needed.size) edits.push({ start: bindings.getStart(file) + 1, end: bindings.getStart(file) + 1, value: ` ${[...needed].join(", ")},` });
  return edits.sort((a, b) => b.start - a.start).reduce((result, edit) => result.slice(0, edit.start) + edit.value + result.slice(edit.end), text);
}

export async function configureRegisteredSources(projectRoot: string, selected: ConfigurationSource[]) {
  return withProjectWriteLock(projectRoot, "source-project-configuration", async () => {
    const path = "src/index.ts";
    const config = JSON.parse(await readFile(await safeProjectTarget(projectRoot, "package.json"), "utf8")) as { context?: { entry?: string } };
    if (config.context?.entry !== path) return { status: "manual" as const, file: config.context?.entry ?? path,
      message: "Registration is saved. Preserve the custom entry location and configure these sources there.", sources: selected };
    const target = await safeProjectTarget(projectRoot, path);
    const text = await readFile(target, "utf8");
    const updated = generateSourceConfiguration(text, selected);
    if (updated === undefined) return { status: "manual" as const, file: path,
      message: "Registration is saved. Preserve the custom project entry and configure only these sources manually.", sources: selected };
    if (updated !== text) await runDurableSingleFileTransaction({ projectRoot, kind: "source-project-configuration",
      target_path: path, expected_base_digest: durableContentDigest(text), target_content: updated });
    return { status: updated === text ? "unchanged" as const : "configured" as const, file: path };
  });
}
