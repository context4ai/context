/**
 * File header for sample
 * @module sample-module
 */
import fs, { readFile as readFileAlias } from "node:fs";
import { helper, type Bar as BarType } from "./util";
import * as Utils from "./utils";

interface LocalInterface {
  run(task: string): Promise<void>;
}

class Base {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
}

export interface User {
  id: string;
}

export type Kind = "a" | "b";

export type ButtonProps = {
  size: "small" | "medium" | "large";
  variant?: string;
  disabled: boolean;
  onClick: (event: MouseEvent) => void;
  render(): JSX.Element;
};

export type WrappedResult = Promise<{ data: string; error: boolean }>;

export type IntersectionProps = {
  label: string;
  loading: boolean;
} & Omit<HTMLElement, 'children'>;

export type { LocalInterface, Kind as KindAlias };

export enum Role {
  Admin,
}

export class Service extends Base implements LocalInterface, ExternalInterface {
  public name: string;

  constructor(id: string, name: string) {
    super(id);
    this.name = name;
  }

  async run(task: string): Promise<void> {
    helper(task);
    Utils.log(task);
  }
}

export function doWork(input: string): number {
  return helper(input);
}

export const create = async (value: number) => {
  return Utils.compute(value);
};

export default Service;

const unused = fs.existsSync;
const alias = readFileAlias;
const bar: BarType | null = null;
void unused;
void alias;
void bar;
