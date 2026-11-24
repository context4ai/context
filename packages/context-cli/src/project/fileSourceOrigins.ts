import type { FileSourceOrigin } from "@c4a/context";

/**
 * How one origin kind is installed and linked. Context never runs these commands: the
 * Agent installs the exact version as real files into the registered `local` directory,
 * and Context checks the directory and records file fingerprints in the snapshot.
 */
export interface FileSourceOriginAdapter {
  kind: string;
  /** One line describing what `id` and `version` mean for this kind. */
  identity: string;
  /** A suggested command that installs `origin` as real files into `target`. */
  installCommand?: (origin: FileSourceOrigin, target: string) => string;
  /** A suggested way to list available versions, used for upgrade checks. */
  versionsCommand?: (origin: FileSourceOrigin) => string;
  /** Web page of one file in this version; falls back to `origin.url`. */
  fileUrl?: (origin: FileSourceOrigin, path: string) => string | undefined;
}

function webBase(remote: string): string | undefined {
  const ssh = /^(?:git@|ssh:\/\/git@)([^/:]+)[:/](.+)$/u.exec(remote);
  const candidate = (ssh ? `https://${ssh[1]}/${ssh[2]}` : remote).replace(/\.git\/?$/u, "");
  try {
    const url = new URL(candidate);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href.replace(/\/$/u, "") : undefined;
  } catch {
    return undefined;
  }
}

const quote = (value: string): string => /^[\w@%+=:,./-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;

const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const gitOrigin: FileSourceOriginAdapter = {
  kind: "git",
  identity: "id is the repository remote; version is the full commit",
  installCommand: (origin, target) =>
    `git clone --filter=blob:none --no-checkout -- ${quote(origin.id)} ${quote(target)} && git -C ${quote(target)} checkout --detach ${quote(origin.version)} -- && rm -rf ${quote(`${target}/.git`)}`,
  versionsCommand: (origin) => `git ls-remote -- ${quote(origin.id)} HEAD`,
  fileUrl: (origin, path) => {
    const base = webBase(origin.id);
    return base === undefined ? undefined : `${base}/blob/${encodeURIComponent(origin.version)}/${encodedPath(path)}`;
  },
};

/** Built-in origin kinds. Other kinds are accepted and use the generic guidance. */
export const FILE_SOURCE_ORIGIN_ADAPTERS: readonly FileSourceOriginAdapter[] = [gitOrigin];

export function fileSourceOriginAdapter(kind: string): FileSourceOriginAdapter | undefined {
  return FILE_SOURCE_ORIGIN_ADAPTERS.find((adapter) => adapter.kind === kind);
}

/** Instruction for the Agent to (re)install an origin version into its registered directory. */
export function fileSourceOriginInstallHint(origin: FileSourceOrigin, target: string): string {
  const adapter = fileSourceOriginAdapter(origin.kind);
  const command = adapter?.installCommand?.(origin, target);
  const base = `Install ${origin.kind} ${origin.id} version ${origin.version} as real files (no symlinks) into ${target}`;
  return command === undefined ? `${base}, then rerun capture` : `${base}, for example: ${command}; then rerun capture`;
}

export function fileSourceOriginFileUrl(origin: FileSourceOrigin, path: string): string | undefined {
  return fileSourceOriginAdapter(origin.kind)?.fileUrl?.(origin, path) ?? origin.url;
}

/** Stable revision label stored as the snapshot's source revision. */
export function fileSourceOriginRevision(origin: FileSourceOrigin): string {
  return `${origin.kind}:${origin.id}@${origin.version}`;
}

export function fileSourceOriginView(origin: FileSourceOrigin, target: string): Record<string, unknown> {
  const adapter = fileSourceOriginAdapter(origin.kind);
  const versions = adapter?.versionsCommand?.(origin);
  return {
    ...origin,
    install_hint: fileSourceOriginInstallHint(origin, target),
    ...(versions !== undefined ? { versions_command: versions } : {}),
    ...(adapter !== undefined ? { identity: adapter.identity } : {}),
  };
}
