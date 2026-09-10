import type { ArticleScenario } from "./articleCodeScenarios.fixture.js";

export const ARTICLE_COMPONENT_SCENARIO: ArticleScenario = {
  id: "component-family", profile: "component-library", source: `import React from "react";
export interface TagProps {text: string; tone?: "neutral" | "warning"}
export function Tag({text, tone = "neutral"}: TagProps) { return React.createElement("span", {"data-tone": tone}, text); }
export interface FieldProps {value: string; disabled?: boolean; onChange(value: string): void}
export function Field({value, disabled = false, onChange}: FieldProps) { return React.createElement("input", {value, disabled, onChange: (event: {target: {value: string}}) => onChange(event.target.value)}); }
export interface FieldHandle { focus(): void }
export const ForwardField = React.forwardRef<FieldHandle, FieldProps>((props, ref) => { const input = React.useRef<HTMLInputElement>(null); React.useImperativeHandle(ref, () => ({focus() {input.current?.focus();}})); return React.createElement("input", {ref: input, value: props.value, disabled: props.disabled, onChange: (event: {target: {value: string}}) => props.onChange(event.target.value)}); });
export interface PopoverProps {open: boolean; onClose(): void; children: React.ReactNode}
export function Popover({open, onClose, children}: PopoverProps) { return open ? React.createElement("div", {role: "dialog", onKeyDown: (event: {key: string}) => {if(event.key === "Escape") onClose();}}, children) : null; }
export interface MenuItem {key: string; label: string; children?: MenuItem[]}
export function MenuItemView({item}: {item: MenuItem}) {return React.createElement("li", {"data-key": item.key}, item.label);}
export const Menu = {Item: MenuItemView};
export interface NotificationHandle {close(): void; update(message: string): void}
export function openNotification(host: HTMLElement, message: string): NotificationHandle {const node = document.createElement("div"); node.textContent = message; host.appendChild(node); return {close() {node.remove();}, update(next) {node.textContent = next;}};}
export const tokens = {colors: {foreground: "#222"}, typography: {bodySize: "14px"}, spacing: {small: "8px"}, elevation: {overlay: 10}, motion: {fast: "120ms"}};
export const semanticTokens = {text: "colors.foreground"};
export const icons = {close: "assets/close.svg"};
export const ThemeContext = React.createContext(tokens);
export const ThemeProvider = ThemeContext.Provider;
export function useTheme() {return React.useContext(ThemeContext);}
`, articles: [
    { type: "l05", title: "Sample component library", task: "Find shared setup and individual component responsibilities", slots: {
      catalog: "src/index.ts exports Tag, Field, Popover, Menu.Item and openNotification. These represent display, controlled input, overlay, compound and imperative capabilities.",
      configuration: "ThemeProvider and useTheme expose shared tokens. Per-component behavior belongs to its entry. No CSS reset, package release or native implementation is provided." } },
    { type: "l02", key: "tag", symbols: ["Tag", "TagProps"], title: "Tag display component", task: "Use display properties and defaults", slots: {
      purpose: "Tag in src/index.ts renders text in a span with data-tone. tone defaults to neutral and also accepts warning.",
      limits: "Tag has no interaction or form-change API. Its tone attribute alone does not prove rendered colors or contrast compliance." } },
    { type: "l02", key: "field", symbols: ["Field", "FieldProps", "FieldHandle", "ForwardField"], apiRows: [["FieldHandle", "focus"]], title: "Controlled field", task: "Track input value and callback ownership", slots: {
      behavior: "Field in src/index.ts renders the supplied value, defaults disabled to false and forwards event.target.value through onChange. ForwardField additionally exposes FieldHandle.focus through useImperativeHandle and an input ref; it does not focus automatically.",
      limits: "The parent owns the value. No validation, debounce or uncontrolled defaultValue path is implemented; inspect the parent's state handling if edits disappear." } },
    { type: "l02", key: "popover", symbols: ["Popover", "PopoverProps"], title: "Popover overlay", task: "Find open state and close behavior", slots: {
      behavior: "Popover in src/index.ts returns null when open is false. When open, it renders role=dialog and invokes onClose for Escape.",
      limits: "The caller must update open. No focus trap, outside click, portal or positioning implementation is present; role=dialog is not evidence of full accessibility compliance." } },
    { type: "l02", key: "menu", symbols: ["Menu", "MenuItemView", "MenuItem"], title: "Compound menu family", task: "Find parts and nested data without assuming recursion", slots: {
      purpose: "Menu.Item in src/index.ts points to MenuItemView. MenuItem declares key, label and optional recursive children.",
      behavior: "MenuItemView renders only the item's key and label. The children type does not implement nested rendering, selection, keyboard navigation or expansion." } },
    { type: "l02", key: "notification", symbols: ["openNotification", "NotificationHandle"], apiRows: [["NotificationHandle", "close"], ["NotificationHandle", "update"]], title: "Imperative notification handle", task: "Use methods and cleanup instead of a Props-only contract", slots: {
      behavior: "openNotification in src/index.ts appends a DOM node to the supplied host and returns NotificationHandle with close and update. update changes textContent; close removes that node.",
      limits: "The caller owns cleanup. No duration timer, global singleton or SSR DOM fallback is implemented. Keep method and handle behavior explicit rather than presenting only component properties." } },
    { type: "l03", key: "system", title: "Theme resource entry", task: "Find implemented resources without inventing design goals", slots: {
      purpose: "src/index.ts supplies tokens, semanticTokens, icons, ThemeProvider and useTheme. It is an implementation resource map, not a complete design rationale.",
      catalog: "The source includes color, typography, spacing, elevation, motion and an icon pointer. Their entries below describe the actual supplied Web values and consumption boundary." } },
    { type: "l03", key: "colors", title: "Color and semantic aliases", task: "Distinguish an alias from a resolved value", slots: {
      mapping: "src/index.ts defines colors.foreground as #222 and semanticTokens.text as the string colors.foreground. No alias resolver is implemented.",
      rules: "An alias string is not a computed runtime color. Read the consumer or resolver before replacing a semantic name with a concrete value." } },
    { type: "l03", key: "typography", title: "Typography resources", task: "Locate font-size authority", slots: {
      catalog: "tokens.typography.bodySize in src/index.ts is 14px.",
      platforms: "The fixture supplies no font family, scale rule or native typography mapping. The Web size is not a universal platform default." } },
    { type: "l03", key: "spacing", title: "Spacing resources", task: "Locate layout token consumption", slots: {
      catalog: "tokens.spacing.small in src/index.ts is 8px.",
      consumption: "useTheme exposes the token object to consumers. No grid, breakpoint or spacing composition rule is implemented in this source." } },
    { type: "l03", key: "elevation", title: "Elevation resources", task: "Find layer value and its limits", slots: {
      catalog: "tokens.elevation.overlay in src/index.ts is 10.",
      rules: "The token declaration alone does not set CSS z-index or prove stacking behavior. Inspect the overlay consumer and its stacking context." } },
    { type: "l03", key: "motion", title: "Motion resources", task: "Distinguish duration from animation behavior", slots: {
      catalog: "tokens.motion.fast in src/index.ts is 120ms.",
      rules: "No animation, easing, reduced-motion preference or event timing guarantee is implemented by this token." } },
    { type: "l03", key: "icons", title: "Icon resource entry", task: "Find assets without fabricating rendered appearance", slots: {
      catalog: "icons.close in src/index.ts points to assets/close.svg. The SVG is not included in this source fixture.",
      consumption: "Read the authorized asset and rendering consumer to determine appearance, direction handling or customization. Do not infer them from the name close." } },
    { type: "l03", key: "theme-runtime", title: "Theme context integration", task: "Find the runtime override boundary", slots: {
      consumption: "ThemeContext in src/index.ts uses tokens as its default; ThemeProvider is its Provider and useTheme calls useContext.",
      rules: "A provided value follows React context replacement semantics; this fixture implements no deep merge, dark-mode selection, CSS loading or hydration policy. Inspect the application's Provider usage for overrides." } },
  ],
};
