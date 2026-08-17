#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

find_bun() {
  if [[ -x "/opt/homebrew/bin/bun" ]]; then
    echo "/opt/homebrew/bin/bun"
    return 0
  fi
  if [[ -x "${HOME}/.cargo/bin/bun" ]]; then
    echo "${HOME}/.cargo/bin/bun"
    return 0
  fi
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi
  return 1
}

BUN_BIN=""
if ! BUN_BIN="$(find_bun)"; then
  echo "bun not found. Please install Bun first." >&2
  exit 1
fi

cd "${ROOT_DIR}"

if [[ ! -d "node_modules" ]]; then
  "${BUN_BIN}" install
fi

COMMAND="${1:-}"

case "${COMMAND}" in
  "")
    "${BUN_BIN}" run --cwd packages/dev-cli src/index.tsx
    ;;
  context|cli)
    shift
    "${BUN_BIN}" run --cwd packages/context-cli src/cli.ts "$@"
    ;;
  build|typecheck|test|lint|verify|verify:fast|verify:full)
    "${BUN_BIN}" run "${COMMAND}"
    ;;
  link|unlink|bump|bump-version|publish)
    if [[ "${COMMAND}" == "link" || "${COMMAND}" == "unlink" ]]; then
      if [[ ! -t 0 ]]; then
        export C4A_ASSUME_YES=1
      fi
    fi
    "${BUN_BIN}" run --cwd packages/dev-cli src/index.tsx "$@"
    ;;
  *)
    echo "Unknown command: ${COMMAND}" >&2
    echo "Usage: ./start.sh [context|cli|build|typecheck|test|lint|verify|link|unlink|bump|publish]" >&2
    exit 1
    ;;
esac
