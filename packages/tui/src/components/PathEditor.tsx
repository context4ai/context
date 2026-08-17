import { Box, Text } from "ink";

interface PathEditorProps {
  value: string;
  cursor: number;
  error?: string | null;
}

export function PathEditor({ value, cursor, error }: PathEditorProps) {
  const before = value.slice(0, cursor);
  const cursorChar = value[cursor] ?? " ";
  const after = value.slice(cursor + 1);

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>路径: </Text>
        <Text>{before}</Text>
        <Text inverse>{cursorChar}</Text>
        <Text>{after}</Text>
      </Box>
      {error ? (
        <Box marginLeft={6}>
          <Text color="red">{error}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
