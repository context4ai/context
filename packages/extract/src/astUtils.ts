import Parser from "web-tree-sitter";

type SyntaxNode = Parser.SyntaxNode;

export const getNodeText = (node: SyntaxNode, source: string) =>
  source.slice(node.startIndex, node.endIndex);

export const buildLineStarts = (source: string) => {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
};

export const getLineNumber = (lineStarts: number[], index: number) => {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = lineStarts[mid] ?? 0;
    const next =
      mid + 1 < lineStarts.length
        ? (lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY)
        : Number.POSITIVE_INFINITY;
    if (index >= start && index < next) {
      return mid + 1;
    }
    if (index < start) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  return lineStarts.length;
};

export const stripQuotes = (value: string) =>
  value.replace(/^['"]/, "").replace(/['"]$/, "");

export const extractTypeAnnotation = (node: SyntaxNode | null, source: string) => {
  if (!node) return null;
  const text = getNodeText(node, source).trim();
  return text.replace(/^:\s*/, "").trim() || null;
};

export const getFirstIdentifier = (node: SyntaxNode | null, source: string) => {
  if (!node) return null;
  if (node.type === "identifier" || node.type === "property_identifier") {
    return getNodeText(node, source);
  }
  const identifier = node.descendantsOfType([
    "identifier",
    "property_identifier",
  ])[0];
  return identifier ? getNodeText(identifier, source) : null;
};

export const isNodeExported = (node: SyntaxNode, source: string) => {
  const parentType = node.parent?.type;
  if (parentType === "export_statement" || parentType === "export_declaration") {
    return true;
  }
  const prefixStart = Math.max(0, node.startIndex - 20);
  const prefix = source.slice(prefixStart, node.startIndex);
  return /\bexport\b/.test(prefix);
};

/** Extract the param name from a single object_pattern member (handles defaults). */
function extractPatternMemberName(node: SyntaxNode, source: string): string {
  // `key = defaultValue` → take the first named child (the key, before `=`)
  if (node.type === "assignment_pattern" || node.type === "object_assignment_pattern") {
    const left = node.childForFieldName?.("left") ?? node.namedChildren[0];
    if (left) return getNodeText(left, source);
  }
  // `key: alias` pair_pattern → take the first named child (the key)
  if (node.type === "pair_pattern") {
    const key = node.childForFieldName?.("key") ?? node.namedChildren[0];
    if (key) return getNodeText(key, source);
  }
  // shorthand_property_identifier_pattern or identifier
  return getNodeText(node, source);
}

/**
 * Extract the innermost type argument from FC<T> / React.FC<T> / FC<PropsWithChildren<T>>.
 * Returns the type name (e.g. "MyProps") or null.
 */
function extractFCPropsType(varTypeNode: SyntaxNode | null, source: string): string | null {
  if (!varTypeNode) return null;
  const genericTypes = varTypeNode.descendantsOfType("generic_type");
  for (const gt of genericTypes) {
    const nameText = getNodeText(gt.namedChildren[0]!, source);
    if (nameText === "FC" || nameText === "React.FC" || nameText === "React.FunctionComponent") {
      // Get innermost type_arguments — handles FC<PropsWithChildren<MyProps>>
      const allTypeArgs = gt.descendantsOfType("type_arguments");
      const innermost = allTypeArgs[allTypeArgs.length - 1];
      if (innermost && innermost.namedChildCount > 0) {
        return getNodeText(innermost.namedChildren[0]!, source);
      }
    }
  }
  return null;
}

export const extractParams = (paramsNode: SyntaxNode | null, source: string, varTypeNode?: SyntaxNode | null) => {
  if (!paramsNode) return [];
  const result: Array<{ name: string; type: string | null }> = [];
  // FC<Props> fallback: when destructured params have no inline type, use the Props from FC<T>
  const fcPropsType = extractFCPropsType(varTypeNode ?? null, source);

  for (const child of paramsNode.namedChildren) {
    // Find the object_pattern inside (may be wrapped in required_parameter / optional_parameter)
    const objectPattern =
      child.type === "object_pattern" ? child
      : child.namedChildren.find((n: SyntaxNode) => n.type === "object_pattern") ?? null;

    if (objectPattern) {
      // Destructured param: expand each field as a separate param.
      // Build per-property type map from the type annotation if it's an inline object type.
      const typeNode = child.descendantsOfType("type_annotation")[0] ?? null;
      const propTypeMap = new Map<string, string>();
      let fallbackType: string | null = fcPropsType;
      if (typeNode) {
        const objectType = typeNode.descendantsOfType("object_type")[0];
        if (objectType) {
          // Inline object type: { root: string; placement?: string }
          for (const sig of objectType.namedChildren) {
            if (sig.type !== "property_signature") continue;
            const propName = sig.namedChildren[0];
            const propType = sig.descendantsOfType("type_annotation")[0];
            if (propName && propType) {
              const t = extractTypeAnnotation(propType, source);
              if (t) propTypeMap.set(getNodeText(propName, source), t);
            }
          }
        } else {
          // Type reference: DemoPopoverProps — use as fallback for all params
          fallbackType = extractTypeAnnotation(typeNode, source);
        }
      }
      for (const member of objectPattern.namedChildren) {
        const name = extractPatternMemberName(member, source);
        if (name) {
          const type = propTypeMap.get(name) ?? fallbackType;
          result.push({ name, type });
        }
      }
    } else {
      // Regular param
      let nameNode: SyntaxNode | null | undefined = null;
      if (child.type === "assignment_pattern") {
        nameNode = child.childForFieldName?.("left");
      }
      if (!nameNode) {
        nameNode =
          child.childForFieldName?.("name") ??
          child.descendantsOfType(["identifier", "property_identifier"])[0] ??
          child.namedChildren[0];
      }
      const nameText = nameNode ? getNodeText(nameNode, source) : getNodeText(child, source);
      const typeNode = child.descendantsOfType("type_annotation")[0] ?? null;
      result.push({ name: nameText, type: extractTypeAnnotation(typeNode, source) });
    }
  }
  return result;
};

export const getReturnType = (node: SyntaxNode, source: string) => {
  const returnNode =
    node.childForFieldName?.("return_type") ??
    node.namedChildren.find((child: SyntaxNode) => child.type === "type_annotation") ??
    null;
  return extractTypeAnnotation(returnNode, source);
};
