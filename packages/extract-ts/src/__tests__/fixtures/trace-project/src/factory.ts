import type { PublicType } from "./types";

export function createWidget(input: PublicType): PublicType {
  return input;
}

export enum WidgetMode {
  Inline = "inline",
  Block = "block",
}

export const DEFAULT_WIDTH = 420;

export class WidgetClient {}

export const widgetClient = new WidgetClient();

export interface WidgetRegistry {
  [name: string]: PublicType;
}

export const formatWidget = (input: PublicType): string => {
  return input.id;
};

const localHelper = (value: string) => value.length;
void localHelper;
