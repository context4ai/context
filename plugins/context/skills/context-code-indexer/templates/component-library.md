---
id: context.code-indexer.template.component-library
kind: procedure
media-type: text/markdown
---

# Component library template

Use for `component-library`: a supported collection of UI components, tokens,
hooks, primitives, or design-system packages consumed through documented
imports and component contracts. A web application that happens to contain
shared components remains a `web-application` unless the component surface is
published as an independent consumer boundary.

Use the exact profile and Artifact policy variant supplied by the workset.

## Evidence pass

Locate:

- public package exports, component registries, barrels, or documented imports;
- component props, slots, events, variants, composition, and lifecycle rules;
- theme, token, styling, accessibility, locale, and provider requirements;
- maintained examples, stories, visual tests, and consumer integration tests;
- compatibility, peer dependency, platform, and release constraints;
- generated declarations, documentation sites, demos, and internal primitives
  that must not become independent reader pages without a public contract.

Treat stories and examples as usage evidence, not as authority for unsupported
props or behavior. When generated declarations disagree with source, identify
the authoritative source and record the gap.

When the Authorized Workset View supplies a public declaration together with
structured props, events, defaults, variants, maintained examples, or source
roles, the corresponding reader section must consume those facts or record an
explicit supported omission/material-gap disposition. Do not replace available
contract facts with a generic statement about the component directory. A group
without any reader-authorizing public declaration remains catalog-only and does
not produce an empty component page.

## Questions the knowledge must answer

1. Which component families are public, and how are they imported?
2. What props, events, variants, slots, and composition rules are supported?
3. Which providers, themes, tokens, runtimes, or peer packages are required?
4. What accessibility, state, lifecycle, and failure constraints apply?
5. Which examples demonstrate supported use and important combinations?
6. Which implementation primitives or demo-only components are excluded?

## Suggested knowledge units

- **Library map**: purpose, supported entrypoints, providers, component
  families, compatibility, and navigation.
- **Component-family guide**: shared concepts, composition, variants,
  accessibility, and representative source-backed examples.
- **Granular component reference**: only when consumers search for the exact
  public component and its contract contains meaningful behavior.
- **Tokens and theming**: only the stable consumer contract, including scope,
  defaults, override order, and compatibility.
- **Migration or compatibility guide**: only when maintained sources describe
  version transitions or supported platform constraints.

## Chapter blueprints

```markdown
# <Component library> map
## Purpose and intended consumers
## Supported imports and providers
## Component and token families
## Composition and state model
## Accessibility and localization
## Theming and customization
## Compatibility and release constraints
## Examples, evidence, and exclusions
```

For a component family:

```markdown
# <Component family>
## When to use it
## Supported components and imports
## Props, events, slots, and variants
## Composition and state
## Accessibility and interaction
## Source-backed examples
## Related families and evidence
```

## Granularity and relationships

Prefer component families over one page per export. Use a granular page only
when the exact public identity has a stable consumer contract beyond a type
signature. Relate components to providers, tokens, accessibility behavior,
examples, and compatible peers only when source evidence supports the link.

Do not copy implementation bodies, generated declarations, every story, or
every styling variant into reader-facing content. Do not use ordinal batches
to disguise an enumeration-heavy index.

## Revise or stop when

- public components cannot be distinguished from internal or demo-only code;
- component behavior is inferred only from screenshots or names;
- examples invent combinations that maintained usage does not support;
- accessibility or provider requirements are asserted without evidence;
- one-page-per-component expansion has no consumer-navigation justification.
