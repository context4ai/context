import ts from "typescript";

const BUILTIN_TYPES = new Set([
  "Array", "Boolean", "Date", "Error", "Map", "Number", "Object", "Promise",
  "ReadonlyArray", "Record", "Set", "String",
]);

/** Only type-reference syntax denotes a type dependency. Comments, literal
 * values, member names and type-query expressions are not type references. */
export function referencedTypeNames(text: string | null | undefined): string[] {
  if (!text) return [];
  const file = ts.createSourceFile("type.ts", `type __Value = ${text};`, ts.ScriptTarget.Latest, true);
  const declaration = file.statements[0];
  if (!declaration || !ts.isTypeAliasDeclaration(declaration)) return [];
  const result = new Set<string>();
  const visit = (node: ts.Node, bound: ReadonlySet<string>) => {
    const scope = new Set(bound);
    if ("typeParameters" in node) {
      for (const parameter of (node as ts.SignatureDeclaration).typeParameters ?? []) {
        scope.add(parameter.name.text);
      }
    }
    if (ts.isMappedTypeNode(node)) {
      // The mapped key is only in scope after its constraint.
      if (node.typeParameter.constraint) visit(node.typeParameter.constraint, bound);
      scope.add(node.typeParameter.name.text);
      if (node.nameType) visit(node.nameType, scope);
      if (node.type) visit(node.type, scope);
      return;
    }
    if (ts.isConditionalTypeNode(node)) {
      visit(node.checkType, scope);
      visit(node.extendsType, scope);
      const inferred = new Set(scope);
      const collect = (child: ts.Node) => {
        if (ts.isInferTypeNode(child)) inferred.add(child.typeParameter.name.text);
        else if (!ts.isConditionalTypeNode(child)) ts.forEachChild(child, collect);
      };
      collect(node.extendsType);
      visit(node.trueType, inferred);
      visit(node.falseType, scope);
      return;
    }
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(file);
      if (!scope.has(name.split(".")[0]!) && !BUILTIN_TYPES.has(name)) result.add(name);
    }
    ts.forEachChild(node, (child) => visit(child, scope));
  };
  visit(declaration.type, new Set());
  return [...result];
}
