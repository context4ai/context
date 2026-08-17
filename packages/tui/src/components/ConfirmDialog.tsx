import { useState } from "react";
import { render as inkRender, Box, Text, useApp, useInput } from "ink";

interface ConfirmDialogProps {
  title: string;
  message: string;
  onConfirm: (confirmed: boolean) => void;
}

function ConfirmDialogComponent({ title, message, onConfirm }: ConfirmDialogProps) {
  const { exit } = useApp();
  const [selected, setSelected] = useState(1); // 0 = Yes, 1 = No (default No)

  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow) {
      setSelected((s) => (s === 0 ? 1 : 0));
    } else if (key.return || input === " ") {
      exit();
      onConfirm(selected === 0);
    } else if (input === "y" || input === "Y") {
      exit();
      onConfirm(true);
    } else if (input === "n" || input === "N" || input === "q") {
      exit();
      onConfirm(false);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          ⚠️  {title}
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text> {message}</Text>
      </Box>

      <Box marginTop={1}>
        <Text> 确认执行？ </Text>
        <Text
          {...(selected === 0 ? { color: "green" as const } : {})}
          bold={selected === 0}
          inverse={selected === 0}
        >
          {" 是(Y) "}
        </Text>
        <Text>  </Text>
        <Text
          {...(selected === 1 ? { color: "red" as const } : {})}
          bold={selected === 1}
          inverse={selected === 1}
        >
          {" 否(N) "}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor> ←→ 选择  Y/N 快捷键  ↵ 确认</Text>
      </Box>
    </Box>
  );
}

export function confirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const instance = inkRender(
      <ConfirmDialogComponent
        title={title}
        message={message}
        onConfirm={(confirmed) => {
          result = confirmed;
        }}
      />,
    );
    instance.waitUntilExit().then(() => {
      // Ink leaves stdin in raw mode with listeners attached.
      // Clean up so subsequent readline / Ink renders work correctly.
      const { stdin } = process;
      if (stdin.isTTY) {
        try { stdin.setRawMode(false); } catch { /* ignore */ }
      }
      stdin.removeAllListeners("readable");
      stdin.removeAllListeners("data");
      stdin.removeAllListeners("keypress");
      stdin.removeAllListeners("end");
      if (!stdin.isPaused()) stdin.pause();
      if (typeof stdin.ref === "function") stdin.ref();
      resolve(result);
    });
  });
}
