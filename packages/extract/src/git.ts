import { execSync } from "node:child_process";

export const getGitCommitHash = (repoPath: string): string | null => {
  try {
    const output = execSync("git rev-parse HEAD", {
      cwd: repoPath,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const hash = output.toString("utf-8").trim();
    return hash || null;
  } catch {
    return null;
  }
};
