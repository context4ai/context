# Optional project document outlines

Reuse existing documentation first. Write originals beside the project in `docs/`
or its existing README, never inside the `repo-content/` view. Use the user's language.
Only include confirmed facts and commands; incomplete scaffolds are not registered.
Missing recommended documents do not block onboarding or build.

| Document | Useful outline |
| --- | --- |
| `README.md` or `docs/README.md` | Project scope, document entrances organized by reader task, a link to the authored Skills directory, and maintenance conventions. Do not hand-maintain a Skills list: the repository content page derives it from `SKILL.md`. |
| `docs/development.md` | Environment prerequisites, startup steps, verification commands, debugging, and contribution conventions. |
| `docs/architecture.md` | Module responsibilities, important interactions, external dependencies, and design constraints. |

Add feature/spec, API, deployment, troubleshooting or design-decision documents only
when the task needs them. Feature/spec remains documentation, not a separate content system.
Repeatable operational procedures may become authored Skills. Skills can reference
docs without copying their contents; keep executable resources with their Skill.
