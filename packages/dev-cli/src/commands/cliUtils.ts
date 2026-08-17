import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

type ExecOptions = {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
};

export type GlobalLinkInfo = {
  linked: boolean;
  path?: string;
  matches?: boolean;
};

export type GlobalC4aInfo = {
  version: string;
  path?: string;
  realPath?: string;
  packageName?: string;
};

export type GlobalNpmBinInfo = {
  path: string;
  realPath: string;
  packageName?: string;
};

export function execCommand(command: string, args: string[], options?: ExecOptions): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options?.timeout) {
      timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, options.timeout);
    }

    proc.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    proc.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Command timed out: ${command} ${args.join(" ")}`));
      } else if (code === 0) {
        resolvePromise(stdout.trim());
      } else {
        const err = new Error(stderr.trim() || `Command failed: ${command} ${args.join(" ")}`);
        reject(err);
      }
    });
  });
}

export async function detectGlobalLink(packageName: string, distDir: string): Promise<GlobalLinkInfo> {
  try {
    const raw = await execCommand("bunx", ["npm", "ls", "-g", packageName, "--json"]);
    const info = JSON.parse(raw) as {
      dependencies?: Record<string, { resolved?: string }>;
    };
    const dep = info.dependencies?.[packageName];
    if (!dep?.resolved?.startsWith("file:")) {
      return { linked: false };
    }
    // npm link creates a symlink in global node_modules — resolve it via realpath
    const npmRoot = await resolveGlobalNpmRoot();
    if (!npmRoot) return { linked: true, matches: false };
    const symlinkPath = join(npmRoot, ...packageName.split("/"));
    try {
      const realPath = realpathSync(symlinkPath);
      const normalizedDist = resolve(distDir);
      const matches = realPath === normalizedDist || realPath.startsWith(`${normalizedDist}/`);
      return { linked: true, path: realPath, matches };
    } catch {
      return { linked: true, matches: false };
    }
  } catch {
    return { linked: false };
  }
}

export async function checkGlobalCommand(command: string): Promise<GlobalC4aInfo | null> {
  const binInfo = await detectGlobalNpmBin(command);
  try {
    const version = await execCommand(command, ["--version"], { timeout: 5000 });
    return { version, ...(binInfo ?? {}) };
  } catch {
    try {
      const version = await execCommand(command, ["version"], { timeout: 5000 });
      return { version, ...(binInfo ?? {}) };
    } catch {
      return null;
    }
  }
}

async function resolveGlobalNpmRoot(): Promise<string | null> {
  try {
    return await execCommand("bunx", ["npm", "root", "-g"]);
  } catch {
    return null;
  }
}

async function resolveGlobalNpmPrefix(): Promise<string | null> {
  try {
    return await execCommand("bunx", ["npm", "prefix", "-g"]);
  } catch {
    return null;
  }
}

function globalNpmBinCandidates(prefix: string, command: string): string[] {
  if (process.platform === "win32") {
    return [join(prefix, `${command}.cmd`), join(prefix, `${command}.ps1`), join(prefix, command)];
  }
  return [join(prefix, "bin", command)];
}

export function inferPackageNameFromGlobalNpmPath(npmRoot: string, filePath: string): string | undefined {
  const rel = relative(resolve(npmRoot), resolve(filePath));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  const parts = rel.split(sep);
  const first = parts[0];
  if (!first) return undefined;
  if (first.startsWith("@")) {
    const second = parts[1];
    return second ? `${first}/${second}` : undefined;
  }
  return first;
}

export async function detectGlobalNpmBin(command: string): Promise<GlobalNpmBinInfo | null> {
  const [prefix, npmRoot] = await Promise.all([resolveGlobalNpmPrefix(), resolveGlobalNpmRoot()]);
  if (!prefix) return null;

  for (const path of globalNpmBinCandidates(prefix, command)) {
    if (!existsSync(path)) continue;
    const realPath = realpathSync(path);
    const packageName = npmRoot ? inferPackageNameFromGlobalNpmPath(npmRoot, realPath) : undefined;
    const info: GlobalNpmBinInfo = { path, realPath };
    if (packageName) info.packageName = packageName;
    return info;
  }

  return null;
}

export async function runCommandLogged(
  command: string,
  args: string[],
  options?: ExecOptions,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      stdio: "inherit",
    });
    proc.on("error", (error) => reject(error));
    proc.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`Command failed: ${command} ${args.join(" ")}`));
      }
    });
  });
}

export function runWithStatus(
  command: string,
  args: string[],
  options?: { cwd?: string },
): Promise<number> {
  return new Promise((resolvePromise) => {
    const proc = spawn(command, args, {
      stdio: "inherit",
      cwd: options?.cwd,
      env: process.env,
    });
    proc.on("close", (code) => resolvePromise(code ?? 1));
  });
}
