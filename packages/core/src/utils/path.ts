import path from "node:path";

export function isPathSafe(inputPath: string): boolean {
  if (inputPath.length === 0) {
    return false;
  }

  if (inputPath.includes("\0")) {
    return false;
  }

  if (path.isAbsolute(inputPath)) {
    return false;
  }

  if (/^[a-zA-Z]:/.test(inputPath)) {
    return false;
  }

  if (inputPath.startsWith("~")) {
    return false;
  }

  const normalized = path.posix.normalize(inputPath.replaceAll("\\", "/"));
  const parts = normalized.split("/");

  return !parts.some((part) => part === ".." || part === "");
}
