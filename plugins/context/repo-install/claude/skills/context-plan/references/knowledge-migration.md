# Bring existing knowledge collections into a workspace

Use when the project covers knowledge that someone already curated: knowledge
or wiki repositories (including LLM-maintained wikis), documentation
directories, another Context workspace, or published knowledge packages.
This is research guidance for the PLAN; registration and production still
follow the `context` Skill after approval.

## Identify each collection's kind

Inspect the structure before reading bodies. Typical kinds and their signals:

| Kind | Signals | Where its value is |
| --- | --- | --- |
| Mirror plus summary | A raw or mirror directory of copied documents with source metadata (original link, revision), plus a small set of summary pages | The original documents behind it; the summary layer is secondary |
| Raw archive | Hundreds or thousands of copied documents or code snapshots, a source list, few distilled pages | Coverage of the originals; needs scoping and batches |
| Code-curated wiki | Pages written from source code, often with evidence tables naming files, symbols and a code revision | The code it cites; the pages show which questions matter |
| Maintained first-hand wiki | Organized pages, frequent recent commits by a team, often its own skills, checks or evaluations | The pages themselves; the team keeps them current |
| Published package or skill | A versioned knowledge package or skill from a registry | Its versioned content; follows its publisher's releases |

A collection can contain several kinds; classify parts separately when they
need different treatment. Record commit activity, owners and last update, since
they decide whether the collection is still maintained.

## Trace the real upstreams

For each collection, list the documents, repositories and other sources its
pages were built from, using source metadata, source lists, frontmatter, links
and evidence tables. Deduplicate by actual identity and compare with the
workspace's registered sources. Record how many are already registered, how
many are new and stable, and how many are research notes, duplicates, archives
or empty pages. Report unreadable upstreams as access gaps, not as absent.

Estimate what is unique to the collection after removing content that the
existing articles and the traced upstreams already cover: the collection
author's own judgments, operating procedures, tables or examples that exist
nowhere else.

## Compare with the existing knowledge

Apply the coverage map in [project-planning.md](project-planning.md). For each
collection also produce:

- **Impact on navigation**: a pruned tree of the existing navigation showing
  which existing articles would be revised, which articles would be added and
  which new subsections are needed. Respect structural constraints from the
  intake, such as keeping the top-level sections; place new topics inside the
  existing sections where readers already look for them.
- **Conflicts**: statements that disagree with existing articles or with code,
  with both sides quoted briefly. Existing articles can be wrong too.

## Choose an integration approach

| Approach | What happens | Content rewritten | Errors correctable from code | Original afterwards |
| --- | --- | --- | --- | --- |
| Standard production | Produce articles from the collection's own knowledge: register the collection as a document source (a file source keeping its folders, following its repository version as an origin), or the code its evidence cites (a code-curated wiki then guides which questions to answer) | Yes | Yes | Can be archived once the workspace maintains the topic |
| Register original upstream | Replace a mirror or summary layer with the original documents it copied; keep only the author's unique judgments as notes | Yes, from the originals | Yes | The summary layer can stop being maintained |
| Keep unchanged | Keep the collection's pages as they are, placed in the existing sections and selected into a package | No | Only flag when cited code changes | Maintained where it is |
| In-repository knowledge | Leave the collection in its repository for agents working there; not part of the workspace | No | No | Maintained where it is |
| Mechanical packaging | Package the collection's files unchanged with a script, outside the workspace | No | No | Maintained where it is |
| External package source | Install a published package or skill at an exact version and register it as a file source with that origin | Yes | Yes, with code sources | Follows the publisher |

Choose per collection, or per part of a collection, using the intake answers:
where the knowledge really comes from, whether its team keeps maintaining it,
what must stay unchanged, and how much it overlaps existing articles. Score each
plausible approach for each collection on a 1–5 fit scale against those intake
criteria (5 fits best), and show feasibility, effort (for example agent days and
review time) and risk next to the score. Explain the choice together with its
benefit and its cost. Approaches can be combined, for example registering the
upstream of a raw archive while keeping a few distilled pages unchanged.

Check what the installed Context actually supports before recommending an
approach. Approaches the installation cannot perform yet are recorded as options
with their limitation, not presented as ready. In particular:

- A repository source currently has one subpath and no exclusion rules, and
  repository sources are processed as code. A repository that contains only
  Markdown does not enter document production when registered as a repository.
  Register it as a file source that keeps its folders, with the repository and
  commit as its origin, so routine updates follow new commits; or register its
  original upstream instead when it mirrors or summarizes other documents.
- A file source commits its captured snapshot (documents and the images they
  link), so a very large collection grows the workspace repository; select the
  folders articles need with include rules. Installed origin content itself is
  not committed.
- Package-only content is available: bind the articles under a hidden knowledge
  map category so they stay out of website navigation, select them into their
  package, and link them from an entry article on the main site. Add the paths to
  the website package's `select.exclude` to leave the pages off the website.
- Keeping pages unchanged without production needs support that may be
  unavailable. Until then, keep them unchanged through production: register the
  collection as a file source that keeps its folders (with its repository and
  commit as origin when it keeps changing), state in the requirement that each
  page is reproduced as written, cite each section's original lines, and add
  code citations where a page describes code so code changes reach it. Each
  page then goes through ordinary batches and review; estimate that cost.- Keeping pages unchanged goes through production with `preserve_original: true`
  on the requirement: register the collection as a file source that keeps its
  folders (with its repository and commit as origin when it keeps changing).
  Writers keep each page's title, sections, order and wording, cite its lines and
  the code it describes, and record contradictions with the code as proposals
  the user accepts (also proposing the fix upstream), keeps only locally, or
  rejects to keep the original. Managed and routine runs revise locally. Each
  page still goes through ordinary batches and review; estimate that cost.

When the user chooses an approach the installation cannot perform yet, keep the
choice, mark the affected stage as blocked by that capability, propose an interim
approach that can run now (for example mechanical packaging outside the workspace),
and record the capability dependency in the PLAN.

## Scale and stage limits for collections

Count documents by their upstream identity: mirrored copies inside a collection
are the same documents as their originals, not additional sources. Apply the
planning scope rules to the distinct upstream documents in this task's scope; a
large mirror can trigger the human scope question, which may be asked early with
the evidence already available. The one-new-repository-per-stage limit applies to
code repositories investigated for production; a collection kept unchanged or
bypassed in favor of its upstream does not count as a new repository.

## Prepare content that is kept unchanged or packaged mechanically

Content that will not be rewritten needs a readiness check before it is selected
into a package: every page reachable from its index, relative links resolving,
images and attachments actually present (not placeholders or remote-only files),
no template or placeholder rows in its source lists, and no credentials or private
data in logs and build files. Report findings to the owning team instead of
editing their pages.

## Skills and tools inside collections

Collections may carry their own skills, agents or scripts. Do not package them as
knowledge. Recommend publishing them through the host's skill distribution, and
assess separately any that write data or call production systems.

## Earlier integrations

Check whether the workspace already absorbed an earlier version of a collection,
for example as notes or articles from a previous project. Record what will
supersede those notes and which articles they support, so earlier material is not
duplicated or left contradicting the new sources.

## Following an upstream or absorbing once

| Mode | What to do | Afterwards |
| --- | --- | --- |
| Follow the upstream | Register the collection, its modules or its originals as sources with fixed versions; a versioned collection or package becomes a file source with an origin | Routine updates follow the upstream; the original team keeps maintaining it |
| Absorb once | Bring the material in one time — original files as a file source keeping its folders, the author's judgments as notes — and produce articles from it; freeze the file source when the original is archived | The original can be archived; maintenance moves to the workspace |

Notes carry summaries and supplements: decisions, procedures, comparisons or
explanations that exist nowhere else. Do not copy whole summary pages into notes
when their originals can be registered.

## Packages and navigation

Navigation and package scope are independent. A package selects approved
articles by path patterns or explicit lists, so a new package does not need its
own top-level section. Explicit lists are normal in an existing workspace whose
paths are organized by article type; path conventions help mainly for new
subdirectories, where package selection can then follow new articles
automatically.

When the project produces separate packages, list each package's articles
individually with their navigation location and status (added, revised, kept
unchanged, unchanged). Include existing unchanged articles from the navigation
subtrees the package covers and the articles its new or revised articles link to;
a large unchanged module may be listed as one row with its page count.
Content that should appear only in a package, not in website navigation, goes
under a hidden knowledge map category.

State the basis of every overlap figure (pages or characters) and use the same
basis across collections where possible.
