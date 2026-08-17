import { Box, Text } from "ink";
import { displayWidth, padToWidth, truncateToWidth } from "../utils/displayWidth.js";

const INDICATOR_WIDTH = 3;
const MIN_COL_WIDTH = 14;
const MAX_COL_WIDTH = 30;
const COL_PADDING = 2;

export function gridNavigate(
  currentIndex: number,
  direction: "up" | "down" | "left" | "right",
  totalItems: number,
  columns: number,
): number {
  if (totalItems <= 0) return 0;
  const row = Math.floor(currentIndex / columns);
  const col = currentIndex % columns;
  const totalRows = Math.ceil(totalItems / columns);

  switch (direction) {
    case "left":
      return currentIndex > 0 ? currentIndex - 1 : totalItems - 1;
    case "right":
      return currentIndex < totalItems - 1 ? currentIndex + 1 : 0;
    case "up": {
      if (row === 0) {
        const target = (totalRows - 1) * columns + col;
        return Math.min(target, totalItems - 1);
      }
      return currentIndex - columns;
    }
    case "down": {
      const target = currentIndex + columns;
      if (target >= totalItems) {
        return Math.min(col, totalItems - 1);
      }
      return target;
    }
  }
}

interface DirectoryGridProps {
  entries: string[];
  selectedIndex: number;
  columns: number;
}

export function DirectoryGrid({ entries, selectedIndex, columns }: DirectoryGridProps) {
  if (entries.length === 0) {
    return (
      <Box>
        <Text dimColor>(空目录)</Text>
      </Box>
    );
  }

  const maxEntryWidth = entries.reduce(
    (max, entry) => Math.max(max, displayWidth(entry)),
    0,
  );
  const colWidth = Math.min(
    MAX_COL_WIDTH,
    Math.max(MIN_COL_WIDTH, maxEntryWidth + COL_PADDING),
  );

  const rows: string[][] = [];
  for (let i = 0; i < entries.length; i += columns) {
    rows.push(entries.slice(i, i + columns));
  }

  return (
    <Box flexDirection="column">
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex}>
          {row.map((entry, colIndex) => {
            const flatIndex = rowIndex * columns + colIndex;
            const isSelected = flatIndex === selectedIndex;
            const isParent = entry === "..";

            return (
              <Box key={flatIndex} width={INDICATOR_WIDTH + colWidth}>
                <Box width={INDICATOR_WIDTH}>
                  <Text
                    bold={isSelected}
                    {...(isSelected ? { color: "cyan" as const } : {})}
                  >
                    {isSelected ? "▶" : " "}
                  </Text>
                </Box>
                <Text
                  bold={isSelected}
                  dimColor={isParent && !isSelected}
                  {...(isSelected ? { color: "cyan" as const } : {})}
                >
                  {padToWidth(truncateToWidth(entry, colWidth), colWidth)}
                </Text>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
