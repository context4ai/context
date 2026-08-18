# Changelog

All notable changes to Context are documented here.

## Unreleased

## 0.6.5 - 2026-08-18

- Made Git-derived asset URLs part of package freshness so a changed commit or remote cannot leave a previously built package incorrectly ready.
- Made mixed-manifest repository extraction plugin-owned, allowing TypeScript and Go extractors to receive their declared manifest without a global language guess.
- Kept project-defined extraction code behind the managed subprocess boundary while retaining in-process execution for built-in deterministic phases.
- Clarified the Git requirements for commit-templated raw asset URLs in SDK and workflow reference documentation.

## 0.6.4 - 2026-08-18

- Added optional Go and Rush structural extractors, including a portable WASM Go parser, plus a route-selected technology inspection step that chooses built-in parsers or a project-owned custom adapter from repository facts.
- Upgraded the embedded Agent Graph runtime to 0.2.5 and isolated managed in-process actions with deterministic resource cleanup.
- Added configurable package asset delivery through bundled files, optional workspace processors, explicit Git raw URLs, or intentional omission with diagnostics.
- Improved prose structure validation, multi-source Review recovery, compact receipts, debug traces, and deterministic status routing for long-running knowledge workflows.
- Published the Go and Rush extractors as independent community packages without making them mandatory Context CLI runtime dependencies.

## 0.6.3 - 2026-08-17

- Upgraded the embedded Agent Graph runtime to 0.2.4.
- Added reproducible CI for Node.js 20 and 24 with the complete Context end-to-end gate.
- Added release-driven, OIDC-based npm publishing for the five public Context packages.
- Added deterministic release preparation and npm package auditing based on the existing dist packaging contract.
- Removed an unused native Tree-sitter development dependency so clean Linux installs use the shipped WASM runtime on every supported Node.js version.
- Added community contribution, support, security, issue, pull-request, dependency-update, and release-note configuration.
