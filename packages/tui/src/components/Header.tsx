import { Box, Text } from "ink";
import { padToWidth } from "../utils/displayWidth.js";

interface Props {
  title: string;
}

export function Header({ title }: Props) {
  const width = 50;
  const border = "═".repeat(width - 2);
  const innerWidth = width - 4;

  return (
    <Box flexDirection="column">
      <Text color="cyan">╔{border}╗</Text>
      <Text color="cyan">
        ║ <Text bold>{padToWidth(title, innerWidth)}</Text> ║
      </Text>
      <Text color="cyan">╚{border}╝</Text>
    </Box>
  );
}
