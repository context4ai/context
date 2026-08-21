# Context Agent Integration

[简体中文](./README_CN.md)

<p align="center"><img src="./assets/logo.svg" alt="Context" width="180"/></p>

This plugin is the conversational entry to the Context knowledge production
workflow. It lets users describe a knowledge goal to an Agent, then connects
that conversation to the local Context runtime, current workspace facts, and
Route-selected procedures.

The plugin deliberately exposes one thin public entry instead of separate
commands for initialization, source capture, review, and build. The detailed
workflow stays in the runtime's Provider bundle, where it can be selected by
current facts, validated, tested, and updated without turning the entry into a
large prompt.

## User experience

After the integration is installed and the Agent host is refreshed, invoke the
Context entry and describe the desired knowledge:

```text
/c4a:context Build a searchable Agent knowledge package from our architecture
documents and this repository. Preserve source evidence and show me the final
structure before approval.
```

The same entry can initialize a requested workspace, locate an existing one,
or continue its current production round. The Agent explains user decisions in
the conversation and uses the runtime for mechanical state transitions. Users
do not need to select low-level lifecycle commands themselves.

## Install

The plugin is bundled with the Context runtime:

```bash
npm install -g @c4a/context-cli@latest
context plugin install
```

For a source checkout, build first and install the development projection:

```bash
bun run --filter @c4a/context-cli build
context plugin install --dev
```

Use `context plugin install --dry-run` to inspect the host projections and
`context plugin status` to diagnose an installation. Refresh the Agent host
after changing or reinstalling the plugin.

## Entry contract

The maintained source is [`commands/context.md`](./commands/context.md). Its
bootstrap flow is:

1. run the read-only `context entry --language <language> --format json`;
2. execute only its returned `next_action.command`;
3. after workspace setup, treat `workflow.current` as the current-step
   authority;
4. read every required Route resource completely;
5. execute only the selected action or configuration change;
6. evaluate the workspace again.

The entry does not infer workspace state from surrounding files. Initialization
is executed only when explicitly requested or confirmed; entering and
evaluating an existing workspace is read-only. There is no `context continue`
primitive and no stage-specific public Skill.

## Progressive workflow context

Procedures, dialogue, diagnostics, schemas, source bodies, and generated views
are addressable workflow resources. Static resources use content digests;
dynamic views are tied to the workflow revision that selected them. Read
receipts can keep unchanged resources current within one conversation, but a
receipt never proves that an external action completed.

At a human Gate, inspection and resolution resources remain phase-local. The
Agent loads inspection material before a decision and resolution material only
after confirmation. This keeps the ordinary review path available without
preloading every possible decision surface.

## Fully managed conversations

Fully managed operation is used only after the user explicitly authorizes it in
the current conversation. The Agent then starts with:

```bash
context run --managed --until blocked-or-complete --format json
```

The loop executes consecutive deterministic actions and Route-delegated Gates,
re-evaluating after every action. It stops before semantic reading, project
configuration, unresolved permission, diagnostic repair, or a non-unique plan.
Managed authority is never persisted or reused in another conversation.

## Boundaries

- The plugin does not call an LLM; it is consumed by the host Agent.
- All workspace lifecycle writes go through Route-selected Context actions.
- It does not silently clone, fetch, checkout, install, build, test, or read
  external content without the required authority.
- It does not duplicate workflow facts or lifecycle routing in the prompt.
- It keeps CLI tokens, paths, ids, flags, and `source_ref` values unchanged,
  while explaining decisions in the user's current conversation language.

## Maintainer note

`plugin/` is the only hand-maintained integration source. The build projects it
to Claude commands, Codex Skills, Cursor commands, and a Skill-only layout under
`dist/plugins`. Do not edit generated projections directly.
