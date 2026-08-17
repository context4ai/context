import { readFile } from "node:fs/promises";
import { join } from "node:path";

const TECH_STACK_RULES: { keys: string[]; label: string }[] = [
  { keys: ["react", "react-dom"], label: "react" },
  { keys: ["next"], label: "nextjs" },
  { keys: ["@nestjs/core"], label: "nestjs" },
  { keys: ["typeorm"], label: "typeorm" },
  { keys: ["prisma"], label: "prisma" },
  { keys: ["express"], label: "express" },
  { keys: ["vue"], label: "vue" },
];

const loadDependencies = async (repoPath: string) => {
  try {
    const contents = await readFile(join(repoPath, "package.json"), "utf-8");
    const pkg = JSON.parse(contents) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      dependencies: pkg.dependencies ?? {},
      devDependencies: pkg.devDependencies ?? {},
    };
  } catch {
    return { dependencies: {}, devDependencies: {} };
  }
};

export const detectTechStack = async (repoPath: string): Promise<string[]> => {
  const { dependencies, devDependencies } = await loadDependencies(repoPath);
  const allDeps = new Set<string>([
    ...Object.keys(dependencies),
    ...Object.keys(devDependencies),
  ]);

  const labels: string[] = ["typescript"];
  for (const rule of TECH_STACK_RULES) {
    if (rule.keys.some((key) => allDeps.has(key))) {
      labels.push(rule.label);
    }
  }
  return labels;
};
