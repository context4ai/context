import { z } from "zod";

const color = z.string().regex(/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/iu, "Use a hexadecimal CSS color (#RGB, #RRGGBB or #RRGGBBAA)");
export const siteThemeColorsSchema = z.object({
  brand: color.optional(), accent: color.optional(), background: color.optional(), surface: color.optional(),
  text: color.optional(), mutedText: color.optional(), border: color.optional(),
}).strict();
export const siteThemeSchema = z.object({ light: siteThemeColorsSchema.optional(), dark: siteThemeColorsSchema.optional() }).strict();
export type SiteTheme = z.infer<typeof siteThemeSchema>;
export type SiteThemeColors = Required<z.infer<typeof siteThemeColorsSchema>>;
export const DEFAULT_SITE_THEME: { light: SiteThemeColors; dark: SiteThemeColors } = {
  light: { brand: "#2563eb", accent: "#00bec8", background: "#ffffff", surface: "#f8f9fc", text: "#161e2e", mutedText: "#646b7c", border: "#e7e9ef" },
  dark: { brand: "#8eb7ff", accent: "#b3cfff", background: "#171b24", surface: "#1b1d24", text: "#e2e4ed", mutedText: "#a1a6b7", border: "#303440" },
};
