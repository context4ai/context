import { ErrorCategory } from "../../lib/cliFeedback.js";
import { ContextError } from "../../lib/errors.js";
import { ExitCode } from "../../types/exitCode.js";
import {
  CONTEXT_WORKFLOW_AUTHORITIES,
  type ContextWorkflowAuthority,
} from "./workflowTypes.js";

export function collectWorkflowAuthorityOption(
  value: string,
  previous: string[],
): string[] {
  return [...previous, value];
}

export function workflowAuthorities(value: unknown): ContextWorkflowAuthority[] {
  const requested = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  const supported = new Set<string>(Object.values(CONTEXT_WORKFLOW_AUTHORITIES));
  const invalid = requested.filter((item) => !supported.has(item));
  if (invalid.length > 0) {
    throw new ContextError(
      ExitCode.UserError,
      `Unsupported Context workflow authority: ${invalid.join(", ")}`,
      {
        category: ErrorCategory.UserInputInvalid,
        valid_authorities: [...supported].sort(),
      },
    );
  }
  return [...new Set(requested)] as ContextWorkflowAuthority[];
}

export function mergedWorkflowAuthorities(
  ...values: unknown[]
): ContextWorkflowAuthority[] {
  return workflowAuthorities(values.flatMap((value) =>
    Array.isArray(value) ? value : []
  ));
}
