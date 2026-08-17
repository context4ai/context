import { useEffect, useState } from "react";
import { Box, Text, render as inkRender, useApp, useInput } from "ink";
import type { Key } from "ink";
import { readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { existsSync, statSync } from "node:fs";
import { DirectoryGrid, gridNavigate } from "./DirectoryGrid.js";
import { PathEditor } from "./PathEditor.js";

export interface DirectoryPickerOptions {
  initialPath?: string;
  title?: string;
  columns?: number;
  showHidden?: boolean;
}

type FocusArea = "grid" | "path";
type PickerMode = "browse" | "edit" | "confirm";
type ConfirmChoice = "confirm" | "back" | "cancel";

type DirData = {
  entries: string[];
  fileCount: number;
  sampleFiles: string[];
};

function useDirectoryData(currentPath: string, showHidden: boolean) {
  const [data, setData] = useState<DirData>({ entries: [], fileCount: 0, sampleFiles: [] });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const dirents = await readdir(currentPath, { withFileTypes: true });
        if (cancelled) return;
        const dirs = dirents
          .filter((d) => d.isDirectory() && (showHidden || !d.name.startsWith(".")))
          .map((d) => d.name)
          .sort((a, b) => a.localeCompare(b));
        const files = dirents
          .filter((d) => d.isFile())
          .map((d) => d.name)
          .sort((a, b) => a.localeCompare(b));
        setData({
          entries: [".."].concat(dirs),
          fileCount: files.length,
          sampleFiles: files.slice(0, 2),
        });
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setData({ entries: [], fileCount: 0, sampleFiles: [] });
          setError(`无法读取目录: ${(err as Error).message}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentPath, showHidden]);

  return { ...data, error, loading };
}

interface PickerProps {
  onSelect: (path: string | null) => void;
  initialPath: string;
  title: string;
  columns: number;
  showHidden: boolean;
}

const CONFIRM_CHOICES: { key: ConfirmChoice; label: string }[] = [
  { key: "confirm", label: "确认" },
  { key: "back", label: "返回（重新选择）" },
  { key: "cancel", label: "取消（回到主菜单）" },
];

function DirectoryPickerComponent({ onSelect, initialPath, title, columns, showHidden }: PickerProps) {
  const { exit } = useApp();
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focusArea, setFocusArea] = useState<FocusArea>("path");
  const [mode, setMode] = useState<PickerMode>("browse");
  const [editBuffer, setEditBuffer] = useState("");
  const [editCursor, setEditCursor] = useState(0);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmIndex, setConfirmIndex] = useState(0);

  const { entries, fileCount, sampleFiles, error } = useDirectoryData(currentPath, showHidden);

  useEffect(() => {
    setSelectedIndex(0);
    setFocusArea("path");
  }, [currentPath]);

  const finish = (result: string | null) => {
    exit();
    onSelect(result);
  };

  const navigateToDir = (dirName: string) => {
    if (dirName === "..") {
      const parent = dirname(currentPath);
      if (parent !== currentPath) {
        setCurrentPath(parent);
      }
    } else {
      setCurrentPath(resolve(currentPath, dirName));
    }
  };

  const enterEditMode = () => {
    setMode("edit");
    setEditBuffer(currentPath);
    setEditCursor(currentPath.length);
    setEditError(null);
  };

  const enterConfirmMode = () => {
    setMode("confirm");
    setConfirmIndex(0);
  };

  const submitEdit = () => {
    const target = editBuffer.trim();
    if (!target) {
      setEditError("路径不能为空");
      return;
    }
    const resolved = resolve(target);
    if (!existsSync(resolved)) {
      setEditError("路径不存在");
      return;
    }
    try {
      const stat = statSync(resolved);
      if (!stat.isDirectory()) {
        setEditError("路径不是目录");
        return;
      }
    } catch {
      setEditError("无法访问路径");
      return;
    }
    setMode("browse");
    setCurrentPath(resolved);
  };

  useInput((input: string, key: Key) => {
    if (mode === "edit") {
      handleEditInput(input, key);
    } else if (mode === "confirm") {
      handleConfirmInput(input, key);
    } else {
      handleBrowseInput(input, key);
    }
  });

  const handleBrowseInput = (input: string, key: Key) => {
    if (key.escape || input === "q") {
      finish(null);
      return;
    }

    if (focusArea === "grid") {
      if (key.upArrow) {
        const row = Math.floor(selectedIndex / columns);
        if (row === 0) {
          setFocusArea("path");
          return;
        }
        setSelectedIndex(gridNavigate(selectedIndex, "up", entries.length, columns));
      } else if (key.downArrow) {
        const target = selectedIndex + columns;
        if (target >= entries.length) {
          setFocusArea("path");
          return;
        }
        setSelectedIndex(gridNavigate(selectedIndex, "down", entries.length, columns));
      } else if (key.leftArrow) {
        setSelectedIndex(gridNavigate(selectedIndex, "left", entries.length, columns));
      } else if (key.rightArrow) {
        setSelectedIndex(gridNavigate(selectedIndex, "right", entries.length, columns));
      } else if (key.return) {
        const entry = entries[selectedIndex];
        if (entry) {
          navigateToDir(entry);
        }
      }
    } else {
      // focusArea === "path"
      if (key.upArrow) {
        setFocusArea("grid");
        const totalRows = Math.ceil(entries.length / columns);
        const lastRowStart = Math.max(0, (totalRows - 1) * columns);
        setSelectedIndex(Math.min(lastRowStart, entries.length - 1));
      } else if (key.downArrow) {
        setFocusArea("grid");
        setSelectedIndex(0);
      } else if (key.return) {
        enterConfirmMode();
      } else if (input === "e" || input === "E") {
        enterEditMode();
      }
    }
  };

  const handleEditInput = (_input: string, key: Key) => {
    if (key.escape) {
      setMode("browse");
      setEditError(null);
      return;
    }

    if (key.return) {
      submitEdit();
      return;
    }

    if (key.leftArrow) {
      setEditCursor((c) => Math.max(0, c - 1));
      return;
    }

    if (key.rightArrow) {
      setEditCursor((c) => Math.min(editBuffer.length, c + 1));
      return;
    }

    if (key.backspace || key.delete) {
      if (editCursor > 0) {
        setEditBuffer((buf) => buf.slice(0, editCursor - 1) + buf.slice(editCursor));
        setEditCursor((c) => c - 1);
      }
      return;
    }

    const ch = _input;
    if (ch && ch.length > 0 && ch.charCodeAt(0) >= 32) {
      setEditBuffer((buf) => buf.slice(0, editCursor) + ch + buf.slice(editCursor));
      setEditCursor((c) => c + ch.length);
      setEditError(null);
    }
  };

  const handleConfirmInput = (_input: string, key: Key) => {
    if (key.escape) {
      setMode("browse");
      return;
    }

    if (key.upArrow) {
      setConfirmIndex((i) => (i > 0 ? i - 1 : CONFIRM_CHOICES.length - 1));
    } else if (key.downArrow) {
      setConfirmIndex((i) => (i < CONFIRM_CHOICES.length - 1 ? i + 1 : 0));
    } else if (key.return || _input === " ") {
      const choice = CONFIRM_CHOICES[confirmIndex]?.key;
      if (choice === "confirm") {
        finish(currentPath);
      } else if (choice === "back") {
        setMode("browse");
      } else if (choice === "cancel") {
        finish(null);
      }
    }
  };

  const fileInfo =
    fileCount > 0
      ? sampleFiles.length > 0
        ? `文件 ${fileCount} 个，包括 ${sampleFiles.join("、")}${fileCount > sampleFiles.length ? " 等" : ""}`
        : `文件 ${fileCount} 个`
      : null;

  const isPathFocused = focusArea === "path" && mode === "browse";

  if (mode === "confirm") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color="cyan">
          {title}
        </Text>

        <Box marginTop={1}>
          <Text>已选择路径: </Text>
          <Text bold color="green">{currentPath}</Text>
        </Box>

        <Box marginTop={1} flexDirection="column">
          {CONFIRM_CHOICES.map((choice, index) => {
            const isSelected = index === confirmIndex;
            return (
              <Box key={choice.key}>
                <Text
                  bold={isSelected}
                  {...(isSelected ? { color: "cyan" as const } : {})}
                >
                  {isSelected ? "▶ " : "  "}
                  {choice.label}
                </Text>
              </Box>
            );
          })}
        </Box>

        <Box marginTop={1}>
          <Text dimColor>↑↓ 选择  ↵/␣ 确认</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        {title}
      </Text>

      <Box marginTop={1}>
        {mode === "edit" ? (
          <PathEditor value={editBuffer} cursor={editCursor} error={editError} />
        ) : (
          <Box>
            <Box width={3}>
              <Text
                bold={isPathFocused}
                {...(isPathFocused ? { color: "cyan" as const } : {})}
              >
                {isPathFocused ? "▶" : " "}
              </Text>
            </Box>
            <Text
              bold={isPathFocused}
              {...(isPathFocused ? { color: "cyan" as const } : {})}
            >
              {currentPath}
            </Text>
          </Box>
        )}
      </Box>

      {error ? (
        <Box marginTop={1}>
          <Text color="red">{error}</Text>
        </Box>
      ) : (
        <Box marginTop={1}>
          <DirectoryGrid
            entries={entries}
            selectedIndex={focusArea === "grid" ? selectedIndex : -1}
            columns={columns}
          />
        </Box>
      )}

      {fileInfo ? (
        <Box marginTop={1}>
          <Text dimColor>{fileInfo}</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        {mode === "edit" ? (
          <Text dimColor>输入路径  ↵ 确认  Esc 取消</Text>
        ) : focusArea === "path" ? (
          <Text>
            <Text dimColor>←→↑↓ 移动  E 编辑路径  </Text>
            <Text color="red" bold>↵ 确认选择</Text>
            <Text dimColor>  Esc/q 取消</Text>
          </Text>
        ) : (
          <Text dimColor>←→↑↓ 移动  ↵ 进入目录  Esc/q 取消</Text>
        )}
      </Box>
    </Box>
  );
}

export function pickDirectory(options?: DirectoryPickerOptions): Promise<string | null> {
  const initialPath = resolve(options?.initialPath ?? process.cwd());
  const title = options?.title ?? "选择目录";
  const columns = options?.columns ?? 4;
  const showHidden = options?.showHidden ?? false;

  return new Promise((resolvePromise) => {
    let result: string | null = null;
    const instance = inkRender(
      <DirectoryPickerComponent
        onSelect={(selected) => {
          result = selected;
        }}
        initialPath={initialPath}
        title={title}
        columns={columns}
        showHidden={showHidden}
      />,
    );
    instance.waitUntilExit().then(() => {
      resolvePromise(result);
    });
  });
}
