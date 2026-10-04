# Local plugin installation options

Use only for an authorized local installation after the entry's missing-CLI
recovery. Run the plugin installation command shown in the entry with these
options.

`--local <path>` requires explicit `--agent`:

- `claude`, `cursor`, `codex`: path is the repository root; install into its
  `.claude`, `.cursor`, `.agents` directory respectively, without host detection.
- `all`: install all three host layouts.
- `auto-detect`: select existing host directories in that repository only,
  never PATH or desktop applications; if none exist, use `.agents/skills`.
- `standalone`: write all skills directly to `<path>/skills`, without commands.

All combinations support `--dry-run`. Bare `--local` is rejected. Older explicit
host installs took a host directory; now pass the repository root to avoid
nesting. Check CLI help for support before using these options on older versions.
Local entries have no plugin namespace and do not change global configuration.
Preserve customized files on conflict; refresh the host after installation.
Existing usable entries need no reinstall. Global installation is unchanged.
