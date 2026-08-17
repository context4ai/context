import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FileSystem } from "@c4a/extract";

const fixturesRoot = fileURLToPath(new URL("./fixtures", import.meta.url));

export class FixtureFileSystem implements FileSystem {
  constructor(private readonly rootDir: string) {}

  #resolve(path: string) {
    return join(this.rootDir, path);
  }

  async readFile(path: string) {
    return readFile(this.#resolve(path), "utf-8");
  }

  async readdir(path: string) {
    return readdir(this.#resolve(path));
  }

  async exists(path: string) {
    try {
      await access(this.#resolve(path));
      return true;
    } catch {
      return false;
    }
  }

  async readJson<T = unknown>(path: string) {
    return JSON.parse(await this.readFile(path)) as T;
  }
}

export const getFixtureFs = (name: string) => new FixtureFileSystem(join(fixturesRoot, name));
