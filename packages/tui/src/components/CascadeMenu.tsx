import { Box, Text } from "ink";
import type { MenuItem } from "../menuItem.js";
import { displayWidth } from "../utils/displayWidth.js";

interface Props {
  items: MenuItem[];
  selectedIndex: number;
  expandedId: string | null;
  subSelectedIndex: number;
  focusLevel: "main" | "sub";
}

export function CascadeMenu({
  items,
  selectedIndex,
  expandedId,
  subSelectedIndex,
  focusLevel,
}: Props) {
  const expandedIndex = items.findIndex((item) => item.id === expandedId);
  const expandedItem = expandedIndex >= 0 ? items[expandedIndex] : null;

  // Indicator column: "▶" is 2 terminal cols, we use a fixed-width Box of 3 (▶ + space)
  const indicatorWidth = 3;

  // Calculate main menu label column width based on longest item (label + optional " →")
  const mainLabelWidth = items.reduce((max, item) => {
    const hasChildren = item.children && item.children.length > 0;
    let width = displayWidth(item.label);
    if (hasChildren) width += 2; // " →"
    return Math.max(max, width);
  }, 0) + 2; // extra padding

  const mainMenuWidth = indicatorWidth + mainLabelWidth;

  return (
    <Box position="relative">
      {/* Main menu */}
      <Box flexDirection="column" width={mainMenuWidth}>
        {items.map((item, index) => {
          const isSelected = index === selectedIndex;
          const hasChildren = item.children && item.children.length > 0;

          return (
            <Box key={item.id}>
              <Box width={indicatorWidth}>
                <Text
                  bold={isSelected && focusLevel === "main"}
                  {...(isSelected ? { color: "cyan" as const } : {})}
                >
                  {isSelected && focusLevel === "main" ? "▶" : " "}
                </Text>
              </Box>
              <Text
                bold={isSelected && focusLevel === "main"}
                {...(isSelected ? { color: "cyan" as const } : {})}
              >
                {item.label}
                {hasChildren ? " →" : ""}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Floating submenu */}
      {expandedItem?.children && (() => {
        // Calculate max label display width for consistent alignment
        const maxLabelWidth = expandedItem.children.reduce((max, child) => {
          return Math.max(max, displayWidth(child.label));
        }, 0);

        return (
          <Box
            position="absolute"
            marginLeft={mainMenuWidth + 2}
            marginTop={Math.max(0, expandedIndex - 1)}
            borderStyle="single"
            borderColor="cyan"
            flexDirection="column"
            paddingLeft={1}
            paddingRight={3}
          >
            {expandedItem.children.map((child, childIndex) => {
              const isChildSelected = childIndex === subSelectedIndex;
              const padded = child.label + " ".repeat(Math.max(0, maxLabelWidth - displayWidth(child.label)));
              return (
                <Box key={child.id}>
                  <Box width={indicatorWidth}>
                    <Text
                      bold={isChildSelected && focusLevel === "sub"}
                      {...(isChildSelected ? { color: "cyan" as const } : {})}
                    >
                      {isChildSelected && focusLevel === "sub" ? "▶" : " "}
                    </Text>
                  </Box>
                  <Text
                    bold={isChildSelected && focusLevel === "sub"}
                    {...(isChildSelected ? { color: "cyan" as const } : {})}
                  >
                    {padded}
                  </Text>
                </Box>
              );
            })}
          </Box>
        );
      })()}
    </Box>
  );
}
