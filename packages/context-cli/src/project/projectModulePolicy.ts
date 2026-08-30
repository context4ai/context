import type { ContextProjectModule } from "@c4a/context";

const PROJECT_CONFIG_KEYS = new Set(["sources", "phases", "packages"]);

export function assertTrustedContextProjectConfigBoundary(
  module: ContextProjectModule,
): void {
  const project = module.project as unknown;
  if (project === null || typeof project !== "object" || Array.isArray(project)) {
    throw new TypeError("Context ProjectConfig must be an object");
  }
  const record = project as Record<string, unknown>;
  const unexpected = Object.keys(record).filter((key) => !PROJECT_CONFIG_KEYS.has(key));
  if (unexpected.length > 0) {
    throw new TypeError(
      `src/index.ts ProjectConfig only declares sources, phases, and packages; move ${unexpected.join(", ")} to its static authority`,
    );
  }
  for (const key of PROJECT_CONFIG_KEYS) {
    if (!Array.isArray(record[key])) {
      throw new TypeError(`src/index.ts ProjectConfig ${key} must be an array`);
    }
  }
}
