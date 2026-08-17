import { Box, Text } from "ink";

interface Props {
  command: string;
  descriptions: Record<string, string>;
  configSummary?: string | null;
  fallback?: string;
}

export function HelpPanel({ command, descriptions, configSummary, fallback = "Select a command to see its description." }: Props) {
  const description = descriptions[command] || fallback;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text dimColor>{description}</Text>
      {configSummary ? (
        <Text color="cyan">{configSummary}</Text>
      ) : null}
    </Box>
  );
}
