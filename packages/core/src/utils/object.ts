/** Type-safe check for plain objects (not arrays, null, or class instances). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively merge `override` into `defaults`.
 * - Only keys present in `defaults` are merged (unknown keys in override are ignored).
 * - Nested plain objects are merged recursively.
 * - null/undefined values in override are ignored (default is preserved).
 * - If default is a plain object but override is not, override is ignored (type mismatch protection).
 */
export function mergeDefaults<T extends Record<string, unknown>>(defaults: T, override: Record<string, unknown>): T {
  const result: Record<string, unknown> = { ...defaults };

  for (const [key, value] of Object.entries(override)) {
    if (!(key in defaults)) continue;

    const defaultValue = defaults[key];
    if (isPlainObject(defaultValue)) {
      // Default is object: only merge if override is also an object, otherwise keep default
      if (isPlainObject(value)) {
        result[key] = mergeDefaults(defaultValue, value);
      }
      // else: type mismatch (e.g. embedding: "foo"), ignore override, keep default
    } else if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }

  return result as T;
}
