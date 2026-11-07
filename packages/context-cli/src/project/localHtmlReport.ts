import { execFile } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LocalHtmlReportReference {
  format: "html";
  path: string;
  absolute_path: string;
  file_url: string;
  title: string;
}

export function htmlReportReference(input: {
  projectRoot: string;
  path: string;
  title: string;
}): LocalHtmlReportReference {
  const absolutePath = isAbsolute(input.path) ? input.path : join(input.projectRoot, input.path);
  return {
    format: "html",
    path: input.path,
    absolute_path: absolutePath,
    file_url: pathToFileURL(absolutePath).href,
    title: input.title,
  };
}

function shouldSkipAutoOpen(): boolean {
  return process.env.NODE_ENV === "test" ||
    process.env.BUN_TEST === "1" ||
    process.env.CONTEXT_DISABLE_AUTO_OPEN === "1";
}

export async function openLocalFile(path: string): Promise<{ opened: boolean; error?: string }> {
  if (shouldSkipAutoOpen()) return { opened: false, error: "auto-open-disabled" };
  // Without a graphical session xdg-open cannot show anything; the caller
  // hands the stable path to a host-provided opener instead.
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return { opened: false, error: "no-graphical-session" };
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32"
    ? ["/c", "start", "", path]
    : [path];
  try {
    await execFileAsync(command, args, { timeout: 10_000 });
    return { opened: true };
  } catch (error) {
    return { opened: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Reading marks live in browser storage per origin, so every round must open
 * the same file the same way; a server on a fresh port starts unread. */
export const REPORT_OPEN_FALLBACK = "Open absolute_path (or file_url) with the host's browser-open capability. Reopen this same path the same way after each regeneration so READ marks carry over; do not serve it from a temporary HTTP server on a new port.";
