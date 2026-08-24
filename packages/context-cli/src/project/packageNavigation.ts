import {
  DEFAULT_PACKAGE_NAVIGATION,
  type PackageDefinition,
  type PackageNavigationDefinition,
} from "@c4a/context";

export interface NavigationKnowledgeItem {
  path: string;
  okf_root: string;
  okf_root_path?: string;
  parentPath: string;
  segments: string[];
}

export interface PlannedKnowledgePageGroup<TItem extends NavigationKnowledgeItem> {
  path: string;
  items: TItem[];
}

export interface PlannedKnowledgeDirectoryIndex<TItem extends NavigationKnowledgeItem> {
  okfRoot: string;
  okfRootPath: string;
  pathWithinOkfRoot: string;
  relPath: string;
  items: TItem[];
  childDirectoryPaths: string[];
  pageGroups: PlannedKnowledgePageGroup<TItem>[];
}

export function packageNavigation(pkg: PackageDefinition): PackageNavigationDefinition {
  if (pkg.kind !== "package.kb") return DEFAULT_PACKAGE_NAVIGATION;
  return pkg.navigation ?? DEFAULT_PACKAGE_NAVIGATION;
}

function directoryRelPath(okfRootPath: string, pathWithinOkfRoot: string): string {
  return pathWithinOkfRoot.length === 0
    ? `${okfRootPath}/index.md`
    : `${okfRootPath}/${pathWithinOkfRoot}/index.md`;
}

function directoryPrefixes(item: NavigationKnowledgeItem): string[] {
  const parentSegments = item.segments.slice(0, -1);
  return Array.from({ length: parentSegments.length }, (_, index) =>
    parentSegments.slice(0, index + 1).join("/")
  );
}

function directoryDepth(pathWithinOkfRoot: string): number {
  return pathWithinOkfRoot.split("/").filter(Boolean).length;
}

function generatedChildPath<TItem extends NavigationKnowledgeItem>(
  directory: { okfRootPath: string; pathWithinOkfRoot: string },
  item: TItem,
  generatedPaths: ReadonlySet<string>,
): string | undefined {
  const directorySegments = directory.pathWithinOkfRoot.split("/").filter(Boolean);
  const parentSegments = item.segments.slice(0, -1);
  for (let depth = directorySegments.length + 1; depth <= parentSegments.length; depth++) {
    const candidatePath = parentSegments.slice(0, depth).join("/");
    if (generatedPaths.has(`${directory.okfRootPath}\u0000${candidatePath}`)) {
      return candidatePath;
    }
  }
  return undefined;
}

function exposedNavigationEntryCount<TItem extends NavigationKnowledgeItem>(
  directory: { okfRootPath: string; pathWithinOkfRoot: string; items: TItem[] },
  generatedPaths: ReadonlySet<string>,
): number {
  const childDirectories = new Set<string>();
  let pageCount = 0;
  for (const item of directory.items) {
    const childPath = generatedChildPath(directory, item, generatedPaths);
    if (childPath === undefined) pageCount++;
    else childDirectories.add(childPath);
  }
  return childDirectories.size + pageCount;
}

export function planKnowledgeDirectoryIndexes<TItem extends NavigationKnowledgeItem>(
  items: readonly TItem[],
  navigation: PackageNavigationDefinition,
): PlannedKnowledgeDirectoryIndex<TItem>[] {
  const directories = new Map<string, {
    okfRoot: string;
    okfRootPath: string;
    pathWithinOkfRoot: string;
    items: TItem[];
  }>();

  for (const item of items) {
    const okfRootPath = item.okf_root_path ?? item.okf_root;
    const paths = ["", ...directoryPrefixes(item)];
    for (const pathWithinOkfRoot of paths) {
      const key = `${okfRootPath}\u0000${pathWithinOkfRoot}`;
      const directory = directories.get(key);
      if (directory === undefined) {
        directories.set(key, {
          okfRoot: item.okf_root,
          okfRootPath,
          pathWithinOkfRoot,
          items: [item],
        });
      } else {
        directory.items.push(item);
      }
    }
  }

  const generatedPaths = new Set<string>();
  const plannedDirectories = [...directories.values()];
  if (!navigation.foldDirectoryIndexes) {
    for (const directory of plannedDirectories) {
      generatedPaths.add(`${directory.okfRootPath}\u0000${directory.pathWithinOkfRoot}`);
    }
  } else {
    for (const directory of [...plannedDirectories].sort((left, right) =>
      directoryDepth(right.pathWithinOkfRoot) - directoryDepth(left.pathWithinOkfRoot) ||
      left.pathWithinOkfRoot.localeCompare(right.pathWithinOkfRoot)
    )) {
      if (directory.pathWithinOkfRoot.length === 0) continue;
      if (exposedNavigationEntryCount(directory, generatedPaths) > navigation.maxInlineEntries) {
        generatedPaths.add(`${directory.okfRootPath}\u0000${directory.pathWithinOkfRoot}`);
      }
    }
    for (const directory of plannedDirectories) {
      if (directory.pathWithinOkfRoot.length === 0) {
        generatedPaths.add(`${directory.okfRootPath}\u0000${directory.pathWithinOkfRoot}`);
      }
    }
  }

  return plannedDirectories
    .filter((directory) =>
      generatedPaths.has(`${directory.okfRootPath}\u0000${directory.pathWithinOkfRoot}`)
    )
    .map((directory) => {
      const directorySegments = directory.pathWithinOkfRoot.split("/").filter(Boolean);
      const childDirectoryPaths = new Set<string>();
      const pageGroups = new Map<string, TItem[]>();

      for (const item of directory.items) {
        const parentSegments = item.segments.slice(0, -1);
        const childPath = generatedChildPath(directory, item, generatedPaths);
        if (childPath !== undefined) {
          childDirectoryPaths.add(childPath);
          continue;
        }

        const foldedPath = parentSegments.slice(directorySegments.length).join("/");
        const groupItems = pageGroups.get(foldedPath);
        if (groupItems === undefined) {
          pageGroups.set(foldedPath, [item]);
        } else {
          groupItems.push(item);
        }
      }

      return {
        okfRoot: directory.okfRoot,
        okfRootPath: directory.okfRootPath,
        pathWithinOkfRoot: directory.pathWithinOkfRoot,
        relPath: directoryRelPath(directory.okfRootPath, directory.pathWithinOkfRoot),
        items: [...directory.items].sort((left, right) => left.path.localeCompare(right.path)),
        childDirectoryPaths: [...childDirectoryPaths].sort((left, right) => left.localeCompare(right)),
        pageGroups: [...pageGroups]
          .map(([path, groupItems]) => ({
            path,
            items: groupItems.sort((left, right) => left.path.localeCompare(right.path)),
          }))
          .sort((left, right) => left.path.localeCompare(right.path)),
      };
    })
    .sort((left, right) => left.relPath.localeCompare(right.relPath));
}
