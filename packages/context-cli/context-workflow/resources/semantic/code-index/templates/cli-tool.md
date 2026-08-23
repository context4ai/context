---
id: semantic.code-index.template.cli-tool
kind: procedure
media-type: text/markdown
---

# CLI and developer tool template

Use for `cli-tool`: command-line applications, developer tools, administrative
executables, generators, and command-driven plugin hosts. A build script used
only internally does not need a CLI knowledge unit unless it is a supported
operator or contributor surface.

Recommended `outputProfile`: `command-map`.

## Evidence pass

Locate:

- executable/bin entry, runtime requirement, and command parser;
- root and nested command registration;
- positional arguments, flags, defaults, mutually exclusive options, and input
  schemas;
- configuration files, environment variables, profiles, credential sources,
  and precedence;
- interactive prompts versus non-interactive/automation behavior;
- filesystem, repository, network, platform, and plugin side effects;
- output formats, stdout/stderr behavior, exit codes, polling, and recovery;
- local development, packaging, installation, compatibility, and release;
- deprecated commands, aliases, parser helpers, and formatters to exclude.

Inspect actual command registration and representative execution paths. Help
text is useful evidence but may not describe hidden preconditions or effects.

## Questions the knowledge must answer

1. How is the CLI installed or invoked, and what runtime does it require?
2. What stable command families exist and what user outcomes do they produce?
3. What inputs, configuration, credentials, and precedence rules apply?
4. Which commands mutate files, repositories, remote services, or user state?
5. What output and exit behavior supports automation and diagnosis?
6. Which plugin or extension points change the command surface?
7. How does a user recover from common source-backed failure states?

## Suggested knowledge units

- **Command map**: invocation model, command families, configuration,
  credentials, side effects, output formats, and extension points.
- **Task workflow**: an end-to-end supported user goal spanning several
  commands, with preconditions, state transitions, and recovery.
- **Command-family reference**: coherent subcommands with inputs, outputs,
  side effects, and examples.
- **Configuration and credentials**: when precedence or environment behavior is
  complex and stable enough for a dedicated page.
- **Plugin/extension contract**: use the single complete blueprint in
  `plugin-extension.md`; the command map only links commands and configuration
  to that contract.
- **Development and release guide**: only source-backed contributor workflows
  owned by this module.

## Chapter blueprints

```markdown
# <CLI> command map
## Purpose, installation, and invocation
## Command families
## Configuration and precedence
## Credentials and external dependencies
## Filesystem/repository/remote side effects
## Output formats and exit semantics
## Plugins, compatibility, and release
## Diagnostics, recovery, and exclusions
```

For a command family:

```markdown
# <Command family>
## User outcomes and preconditions
## Commands and arguments
## Configuration and credential requirements
## Execution and side effects
## Output and exit behavior
## Failure recovery
## Source-backed examples
```

A workflow page may use:

```markdown
# <User task>
## Starting state
## Command sequence
## State and artifact changes
## Remote operations
## Success checks
## Recovery and rollback boundaries
```

## Granularity and relationships

Prefer command families and user tasks over one page per parser node, flag,
prompt, formatter, or implementation function. Split only when commands have
different state ownership, external systems, or safety/recovery contracts.

Every retained page must name real commands, task outcomes, state changes, or
extension identities with source locators. A list of command directories or
parser nodes is not a command map.

Connect commands to configuration, package/file outputs, plugin providers, and
platform operations only when source registrations or call sites prove them.

## Template composition examples

- A CLI with installable providers also reads `adapter.md` and
  `plugin-extension.md`.
- A CLI that primarily wraps a remote protocol selects `protocol-consumer` and
  reads `protocol-boundary.md`.
- A monorepo release tool may combine this template with
  `monorepo-container.md` and `build-release` without duplicating its command
  registry.

## Revise or stop when

- no stable command registry or executable entry is found;
- examples require inventing flags or commands not present in source;
- side effects or credential behavior are unclear but material to safe use;
- every option/parser helper is becoming an independent page;
- deprecated or hidden implementation commands are presented as supported.
