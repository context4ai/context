import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { closeSync, openSync, readSync } from "node:fs";
import { useState } from "react";
import { render as inkRender, Box, Text, useApp, useInput } from "ink";
import { Header, CascadeMenu, HelpPanel, confirm } from "@c4a/tui";
import { menuTree, helpDescriptions } from "./menuData.js";
import { cmdCliLink } from "./commands/cliLink.js";
import { cmdCliUnlink } from "./commands/cliUnlink.js";
import { cmdBumpVersion } from "./commands/bumpVersion.js";
import { cmdPublish } from "./commands/publish.js";
import { runCommandLogged } from "./commands/cliUtils.js";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function createCommandContext() {
  const assumeYes =
    process.env.C4A_ASSUME_YES === "1" || process.env.C4A_ASSUME_YES === "true";
  return {
    projectRoot: ROOT_DIR,
    info: (msg: string) => console.log(`  ${msg}`),
    success: (msg: string) => console.log(`  [ok] ${msg}`),
    warn: (msg: string) => console.log(`  [warn] ${msg}`),
    error: (msg: string) => console.error(`  [error] ${msg}`),
    confirm: (title: string, message: string): Promise<boolean> => {
      if (assumeYes || !process.stdin.isTTY) {
        return Promise.resolve(true);
      }
      return confirm(title, message);
    },
    waitForInput: (prompt: string, defaultValue?: string): Promise<string> => {
      return new Promise((resolve) => {
        const { stdin } = process;
        if (stdin.isPaused()) stdin.resume();
        const rl = createInterface({ input: stdin, output: process.stdout });
        rl.question(prompt, (answer) => {
          rl.close();
          // Clean up stdin state so subsequent readline (waitForEnter) works
          stdin.removeAllListeners("data");
          stdin.removeAllListeners("keypress");
          if (!stdin.isPaused()) stdin.pause();
          resolve(answer.trim() || defaultValue || "");
        });
        if (defaultValue) {
          rl.write(defaultValue);
        }
      });
    },
  };
}

async function executeCommand(commandId: string): Promise<void> {
  const ctx = createCommandContext();

  switch (commandId) {
    case "build":
      await runCommandLogged("bun", ["run", "build"], { cwd: ROOT_DIR });
      break;
    case "verify:fast":
      await runCommandLogged("bun", ["run", "verify:fast"], { cwd: ROOT_DIR });
      break;
    case "verify":
      await runCommandLogged("bun", ["run", "verify"], { cwd: ROOT_DIR });
      break;
    case "verify:full":
      await runCommandLogged("bun", ["run", "verify:full"], { cwd: ROOT_DIR });
      break;
    case "cli:link":
      await cmdCliLink(ctx);
      break;
    case "cli:unlink":
      await cmdCliUnlink(ctx);
      break;
    case "bump-version":
      await cmdBumpVersion([], ctx);
      break;
    case "publish":
      await cmdPublish([], ctx);
      break;
    default:
      console.log(`Unknown command: ${commandId}`);
  }
}

type MenuSelection = {
  commandId: string;
  mainIndex: number;
  subIndex: number;
  focus: "main" | "sub";
};

type AppProps = {
  onSelect: (selection: MenuSelection) => void;
  initialMainIndex?: number | undefined;
  initialSubIndex?: number | undefined;
  initialFocus?: "main" | "sub" | undefined;
};

function App({ onSelect, initialMainIndex = 0, initialSubIndex = 0, initialFocus = "main" }: AppProps) {
  const { exit } = useApp();
  const [selectedIndex, setSelectedIndex] = useState(initialMainIndex);
  const [subSelectedIndex, setSubSelectedIndex] = useState(initialSubIndex);
  const [focusLevel, setFocusLevel] = useState<"main" | "sub">(initialFocus);

  const currentItem = menuTree[selectedIndex];

  const expandedId = currentItem?.children ? currentItem.id : null;

  const currentSubItem =
    expandedId && currentItem?.children ? currentItem.children[subSelectedIndex] : null;

  const hoveredId =
    focusLevel === "sub" && currentSubItem ? currentSubItem.id : currentItem?.id || "";

  const doSelect = (commandId: string) => {
    exit();
    onSelect({ commandId, mainIndex: selectedIndex, subIndex: subSelectedIndex, focus: focusLevel });
  };

  useInput((input, key) => {
    if (input === "q") {
      exit();
      onSelect({ commandId: "__quit__", mainIndex: selectedIndex, subIndex: subSelectedIndex, focus: focusLevel });
      return;
    }

    if (focusLevel === "main") {
      if (key.upArrow) {
        setSelectedIndex((i) => (i > 0 ? i - 1 : menuTree.length - 1));
        setSubSelectedIndex(0);
      } else if (key.downArrow) {
        setSelectedIndex((i) => (i < menuTree.length - 1 ? i + 1 : 0));
        setSubSelectedIndex(0);
      } else if (key.rightArrow && currentItem?.children) {
        setFocusLevel("sub");
      } else if (key.return || input === " ") {
        if (currentItem && !currentItem.children) {
          doSelect(currentItem.id);
        } else if (currentItem?.children) {
          setFocusLevel("sub");
        }
      }
    } else {
      const children = currentItem?.children || [];
      if (key.upArrow) {
        setSubSelectedIndex((i) => (i > 0 ? i - 1 : children.length - 1));
      } else if (key.downArrow) {
        setSubSelectedIndex((i) => (i < children.length - 1 ? i + 1 : 0));
      } else if (key.leftArrow) {
        setFocusLevel("main");
      } else if (key.return || input === " ") {
        if (currentSubItem) {
          doSelect(currentSubItem.id);
        }
      }
    }
  });

  const maxSubMenuHeight = Math.max(
    ...menuTree.map((item) => (item.children?.length || 0) + 2),
  );
  const menuHeight = Math.max(menuTree.length, menuTree.length + maxSubMenuHeight - 3);

  return (
    <Box flexDirection="column" padding={1}>
      <Header title="C4A - Developer CLI" />

      <Box marginY={1} height={menuHeight}>
        <CascadeMenu
          items={menuTree}
          selectedIndex={selectedIndex}
          expandedId={expandedId}
          subSelectedIndex={subSelectedIndex}
          focusLevel={focusLevel}
        />
      </Box>

      <HelpPanel command={hoveredId} descriptions={helpDescriptions} />

      <Box marginTop={1}>
        <Text dimColor>↑↓ 选择  →← 展开/收起  ␣/↵ 确认  q 退出</Text>
      </Box>
    </Box>
  );
}

/**
 * Thoroughly clean up stdin after Ink unmounts.
 *
 * Ink leaves stdin in raw mode with various listeners attached. We must:
 * 1. Exit raw mode
 * 2. Remove ALL event listeners Ink left behind (data, readable, keypress, etc.)
 * 3. **Pause** stdin so the parent's event loop stops reading from fd 0
 *
 * The pause is critical: with `stdio: "inherit"` child processes, the parent
 * and child share the same fd 0. If the parent's stdin stream is in flowing
 * mode (resumed), Node.js keeps polling fd 0 and discards data (no listeners),
 * stealing keystrokes from the child process — causing "swallowed keys".
 *
 * IMPORTANT: Do NOT call stdin.unref() here. Unrefing stdin tells the event
 * loop it can exit even while stdin is open. After a child process with
 * `stdio: "inherit"` exits, re-refing stdin may not fully restore Bun's
 * internal stream state, causing readline "line" events to never fire —
 * which manifests as the terminal appearing to hang.
 *
 * Callers that need stdin later (readline.createInterface, next Ink render)
 * will resume it themselves.
 */
function resetStdin(): void {
  const { stdin } = process;
  if (stdin.isTTY) {
    try {
      stdin.setRawMode(false);
    } catch {
      // ignore if stdin does not support raw mode
    }
  }
  stdin.removeAllListeners("readable");
  stdin.removeAllListeners("data");
  stdin.removeAllListeners("keypress");
  stdin.removeAllListeners("end");
  if (!stdin.isPaused()) {
    stdin.pause();
  }
  // Re-ref stdin in case Ink called unref() during its lifecycle.
  // This ensures the event loop stays alive for subsequent readline usage.
  if (typeof stdin.ref === "function") {
    stdin.ref();
  }
}

function prepareStdinForInk(): void {
  const { stdin } = process;
  if (stdin.isTTY) {
    try {
      stdin.setRawMode(false);
    } catch {
      // ignore if stdin does not support raw mode
    }
  }
  if (typeof stdin.ref === "function") {
    stdin.ref();
  }
  stdin.removeAllListeners("readable");
  stdin.removeAllListeners("data");
  stdin.removeAllListeners("keypress");
  stdin.removeAllListeners("end");
  if (stdin.isPaused()) {
    stdin.resume();
  }
}

function showMenu(prev?: MenuSelection): Promise<MenuSelection> {
  return new Promise((resolve) => {
    let selection: MenuSelection | undefined;
    prepareStdinForInk();
    const instance = inkRender(
      <App
        onSelect={(sel) => {
          selection = sel;
        }}
        initialMainIndex={prev?.mainIndex}
        initialSubIndex={prev?.subIndex}
        initialFocus={prev?.focus}
      />,
    );
    instance.waitUntilExit().then(() => {
      resetStdin();
      resolve(selection ?? { commandId: "__quit__", mainIndex: 0, subIndex: 0, focus: "main" });
    });
  });
}

async function interactiveLoop(): Promise<void> {
  let lastSelection: MenuSelection | undefined;

  while (true) {
    const selection = await showMenu(lastSelection);

    if (selection.commandId === "__quit__") {
      break;
    }

    lastSelection = selection;

    console.log("");
    try {
      await executeCommand(selection.commandId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  [error] ${msg}`);
    }

    // After any command (especially those using stdio: "inherit" child
    // processes or Ink renders), stdin may be in a corrupted state:
    // raw mode on, stale listeners, or paused/unrefed.
    resetStdin();

    console.log("\n  按 Enter 返回菜单...");
    await waitForEnter();
  }
}

async function waitForEnter(): Promise<void> {
  const { stdin } = process;
  if (!stdin.isTTY) return;

  prepareStdinForLineInput();

  // Prefer the controlling terminal over process.stdin. After Ink unmounts
  // and inherited-stdio child processes exit, Bun/Node can leave process.stdin
  // in a state where readline never receives "line". /dev/tty bypasses that
  // stream object and reads directly from the terminal.
  if (process.platform !== "win32") {
    try {
      waitForEnterFromTty();
      return;
    } catch {
      // Fall back to readline below for environments without /dev/tty.
    }
  }

  await waitForEnterWithReadline();
}

function prepareStdinForLineInput(): void {
  const { stdin } = process;
  if (stdin.isTTY) {
    try {
      stdin.setRawMode(false);
    } catch {
      // ignore if stdin does not support raw mode
    }
  }
  if (typeof stdin.ref === "function") stdin.ref();
  stdin.removeAllListeners("readable");
  stdin.removeAllListeners("data");
  stdin.removeAllListeners("keypress");
  stdin.removeAllListeners("end");
  if (!stdin.isPaused()) stdin.pause();
}

function waitForEnterFromTty(): void {
  let fd: number | undefined;
  try {
    fd = openSync("/dev/tty", "r");
    const buffer = Buffer.alloc(1024);
    readSync(fd, buffer, 0, buffer.length, null);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function waitForEnterWithReadline(): Promise<void> {
  return new Promise((resolve) => {
    const { stdin } = process;
    // Restore stdin so readline can read from it
    if (typeof stdin.ref === "function") stdin.ref();

    // After a child process with `stdio: "inherit"` exits, Bun may leave
    // stdin in a destroyed or ended state. In that case readline will never
    // fire "line", so fall back to a short timeout that auto-resolves.
    if (stdin.destroyed || stdin.readableEnded) {
      setTimeout(resolve, 200);
      return;
    }

    if (stdin.isPaused()) stdin.resume();

    const rl = createInterface({ input: stdin, output: process.stdout });
    let resolved = false;

    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      rl.close();
      stdin.removeAllListeners("data");
      stdin.removeAllListeners("keypress");
      if (!stdin.isPaused()) stdin.pause();
      resolve();
    };

    // Safety timeout: if no keypress arrives within 30s, auto-resolve to
    // prevent the terminal from hanging indefinitely. This covers edge
    // cases where stdin is technically alive but data events are lost.
    const timer = setTimeout(done, 30_000);

    rl.once("line", done);

    // If stdin closes/errors while we're waiting, resolve immediately.
    rl.once("close", done);
  });
}

async function routeArgs(args: string[]) {
  if (args[0] === "link") {
    const ctx = createCommandContext();
    await cmdCliLink(ctx);
    return;
  }

  if (args[0] === "unlink") {
    const ctx = createCommandContext();
    await cmdCliUnlink(ctx);
    return;
  }

  if (args[0] === "build") {
    await runCommandLogged("bun", ["run", "build"], { cwd: ROOT_DIR });
    return;
  }

  if (args[0] === "verify" || args[0] === "verify:fast" || args[0] === "verify:full") {
    await runCommandLogged("bun", ["run", args[0]], { cwd: ROOT_DIR });
    return;
  }

  if (args[0] === "bump-version" || args[0] === "bump") {
    const ctx = createCommandContext();
    await cmdBumpVersion(args.slice(1), ctx);
    return;
  }

  if (args[0] === "publish") {
    const ctx = createCommandContext();
    await cmdPublish(args.slice(1), ctx);
    return;
  }

  if (args.length > 0) {
    console.log(`Unknown command: ${args[0]}`);
    return;
  }

  await interactiveLoop();
}

await routeArgs(process.argv.slice(2));
