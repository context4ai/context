import ts from "typescript";

/** Recognize the declared React callable type, not a similarly named Props type. */
export function componentPropsNode(node: ts.TypeNode | undefined): ts.TypeNode | undefined {
  if (node === undefined || !ts.isTypeReferenceNode(node)) return undefined;
  if (!["FC", "React.FC", "FunctionComponent", "React.FunctionComponent"].includes(node.typeName.getText())) return undefined;
  return node.typeArguments?.length === 1 ? node.typeArguments[0] : undefined;
}

/** Only React's additive wrapper preserves local Props when its declaration
 * is unavailable. A same-named local or third-party generic may transform P. */
export function componentLocalPropsNode(node: ts.TypeNode, checker: ts.TypeChecker): ts.TypeNode | undefined {
  if (ts.isParenthesizedTypeNode(node)) return componentLocalPropsNode(node.type, checker);
  if (!ts.isTypeReferenceNode(node) || node.typeArguments?.length !== 1) return undefined;
  const name = node.typeName;
  const identifier = ts.isIdentifier(name) ? name : ts.isIdentifier(name.left) ? name.left : undefined;
  if (identifier === undefined) return undefined;
  const imported = checker.getSymbolAtLocation(identifier)?.declarations?.find(declaration =>
    ts.isImportSpecifier(declaration) || ts.isNamespaceImport(declaration) || ts.isImportClause(declaration));
  if (imported === undefined) return undefined;
  let owner: ts.Node = imported;
  while (!ts.isImportDeclaration(owner) && owner.parent !== undefined) owner = owner.parent;
  if (!ts.isImportDeclaration(owner) || !ts.isStringLiteral(owner.moduleSpecifier)
    || owner.moduleSpecifier.text !== "react") return undefined;
  const wrapper = ts.isIdentifier(name)
    ? ts.isImportSpecifier(imported) ? (imported.propertyName ?? imported.name).text : undefined
    : (ts.isNamespaceImport(imported) || ts.isImportClause(imported)) ? name.right.text : undefined;
  return wrapper === "PropsWithChildren" ? node.typeArguments[0] : undefined;
}

export function componentPropsName(annotation: string): string | undefined {
  const source = ts.createSourceFile("contract.ts", `type Contract = ${annotation};`, ts.ScriptTarget.Latest, true);
  const declaration = source.statements[0];
  if (declaration === undefined || !ts.isTypeAliasDeclaration(declaration)) return undefined;
  const props = componentPropsNode(declaration.type);
  return props !== undefined && ts.isTypeReferenceNode(props) && ts.isIdentifier(props.typeName)
    && !props.typeArguments?.length ? props.typeName.text : undefined;
}

/** Parse retained parameter syntax; never execute initializer expressions. */
export function componentBindingDefaults(pattern: string): Record<string, string> {
  const source = ts.createSourceFile("contract.ts", `function input(${pattern}) {}`, ts.ScriptTarget.Latest, true);
  const diagnostics = (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  const fn = source.statements[0];
  if (diagnostics.length || source.statements.length !== 1 || fn === undefined || !ts.isFunctionDeclaration(fn)
    || fn.parameters.length !== 1 || fn.body?.statements.length) return {};
  const name = fn.parameters[0]!.name;
  return componentDefaultsFromBinding(name, source);
}

/** Property identity is the source key, including quoted aliases, not the
 * local variable name. Dynamic computed keys cannot establish a field link. */
export function componentDefaultsFromBinding(name: ts.BindingName, source: ts.SourceFile): Record<string, string> {
  if (!ts.isObjectBindingPattern(name)) return {};
  const defaults: Record<string, string> = Object.create(null);
  for (const element of name.elements) {
    const key = element.propertyName ?? element.name;
    if (element.initializer === undefined || element.dotDotDotToken !== undefined
      || (!ts.isIdentifier(key) && !ts.isStringLiteral(key) && !ts.isNumericLiteral(key))) continue;
    defaults[key.text] = element.initializer.getText(source);
  }
  return defaults;
}
