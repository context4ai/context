---
type: Knowledge Bundle
title: "{{displayName}}"
description: "Approved knowledge bundle generated from a Context workspace."
tags:
  - context
  - knowledge-base
timestamp: "{{knowledgeTimestamp}}"
resource: "context://package/{{packageName}}/{{wikisRoot}}"
package: "{{packageName}}"
package_kind: "{{packageKind}}"
knowledge_count: {{knowledgeCount}}
---

<!-- context:template
This file is a starter template. It is rendered by `context build` and copied to
`dist/<package-name>/{{wikisRoot}}/index.md`.

Template comments that start with `context:template` are removed from build output.
Read the template variable guide before customizing:
node_modules/@c4a/context/docs/reference/template-variables.md

Customize this file before calling the package usable. Add the bundle scope,
intended readers, recommended reading order, known gaps, product scenarios,
or task-focused entry sections. The default root index links small directory
contents directly and links to child index.md files when a directory exceeds
the package navigation threshold.
-->

# {{displayName}}

This knowledge bundle contains `{{knowledgeCount}}` approved knowledge page(s).
Use this index as the entry point, then open the linked knowledge pages for source-linked details.

## Contents

{{knowledgeGroupsMarkdown}}

## How To Use

- Start from the navigation above, then open linked pages or child indexes for source-linked details.
- Use the bundled knowledge-query Skill when this bundle is installed as an agent knowledge package.
- Package authors should replace or edit this generic index before publishing when the package needs bundle scope, known gaps, project-specific reading paths, or task entry points; otherwise explicitly accept the unchanged default during Context package-template review.
