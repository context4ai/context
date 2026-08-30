const LANGUAGE_BY_EXTENSION = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
} as const;

export type EcmaScriptLanguage = typeof LANGUAGE_BY_EXTENSION[keyof typeof LANGUAGE_BY_EXTENSION];

export const EXTRACT_TS_CAPABILITIES = [
  "commonjs-module",
  "esm-module",
  "javascript-ast",
  "jsx-ast",
  "parser.javascript",
  "parser.typescript",
  "static-call-relations",
  "tsx-ast",
  "typescript-ast",
];

export const EXTRACT_TS_COVERAGE_TIER = "ast-catalog" as const;

export const ecmaScriptLanguage = (filePath: string): EcmaScriptLanguage => {
  const lower = filePath.toLowerCase();
  const extension = Object.keys(LANGUAGE_BY_EXTENSION)
    .find((candidate) => lower.endsWith(candidate)) as keyof typeof LANGUAGE_BY_EXTENSION | undefined;
  return extension ? LANGUAGE_BY_EXTENSION[extension] : "typescript";
};

export const isJsxLikePath = (filePath: string): boolean => {
  const language = ecmaScriptLanguage(filePath);
  return language === "tsx" || language === "jsx";
};

export const isJavaScriptPath = (filePath: string): boolean => {
  const language = ecmaScriptLanguage(filePath);
  return language === "javascript" || language === "jsx";
};

export const packageLanguage = (filePaths: readonly string[]): "typescript" | "javascript" | "ecmascript" => {
  const hasJavaScript = filePaths.some(isJavaScriptPath);
  const hasTypeScript = filePaths.some((filePath) => !isJavaScriptPath(filePath));
  if (hasJavaScript && hasTypeScript) return "ecmascript";
  return hasJavaScript ? "javascript" : "typescript";
};
