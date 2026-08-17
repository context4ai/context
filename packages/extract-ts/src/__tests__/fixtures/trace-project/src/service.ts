import type { PublicType } from "./types";
import { helper } from "./helpers";
import { ExternalThing } from "external-lib";

class BaseService {}

interface Runnable {
  run(input: PublicType): PublicType;
}

export class Service extends BaseService implements Runnable {
  public config: PublicType;

  constructor(config: PublicType) {
    this.config = config;
  }

  run(input: PublicType): PublicType {
    helper(input.id);
    void ExternalThing;
    return input;
  }
}
