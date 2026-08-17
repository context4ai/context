export const DEFAULT_WORKSPACE_NAME = "My Brain";
export const DEFAULT_CLOUD_LIBRARY_NAME = "My Drive";

export const SUPERTEST_EMAIL = "supertest@context4ai.org";
export const SUPERTEST_USER_NAME = "SuperTest";
export const RESERVED_USER_NAMES = ["SuperTest"];
export const DAEMON_HEARTBEAT_INTERVAL = 30_000;
export const DAEMON_OFFLINE_THRESHOLD = 60_000;
export const CLOUD_DAEMON_IDLE_TIMEOUT = 300_000;

/**
 * Directory names to always exclude from import and indexing.
 * Shared between extract (filesystem scanning) and API (remote import / CAS indexing).
 */
export const SCAN_EXCLUDED_DIRS = new Set([
  // VCS / IDE
  ".git", ".svn", ".hg",
  // JS / TS
  "node_modules", "dist", "build", "out", "coverage",
  ".next", ".nuxt", ".turbo", ".cache", ".parcel-cache",
  // Python
  "__pycache__", ".venv", "venv", ".mypy_cache", ".pytest_cache", ".ruff_cache", "site-packages", ".eggs",
  // Go
  "vendor",
  // Rust
  "target",
  // Java / JVM
  ".gradle", ".m2",
  // Test / fixture directories
  "__tests__", "__test__", "__e2e__", "__mocks__", "__fixtures__", "__snapshots__", "fixtures",
  // Misc
  ".tmp",
]);

/** Digest type key for tree-chunked code extraction. */
export const CODE_DIGEST_TYPE = "code_tc_b";

/** Check whether a file path contains any excluded directory segment. */
export const hasExcludedSegment = (filePath: string): boolean => {
  const segments = filePath.split("/");
  // Check all segments except the last (which is the filename)
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (SCAN_EXCLUDED_DIRS.has(seg) || (seg.startsWith(".") && seg !== ".") || seg.endsWith(".egg-info")) {
      return true;
    }
  }
  return false;
};
