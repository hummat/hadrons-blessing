#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBSITE_DIR="$ROOT_DIR/website"
PORT="${HB_WEBSITE_PORT:-4173}"
HOST="${HB_WEBSITE_HOST:-127.0.0.1}"
SESSION="${PLAYWRIGHT_CLI_SESSION:-hb-website}"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
PWCLI="$CODEX_HOME_DIR/skills/playwright/scripts/playwright_cli.sh"
BASE_URL="http://$HOST:$PORT"

usage() {
  cat <<'EOF'
Usage:
  scripts/website-smoke.sh serve
  scripts/website-smoke.sh open [path]
  scripts/website-smoke.sh open-compare <build-a-slug> <build-b-slug>
  scripts/website-smoke.sh snapshot
  scripts/website-smoke.sh screenshot
  scripts/website-smoke.sh close

Environment:
  HB_WEBSITE_HOST         Preview host (default: 127.0.0.1)
  HB_WEBSITE_PORT         Preview port (default: 4173)
  PLAYWRIGHT_CLI_SESSION  Named Playwright CLI session (default: hb-website)

Notes:
  - Run `serve` in one terminal.
  - Run browser commands in another terminal.
  - Browser launch and local port binding may require sandbox escape under Codex.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_pwcli() {
  if [ ! -f "$PWCLI" ]; then
    echo "Playwright wrapper not found: $PWCLI" >&2
    exit 1
  fi
  if [ ! -x "$PWCLI" ]; then
    echo "Playwright wrapper is not executable: $PWCLI" >&2
    echo "Fix: chmod +x \"$PWCLI\"" >&2
    exit 1
  fi
  require_cmd npx
}

run_pwcli() {
  require_pwcli
  PLAYWRIGHT_CLI_SESSION="$SESSION" "$PWCLI" "$@"
}

wait_for_server() {
  require_cmd curl
  local attempts=0
  until curl --silent --fail --max-time 2 "$BASE_URL/" >/dev/null 2>&1; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      echo "Preview server not reachable at $BASE_URL after 30 attempts" >&2
      exit 1
    fi
    sleep 1
  done
}

command_name="${1:-}"
if [ -z "$command_name" ]; then
  usage
  exit 1
fi
shift || true

case "$command_name" in
  serve)
    cd "$WEBSITE_DIR"
    exec npm run preview -- --host "$HOST" --port "$PORT"
    ;;
  open)
    wait_for_server
    path="${1:-/}"
    if [[ "$path" != /* ]]; then
      path="/$path"
    fi
    run_pwcli open "$BASE_URL$path"
    ;;
  open-compare)
    if [ "$#" -ne 2 ]; then
      echo "open-compare requires 2 build slugs" >&2
      usage
      exit 1
    fi
    wait_for_server
    run_pwcli open "$BASE_URL/compare?builds=$1,$2"
    ;;
  snapshot)
    run_pwcli snapshot
    ;;
  screenshot)
    run_pwcli screenshot "$@"
    ;;
  close)
    run_pwcli close
    ;;
  *)
    echo "Unknown command: $command_name" >&2
    usage
    exit 1
    ;;
esac
