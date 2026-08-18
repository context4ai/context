import * as ts from "typescript";

export interface ReactRouterSourceLocation {
  path: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type ReactRouterRouteKind = "page" | "group" | "redirect";

export interface ReactRouterRoute {
  id: string;
  kind: ReactRouterRouteKind;
  relativePath: string;
  fullPath: string;
  index: boolean;
  component?: string;
  componentSource?: string;
  componentCandidates: string[];
  redirectTo?: string;
  conditions: string[];
  note?: string;
  location: ReactRouterSourceLocation;
}

export interface ReactRouterExtractionOptions {
  routeIdPrefix?: string;
  mountPath?: string;
  ignoredComponentCandidates?: readonly string[];
}

interface ParsedSource {
  sourceFile: ts.SourceFile;
  imports: Map<string, string>;
  constants: Map<string, string | number | boolean>;
}

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function scalarValue(node: ts.Node | undefined): string | number | boolean | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

function findDynamicImport(node: ts.Node): string | undefined {
  let result: string | undefined;
  const visit = (child: ts.Node): void => {
    if (result) return;
    if (ts.isCallExpression(child) && child.expression.kind === ts.SyntaxKind.ImportKeyword && child.arguments[0] && ts.isStringLiteralLike(child.arguments[0])) {
      result = child.arguments[0].text;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return result;
}

function parseSource(source: string, filePath: string): ParsedSource {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = new Map<string, string>();
  const constants = new Map<string, string | number | boolean>();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const moduleSource = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause?.name) imports.set(clause.name.text, moduleSource);
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) imports.set(element.name.text, moduleSource);
      }
      if (bindings && ts.isNamespaceImport(bindings)) imports.set(bindings.name.text, moduleSource);
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const scalar = scalarValue(declaration.initializer);
      if (scalar !== undefined) constants.set(declaration.name.text, scalar);
      const dynamicImport = findDynamicImport(declaration.initializer);
      if (dynamicImport) imports.set(declaration.name.text, dynamicImport);
    }
  }
  return { sourceFile, imports, constants };
}

function locationFor(filePath: string, sourceFile: ts.SourceFile, node: ts.Node): ReactRouterSourceLocation {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return { path: filePath, startLine: start.line + 1, startColumn: start.character + 1, endLine: end.line + 1, endColumn: end.character + 1 };
}

function joinRoutePath(parent: string, child: string, index: boolean): string {
  if (index || !child || child === "/") return parent || "/";
  if (child.startsWith("/")) return child.replace(/\/{2,}/gu, "/");
  return `${parent.replace(/\/$/u, "")}/${child.replace(/^\//u, "")}`.replace(/\/{2,}/gu, "/");
}

function routeConditions(node: ts.Node, sourceFile: ts.SourceFile): string[] {
  const conditions: string[] = [];
  let current: ts.Node | undefined = node;
  while (current?.parent) {
    const parent: ts.Node = current.parent;
    if (ts.isConditionalExpression(parent)) {
      const condition = compact(parent.condition.getText(sourceFile));
      conditions.push(current === parent.whenTrue ? condition : `!(${condition})`);
    } else if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && current === parent.right) {
      conditions.push(compact(parent.left.getText(sourceFile)));
    }
    if (ts.isFunctionLike(parent)) break;
    current = parent;
  }
  return [...new Set(conditions.reverse())];
}

function jsxAttributes(node: ts.JsxOpeningLikeElement): Map<string, ts.JsxAttribute> {
  const result = new Map<string, ts.JsxAttribute>();
  for (const property of node.attributes.properties) if (ts.isJsxAttribute(property)) result.set(property.name.getText(), property);
  return result;
}

function jsxExpression(attribute: ts.JsxAttribute | undefined): ts.Expression | undefined {
  const initializer = attribute?.initializer;
  return initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined;
}

function jsxScalar(attribute: ts.JsxAttribute | undefined, constants: ReadonlyMap<string, string | number | boolean>): string | number | boolean | undefined {
  if (!attribute) return undefined;
  if (!attribute.initializer) return true;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  const expression = jsxExpression(attribute);
  return scalarValue(expression) ?? (expression && ts.isIdentifier(expression) ? constants.get(expression.text) : undefined);
}

function descendantTags(node: ts.Node): string[] {
  const tags = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      const opening = ts.isJsxElement(child) ? child.openingElement : child;
      const tag = opening.tagName.getText();
      if (child !== node && tag === "Route") return;
      if (!["Route", "Routes", "Suspense", "Fragment", "React.Fragment", "Navigate"].includes(tag)) tags.add(tag);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return [...tags];
}

function navigateTarget(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  let target: string | undefined;
  const visit = (child: ts.Node): void => {
    if (target) return;
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      const opening = ts.isJsxElement(child) ? child.openingElement : child;
      if (child !== node && opening.tagName.getText() === "Route") return;
      if (opening.tagName.getText() === "Navigate") {
        const attribute = jsxAttributes(opening).get("to");
        const scalar = jsxScalar(attribute, new Map());
        if (typeof scalar === "string") target = scalar;
        const expression = jsxExpression(attribute);
        if (!target && expression) {
          const text = expression.getText(sourceFile);
          target = text.match(/pathname\s*:\s*['"]([^'"]+)['"]/u)?.[1] ?? compact(text);
        }
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return target;
}

function leadingNote(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const prefix = sourceFile.text.slice(Math.max(0, node.getFullStart() - 600), node.getStart(sourceFile));
  const comments = [...prefix.matchAll(/\/\*+([\s\S]*?)\*\/|\/\/([^\n]*)/gu)];
  const value = comments.at(-1)?.[1] ?? comments.at(-1)?.[2];
  return value ? compact(value.replace(/^\s*\*\s?/gmu, "")) : undefined;
}

function componentSource(component: string | undefined, imports: ReadonlyMap<string, string>): string | undefined {
  const identifier = component?.match(/[A-Za-z_$][\w$]*/u)?.[0];
  return identifier ? imports.get(identifier) : undefined;
}

function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
    const key = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) ? property.name.text : undefined;
    if (key !== name) continue;
    return ts.isPropertyAssignment(property) ? property.initializer : property.name;
  }
  return undefined;
}

export function extractReactRouterRoutes(source: string, filePath: string, options: ReactRouterExtractionOptions = {}): ReactRouterRoute[] {
  const parsed = parseSource(source, filePath);
  const routeIdPrefix = options.routeIdPrefix ?? filePath;
  const mountPath = options.mountPath ?? "/";
  const ignoredCandidates = new Set(options.ignoredComponentCandidates ?? []);
  const routes: ReactRouterRoute[] = [];
  const relativePath = (fullPath: string): string => {
    if (mountPath === "/") return fullPath;
    if (fullPath === mountPath) return "/";
    return fullPath.startsWith(`${mountPath.replace(/\/$/u, "")}/`) ? fullPath.slice(mountPath.length) : fullPath;
  };
  const pushRoute = (input: { node: ts.Node; parentPath: string; path: string; index: boolean; component?: string; candidates?: string[]; redirectTo?: string; children?: ts.ArrayLiteralExpression }): void => {
    const fullPath = joinRoutePath(input.parentPath, input.path, input.index);
    const candidates = input.candidates ?? (input.component ? [input.component] : []);
    const location = locationFor(filePath, parsed.sourceFile, input.node);
    const sourceModule = componentSource(input.component ?? candidates[0], parsed.imports);
    const note = leadingNote(input.node, parsed.sourceFile);
    routes.push({
      id: `${routeIdPrefix}:${fullPath}:${location.startLine}`,
      kind: input.redirectTo ? "redirect" : input.component || candidates.length > 0 ? "page" : "group",
      relativePath: relativePath(fullPath),
      fullPath,
      index: input.index,
      ...(input.component ? { component: input.component } : candidates[0] ? { component: candidates[0] } : {}),
      ...(sourceModule ? { componentSource: sourceModule } : {}),
      componentCandidates: candidates,
      ...(input.redirectTo ? { redirectTo: input.redirectTo } : {}),
      conditions: routeConditions(input.node, parsed.sourceFile),
      ...(note ? { note } : {}),
      location,
    });
    if (input.children) visitRouteObjects(input.children, fullPath);
  };
  const visitRouteObjects = (array: ts.ArrayLiteralExpression, parentPath: string): void => {
    for (const element of array.elements) {
      if (!ts.isObjectLiteralExpression(element)) continue;
      const index = scalarValue(objectProperty(element, "index")) === true;
      const pathValue = scalarValue(objectProperty(element, "path"));
      const componentNode = objectProperty(element, "Component") ?? objectProperty(element, "element") ?? objectProperty(element, "lazy");
      const component = componentNode ? compact(componentNode.getText(parsed.sourceFile)) : undefined;
      const redirectNode = objectProperty(element, "redirectTo") ?? objectProperty(element, "to");
      const redirect = scalarValue(redirectNode);
      const children = objectProperty(element, "children");
      pushRoute({
        node: element,
        parentPath,
        path: typeof pathValue === "string" ? pathValue : "",
        index,
        ...(component ? { component } : {}),
        ...(typeof redirect === "string" ? { redirectTo: redirect } : {}),
        ...(children && ts.isArrayLiteralExpression(children) ? { children } : {}),
      });
    }
  };
  const visit = (node: ts.Node, parentPath: string): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      if (opening.tagName.getText() === "Route") {
        const attributes = jsxAttributes(opening);
        const index = jsxScalar(attributes.get("index"), parsed.constants) === true;
        const pathValue = jsxScalar(attributes.get("path"), parsed.constants);
        const componentNode = jsxExpression(attributes.get("Component"));
        const elementNode = jsxExpression(attributes.get("element"));
        const component = componentNode ? compact(componentNode.getText(parsed.sourceFile)) : undefined;
        const candidateNode = elementNode ?? componentNode ?? node;
        const candidates = (component ? [component] : descendantTags(candidateNode)).filter((candidate) => !ignoredCandidates.has(candidate));
        const fullPath = joinRoutePath(parentPath, typeof pathValue === "string" ? pathValue : "", index);
        const redirectTo = navigateTarget(candidateNode, parsed.sourceFile);
        pushRoute({ node, parentPath, path: typeof pathValue === "string" ? pathValue : "", index, ...(component ? { component } : {}), candidates, ...(redirectTo ? { redirectTo } : {}) });
        if (ts.isJsxElement(node)) for (const child of node.children) visit(child, fullPath);
        return;
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(parsed.sourceFile);
      if ((callee === "createBrowserRouter" || callee === "createHashRouter" || callee === "useRoutes") && node.arguments[0] && ts.isArrayLiteralExpression(node.arguments[0])) {
        visitRouteObjects(node.arguments[0], mountPath);
      }
    }
    ts.forEachChild(node, (child) => visit(child, parentPath));
  };
  visit(parsed.sourceFile, mountPath);
  return routes.sort((left, right) => left.fullPath.localeCompare(right.fullPath) || left.location.startLine - right.location.startLine || left.location.startColumn - right.location.startColumn);
}
