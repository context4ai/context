# Context case study

[简体中文](./README.zh-CN.md)

This directory contains the public replay for the Context integration described in the [English](../../docs/en/case-studies/agent-graph-workflow.md) and [Chinese](../../docs/zh-CN/case-studies/agent-graph-workflow.md) case studies.

The replay uses an allowlisted, sanitized projection of a real Context debug recording. It preserves route order, repeated evaluations, statuses, reason codes, and relative timing while excluding source content, local paths, credentials, opaque identifiers, and organization-specific names.

Each step links to the corresponding published [Action and Resource files](https://github.com/context4ai/context/tree/main/packages/context-cli/context-workflow). The **Workspace graph** overlay visualizes the static contract captured by the replay; the linked [`workspace.yaml`](https://github.com/context4ai/context/blob/main/packages/context-cli/context-workflow/graphs/workspace.yaml) remains authoritative for the current workflow.

Open `index.html` through a static HTTP server. GitHub Pages publishes the same files at:

<https://context4ai.github.io/context/case-studies/workflow/?lang=en>

The page is intentionally outside the npm package. It documents the Context workflow integration and is not part of the Context runtime.

## Media

When a narrated recording is available, place it at `assets/context-replay.mp4` and link or embed that stable path from the project README. Do not replace the interactive replay: the video explains the case, while the replay remains the inspectable source of route behavior.
