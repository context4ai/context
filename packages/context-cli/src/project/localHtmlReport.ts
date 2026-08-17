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
