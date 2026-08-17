import { resolve } from "node:path";
import { detectGlobalLink, detectGlobalNpmBin, runCommandLogged } from "./cliUtils.js";

type CommandContext = {
  projectRoot: string;
  info: (msg: string) => void;
  success: (msg: string) => void;
  warn: (msg: string) => void;
};

type UnlinkTarget = {
  pkgName: string;
  binName: string;
  distDir: string;
};

type SdkUnlinkTarget = {
  pkgName: string;
  packageDir: string;
};

export async function cmdCliUnlink(ctx: CommandContext): Promise<void> {
  const targets: UnlinkTarget[] = [
    {
      pkgName: "@c4a/context-cli",
      binName: "context",
      distDir: resolve(ctx.projectRoot, "packages/context-cli/dist"),
    },
  ];
  const sdkTargets: SdkUnlinkTarget[] = [
    {
      pkgName: "@c4a/context",
      packageDir: resolve(ctx.projectRoot, "packages/context"),
    },
  ];

  const links = await Promise.all(
    targets.map(async (t) => ({
      target: t,
      state: await detectGlobalLink(t.pkgName, t.distDir),
      bin: await detectGlobalNpmBin(t.binName),
    })),
  );

  const anyLinked = links.some((l) => {
    const removablePackages = new Set([l.target.pkgName]);
    return l.state.linked || (l.bin?.packageName ? removablePackages.has(l.bin.packageName) : false);
  });
  if (!anyLinked) {
    ctx.warn(`${targets.map((t) => t.binName).join(" / ")} 均未链接到全局，无需解除`);
  } else {
    for (const { target, state, bin } of links) {
      const removablePackages = new Set([target.pkgName]);
      let packageToRemove: string | null = null;
      if (state.linked) {
        packageToRemove = target.pkgName;
      } else if (bin?.packageName && removablePackages.has(bin.packageName)) {
        packageToRemove = bin.packageName;
      }
      if (!packageToRemove) continue;
      ctx.info(`解除 ${packageToRemove} 全局链接...`);
      try {
        // npm uninstall removes both globally installed packages and npm-link
        // symlinks, and always clears the bin shim that blocks the next link.
        await runCommandLogged(
          "bunx",
          ["npm", "uninstall", "-g", "--no-audit", "--no-fund", "--prefer-offline", packageToRemove],
        );
        ctx.success(`全局 ${target.binName} 命令已移除`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.warn(`${packageToRemove} unlink 失败: ${msg}`);
      }
    }
  }
  for (const target of sdkTargets) {
    ctx.info(`解除 ${target.pkgName} Bun link 注册...`);
    try {
      await runCommandLogged("bun", ["unlink"], { cwd: target.packageDir });
      ctx.success(`${target.pkgName} Bun link 注册已移除`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.warn(`${target.pkgName} bun unlink 失败: ${msg}`);
    }
  }

  ctx.info("全局 CLI 命令已移除；unlink 不会恢复安装发布版本或社区版本。");
}
