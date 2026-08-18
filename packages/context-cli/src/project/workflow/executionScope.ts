export type ExecutionResourceState = "active" | "released" | "release-failed";

export interface ExecutionResourceReceipt {
  label: string;
  state: Exclude<ExecutionResourceState, "active">;
  error?: string;
}

export interface ExecutionScopeReceipt {
  name: string;
  resources: ExecutionResourceReceipt[];
  releaseErrors: number;
}

interface ExecutionResource {
  label: string;
  cleanup: () => void | Promise<void>;
  state: ExecutionResourceState;
  releasePromise?: Promise<ExecutionResourceReceipt>;
}

export interface ExecutionResourceHandle {
  release(): Promise<ExecutionResourceReceipt>;
}

/**
 * Owns resources whose lifetime is limited to one execution boundary.
 * Durable workspace mutations are deliberately outside this abstraction and
 * continue to rely on revision checks, project write locks, and atomic writes.
 */
export class ExecutionScope {
  readonly name: string;
  private readonly resources: ExecutionResource[] = [];
  private closePromise?: Promise<ExecutionScopeReceipt>;

  constructor(name: string) {
    this.name = name;
  }

  defer(
    label: string,
    cleanup: () => void | Promise<void>,
  ): ExecutionResourceHandle {
    if (this.closePromise !== undefined) {
      throw new Error(`execution scope is already closing: ${this.name}`);
    }
    const resource: ExecutionResource = { label, cleanup, state: "active" };
    this.resources.push(resource);
    return {
      release: () => this.releaseResource(resource),
    };
  }

  async close(): Promise<ExecutionScopeReceipt> {
    this.closePromise ??= this.closeResources();
    return this.closePromise;
  }

  private async releaseResource(
    resource: ExecutionResource,
  ): Promise<ExecutionResourceReceipt> {
    resource.releasePromise ??= (async () => {
      if (resource.state !== "active") {
        return {
          label: resource.label,
          state: resource.state as Exclude<ExecutionResourceState, "active">,
        };
      }
      try {
        await resource.cleanup();
        resource.state = "released";
        return { label: resource.label, state: "released" as const };
      } catch (error) {
        resource.state = "release-failed";
        return {
          label: resource.label,
          state: "release-failed" as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })();
    return resource.releasePromise;
  }

  private async closeResources(): Promise<ExecutionScopeReceipt> {
    const receipts: ExecutionResourceReceipt[] = [];
    for (const resource of [...this.resources].reverse()) {
      receipts.push(await this.releaseResource(resource));
    }
    return {
      name: this.name,
      resources: receipts,
      releaseErrors: receipts.filter((receipt) => receipt.state === "release-failed").length,
    };
  }
}

