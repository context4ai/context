import {
  loadIndexerRegistry,
  type LoadedIndexerRegistry,
} from "@c4a/context";
import { loadContextProjectModule } from "./workspace.js";

export interface LoadedIndexerWorkspaceConfiguration {
  registry: LoadedIndexerRegistry;
  project: Awaited<ReturnType<typeof loadContextProjectModule>>;
}

export async function loadIndexerWorkspaceConfiguration(
  projectRoot: string,
): Promise<LoadedIndexerWorkspaceConfiguration> {
  const registry = await loadIndexerRegistry(projectRoot);
  const project = await loadContextProjectModule(projectRoot);
  return { registry, project };
}
