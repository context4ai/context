import { ErrorCategory } from "../lib/cliFeedback.js";
import { ContextError } from "../lib/errors.js";
import { ExitCode } from "../types/exitCode.js";
import {
  requiredSemanticRuleResource,
  type SemanticRuleSet,
} from "./semanticRules.js";

export interface SemanticRulesViewResult extends Record<string, unknown> {
  kind: "semantic.rules.view.result";
  ruleset: Record<string, unknown>;
  next_action: Record<string, unknown>;
}

export function semanticRulesView(input: {
  rules: SemanticRuleSet;
  baseCommand: string;
  ruleId?: string;
  readCursor?: string;
  pageSize?: string;
}): SemanticRulesViewResult {
  const required = input.rules.required.map((rule) => {
    const selected = requiredSemanticRuleResource({
      rules: input.rules,
      id: rule.id,
    });
    return {
      id: rule.id,
      resource_id: rule.resource_id,
      content_digest: rule.content_digest,
      content_available: rule.content_available,
      reason: rule.reason,
      ...(selected === undefined
        ? {}
        : {
            resource: {
              id: rule.resource_id,
              kind: "procedure",
              media_type: "text/markdown",
              path: selected.filePath,
            },
          }),
    };
  });
  if (input.ruleId === undefined) {
    return {
      kind: "semantic.rules.view.result",
      ruleset: {
        scope: input.rules.scope,
        handle: input.rules.handle,
        digest: input.rules.digest,
        rules_version: input.rules.rules_version,
      },
      required,
      next_action: required.length === 0
        ? { kind: "rules_complete", message: "No semantic rule content is required for this view." }
        : {
            kind: "read_required_resources",
            resource_ids: required.map((rule) => rule.resource_id),
            message: "Read the required Markdown resource paths, then continue the current operation. Content is not embedded in CLI JSON.",
          },
    };
  }
  const selected = requiredSemanticRuleResource({
    rules: input.rules,
    id: input.ruleId,
  });
  if (selected === undefined) {
    throw new ContextError(ExitCode.UserError, `semantic rule is not required or available: ${input.ruleId}`, {
      category: ErrorCategory.UserInputInvalid,
      rule: input.ruleId,
      required_rule_ids: required.map((rule) => rule.id),
      next: `${input.baseCommand} --view semantic-rules --format json`,
    });
  }
  const selectedIndex = required.findIndex((rule) => rule.id === input.ruleId);
  const remainingRuleIds = required.slice(selectedIndex + 1).map((rule) => rule.id);
  return {
    kind: "semantic.rules.view.result",
    ruleset: {
      scope: input.rules.scope,
      handle: input.rules.handle,
      digest: input.rules.digest,
      rules_version: input.rules.rules_version,
    },
    rule: {
      id: selected.descriptor.id,
      resource_id: selected.descriptor.resource_id,
      content_digest: selected.descriptor.content_digest,
      reason: selected.descriptor.reason,
      resource: {
        id: selected.descriptor.resource_id,
        kind: "procedure",
        media_type: "text/markdown",
        path: selected.filePath,
      },
    },
    next_action: remainingRuleIds.length === 0
      ? { kind: "rules_complete", message: "All required semantic resource locations are available." }
      : {
          kind: "read_remaining_resources",
          remaining_rule_ids: remainingRuleIds,
          message: "Read the remaining required Markdown resources by path before continuing.",
        },
  };
}
