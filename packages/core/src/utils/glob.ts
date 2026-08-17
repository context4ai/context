import picomatch from "picomatch";

/** Convert a glob pattern to a RegExp. Supports `*`, `**`, `{a,b}`, `?`, `[abc]`. */
export const globToRegex = (glob: string): RegExp =>
  picomatch.makeRe(glob, { dot: false });

/**
 * Create a path matcher from include/exclude rules.
 * A path matches if it matches ANY include pattern AND does NOT match ANY exclude pattern.
 * If include is empty, nothing matches.
 */
export function createPathMatcher(rules: {
  include: string[];
  exclude: string[];
}): (path: string) => boolean {
  if (rules.include.length === 0) return () => false;

  const isIncluded = picomatch(rules.include, { dot: false });
  const isExcluded =
    rules.exclude.length > 0
      ? picomatch(rules.exclude, { dot: false })
      : () => false;

  return (path: string) => isIncluded(path) && !isExcluded(path);
}

export type PathFilterCategory = "package" | "code" | "doc";

/**
 * Check whether a path matches the given category's rules in the config.
 * - package: only has include rules
 * - code/doc: include + exclude
 */
export function matchesPathFilter(
  path: string,
  category: PathFilterCategory,
  config: { package: { include: string[] }; code: { include: string[]; exclude: string[] }; doc: { include: string[]; exclude: string[] } },
): boolean {
  const section = config[category];
  const include = section.include;
  const exclude = "exclude" in section ? section.exclude : [];
  if (include.length === 0) return false;
  const isIncluded = picomatch.isMatch(path, include, { dot: false });
  if (!isIncluded) return false;
  if (exclude.length > 0 && picomatch.isMatch(path, exclude, { dot: false })) return false;
  return true;
}
