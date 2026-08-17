import { resolve } from "node:path";
import {
  detectGlobalLink,
  detectGlobalNpmBin,
  checkGlobalCommand,
  runCommandLogged,
  type GlobalC4aInfo,
  type GlobalLinkInfo,
} from "./cliUtils.js";

type CommandContext = {
  projectRoot: string;
  info: (msg: string) => void;
  success: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  confirm: (title: string, message: string) => Promise<boolean>;
};

type LinkTarget = {
  pkgName: string;
  filterName: string;
  binName: string;
  distDir: string;
};

type SdkLinkTarget = {
  pkgName: string;
  filterName: string;
  packageDir: string;
};

type LinkDetection = {
  target: LinkTarget;
  state: GlobalLinkInfo;
};

async function confirmGlobalReplacements(
  ctx: CommandContext,
  links: LinkDetection[],
  allLinked: boolean,
): Promise<Map<string, GlobalC4aInfo> | null> {
  const replacements = new Map<string, GlobalC4aInfo>();

  for (const { target, state } of links) {
    if (allLinked) break;
    if (state.linked && state.matches) continue;
    const globalInfo = await checkGlobalCommand(target.binName);
    if (!globalInfo) continue;

    const owner = globalInfo.packageName ? `（${globalInfo.packageName}）` : "";
    const ok = await ctx.confirm(
      `cli:link - 替换全局安装 (${target.binName})`,
      `全局已安装 ${target.binName}@${globalInfo.version}${owner}，link 会将其替换为工作区版本。继续？`,
    );
    if (!ok) {
      ctx.warn(`已取消 ${target.pkgName} 的 link`);
      return null;
    }
    replacements.set(target.pkgName, globalInfo);
  }

  return replacements;
}

async function clearBlockingGlobalBin(
  ctx: CommandContext,
  target: LinkTarget,
  globalInfo: GlobalC4aInfo | undefined,
): Promise<boolean> {
  const binInfo = await detectGlobalNpmBin(target.binName);
  if (!binInfo) return true;

  const replaceablePackages = new Set([
    target.pkgName,
    ...(globalInfo?.packageName ? [globalInfo.packageName] : []),
  ]);
  if (!binInfo.packageName || !replaceablePackages.has(binInfo.packageName)) {
    ctx.error(
      `全局 ${target.binName} 命令被 ${binInfo.packageName ?? binInfo.realPath} 占用，未自动覆盖；请先移除该命令后重试`,
    );
    return false;
  }

  ctx.info(`移除占用全局 ${target.binName} 命令的 ${binInfo.packageName}...`);
  try {
    await runCommandLogged(
      "bunx",
      ["npm", "uninstall", "-g", "--no-audit", "--no-fund", binInfo.packageName],
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.error(`${binInfo.packageName} uninstall 失败: ${msg}`);
    return false;
  }
}

export async function refreshLinkedContextPlugin(
  ctx: Pick<CommandContext, "info" | "success" | "warn">,
  input: { projectRoot: string; cliEntry: string },
  run: typeof runCommandLogged = runCommandLogged,
): Promise<boolean> {
  ctx.info("刷新全局 Context Agent 插件...");
  try {
    await run("bun", [input.cliEntry, "plugin", "install"], { cwd: input.projectRoot });
    ctx.success("全局 Context Agent 插件已刷新");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.warn(`Context Agent 插件刷新失败，不影响 CLI link：${msg}`);
    ctx.warn("可稍后手动运行 context plugin install");
    return false;
  }
}

export async function cmdCliLink(ctx: CommandContext): Promise<void> {
  const targets: LinkTarget[] = [
    {
      pkgName: "@c4a/context-cli",
      filterName: "@c4a/context-cli",
      binName: "context",
      distDir: resolve(ctx.projectRoot, "packages/context-cli/dist"),
    },
  ];
  const sdkTargets: SdkLinkTarget[] = [
    {
      pkgName: "@c4a/context",
      filterName: "@c4a/context",
      packageDir: resolve(ctx.projectRoot, "packages/context"),
    },
  ];

  const links = await Promise.all(
    targets.map(async (t) => ({
      target: t,
      state: await detectGlobalLink(t.pkgName, t.distDir),
    })),
  );

  const allLinked = links.every((l) => l.state.linked && l.state.matches);
  const replacements = await confirmGlobalReplacements(ctx, links, allLinked);
  if (!replacements) return;

  // Track per-target build failures so a stale dist/ from a previous run
  // doesn't silently get re-linked to global PATH. A failed build disqualifies
  // the target from both the `npm link` step and the final success report.
  const failed = new Set<string>();

  for (const { target } of links) {
    ctx.info(`编译 ${target.pkgName}...`);
    try {
      await runCommandLogged("bun", ["run", "--filter", target.filterName, "build"], {
        cwd: ctx.projectRoot,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.error(`${target.pkgName} build 失败: ${msg}`);
      failed.add(target.pkgName);
    }
  }
  for (const target of sdkTargets) {
    ctx.info(`编译 ${target.pkgName}...`);
    try {
      await runCommandLogged("bun", ["run", "--filter", target.filterName, "build"], {
        cwd: ctx.projectRoot,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.error(`${target.pkgName} build 失败: ${msg}`);
      failed.add(target.pkgName);
    }
  }

  for (const { target, state } of links) {
    if (failed.has(target.pkgName)) {
      ctx.warn(`跳过 ${target.pkgName} 的 npm link（build 失败，避免使用陈旧 dist）`);
      continue;
    }
    if (state.linked && state.matches) continue;
    const cleared = await clearBlockingGlobalBin(ctx, target, replacements.get(target.pkgName));
    if (!cleared) {
      failed.add(target.pkgName);
      continue;
    }

    ctx.info(`链接 ${target.pkgName} 到全局...`);
    try {
      // `--no-audit --no-fund --prefer-offline`: none change the semantics
      // of `npm link` (global prefix shim + symlinked package tree), but
      // they skip the registry-audit / fund-info / staleness-probe network
      // calls that are serialised on the global npm cache lock. When other
      // `npm exec` processes hold that lock (MCP servers, npx-launched
      // daemons), plain `npm link` waits 2–3 minutes for a slot; with
      // these flags we bypass the contention and finish in ~400ms. The
      // published-consumer behaviour (`npm install -g @c4a/context-cli`)
      // is unaffected — that code path isn't what link triggers here.
      // `--ignore-scripts` is required because the link target is the raw
      // build directory: release preparation copies the postinstall script
      // into that directory, while an ordinary development build does not.
      // cli:link refreshes the plugin explicitly after linking, so running the
      // package postinstall here would be both redundant and invalid.
      await runCommandLogged(
        "bunx",
        ["npm", "link", "--no-audit", "--no-fund", "--prefer-offline", "--ignore-scripts"],
        { cwd: target.distDir },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.error(`${target.pkgName} npm link 失败: ${msg}`);
      failed.add(target.pkgName);
    }
  }
  for (const target of sdkTargets) {
    if (failed.has(target.pkgName)) {
      ctx.warn(`跳过 ${target.pkgName} 的 bun link（build 失败，避免使用陈旧 SDK）`);
      continue;
    }
    ctx.info(`注册 ${target.pkgName} 到 Bun link...`);
    try {
      await runCommandLogged("bun", ["link"], { cwd: target.packageDir });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.error(`${target.pkgName} bun link 失败: ${msg}`);
      failed.add(target.pkgName);
    }
  }

  for (const { target } of links) {
    if (failed.has(target.pkgName)) {
      ctx.error(`${target.pkgName} 未链接到全局（build 或 link 失败，见上方日志）`);
      continue;
    }
    const info = await checkGlobalCommand(target.binName);
    ctx.success(`全局 ${target.binName} 已链接: ${info?.version ?? "unknown"}`);
  }
  for (const target of sdkTargets) {
    if (failed.has(target.pkgName)) {
      ctx.error(`${target.pkgName} 未注册到 Bun link（build 或 link 失败，见上方日志）`);
      continue;
    }
    ctx.success(`Bun link 已注册 ${target.pkgName}; 本地工作区可使用 context init --dev`);
  }

  const contextCli = targets.find((target) => target.binName === "context");
  if (contextCli !== undefined && !failed.has(contextCli.pkgName)) {
    await refreshLinkedContextPlugin(ctx, {
      projectRoot: ctx.projectRoot,
      cliEntry: resolve(contextCli.distDir, "cli.js"),
    });
  }
}
