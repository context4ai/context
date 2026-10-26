# Source checklist

A page a team fills in before a knowledge base is built, so the Agent starts from
a list instead of a conversation. It is optional: material described in
conversation is registered the same way.

Copy the template below, delete the groups you do not need, replace the example
rows, and give the Agent the page's link.

## How to fill it in

1. Keep one row per source, and write the link's text as the material's name.
2. Every row needs a link that opens and a single owner.
3. Choose one update dependency per row; the note at the end explains the two.
4. Leave a row in with "to confirm" after the owner when you are unsure it belongs.

## Sources

### Code repositories

The repositories the knowledge is about and the ones it directly depends on.
Registered repositories are pinned to a commit and compared by diff later.

| Link | What it is | Owner | Update dependency |
| --- | --- | --- | --- |
| [example-org/billing-service](https://example.com/example-org/billing-service) | The service the knowledge describes | A. Rivera | Registered as a dependency |
| [example-org/billing-sdk](https://example.com/example-org/billing-sdk) | Client the service's callers use | B. Osei | Registered as a dependency |

### Skills and plugins

The Skills a workflow actually calls. Record the identifier and version; when the
version moves, the knowledge is rechecked.

| Link | What it is | Owner | Update dependency |
| --- | --- | --- | --- |
| [invoice-report-gen v1.4.0](https://example.com/skills/invoice-report-gen) | Generates the reports the guides describe | B. Osei | Registered as a dependency |
| [billing-metrics v0.9.2](https://example.com/skills/billing-metrics) | Collects the numbers quoted in the reference | C. Hart | Registered as a dependency |

### Documents

Design documents, specifications and one-pagers that have settled. Drafts and
open proposals are left out.

| Link | What it is | Owner | Update dependency |
| --- | --- | --- | --- |
| [Billing settlement design](https://example.com/docs/billing-settlement) | Goals and division of work; the basis for the guides | A. Rivera | Registered as a dependency |
| [Billing FAQ](https://example.com/docs/billing-faq) | Past questions, used to fill the reference pages | C. Hart | First-time reference |

### Conversations

Troubleshooting or design discussions that reached a conclusion. Write them up as
one note first, then list the note.

| Link | What it is | Owner | Update dependency |
| --- | --- | --- | --- |
| [Settlement incident, 2026-03-18](https://example.com/notes/settlement-incident) | How one production problem was found and fixed | C. Hart | First-time reference |
| [Scope discussion](https://example.com/notes/billing-scope) | Which repositories belong to this topic | A. Rivera | First-time reference |

### Platforms and live sites

Consoles, dashboards or published sites the pages need to cite.

| Link | What it is | Owner | Update dependency |
| --- | --- | --- | --- |
| [Billing console](https://example.com/console/billing) | Where operators do the work the guides describe | D. Lindqvist | Registered as a dependency |
| [Existing handbook](https://example.com/handbook/billing) | Already published, so it is not written twice | D. Lindqvist | First-time reference |

### Notes and attachments

Weekly reports, retrospectives and screenshots. They fold into the guides and
reference rather than becoming topics of their own.

| Link | What it is | Owner | Update dependency |
| --- | --- | --- | --- |
| [2026-03 billing weekly](https://example.com/notes/billing-weekly) | Progress, useful as background | B. Osei | First-time reference |
| [Release retrospective](https://example.com/notes/billing-retro) | Pitfalls, written into the FAQ | A. Rivera | First-time reference |

> **Update dependency**: *Registered as a dependency* = when the source changes,
> the pages resting on it are rechecked and revised; it stays anchored to a commit
> or version. *First-time reference* = read while writing this round and cited in
> the text; later updates do not come back to it.

## Structure

Keep the directory closest to the knowledge base you are building, delete the
rest, then add or drop levels.

- **Product or service knowledge base** — Overview; Getting started; Solutions by
  scenario; Guides for the workflow, integration and release; Reference for
  commands, fields and FAQ.
- **External manual for a platform** — Overview; Getting started with access;
  Solutions by use case; Guides for daily operation and troubleshooting;
  Reference for APIs, configuration and limits.
- **External manual for a tool** — Overview; Getting started with install and
  first output; Guides for each workflow; How it works; Reference; Release notes.
- **On-call knowledge base** — Duty basics; Common problems by component;
  Troubleshooting from symptom to action; Contacts and escalation; Past cases.
- **Business knowledge base** — Business overview; Terms and rules; End-to-end
  flow; Common questions; Change log.

## Start-up prompt

Adjust it, then send it with the checklist's link.

```text
I own <team / knowledge base>. Research and initialise the knowledge workspace
from this checklist and produce the first round of knowledge. Keep to the
material listed here; ask me before bringing in anything else.
1. Check every link opens; register the rows marked as a dependency as sources,
   pinning repositories to the current commit and recording Skill versions. List
   anything you cannot open or are not allowed to read
2. Ask me about missing links, missing owners or unclear ownership; where someone
   else has to confirm, reach the owner named on the row
3. Once you have read the sources, plan the directory against the structure kept
   above; raise a better split with me first if you see one
4. Write in batches only after I confirm the directory, and keep every claim
   traceable to its source
5. When writing is done, produce a diff report for my review; publish only after
   it passes
```
