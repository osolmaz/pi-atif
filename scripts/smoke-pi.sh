#!/usr/bin/env bash
set -euo pipefail

TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT
mkdir -p "$TEMP_ROOT/home" "$TEMP_ROOT/install" "$TEMP_ROOT/project"
TARBALL="$(npm pack --silent --pack-destination "$TEMP_ROOT")"
npm install --silent --prefix "$TEMP_ROOT/install" "$TEMP_ROOT/$TARBALL"
PACKAGE_ROOT="$TEMP_ROOT/install/node_modules/pi-atif"

test -f "$PACKAGE_ROOT/dist/extension.js"
test -x "$PACKAGE_ROOT/dist/cli.js"
node "$PACKAGE_ROOT/dist/cli.js" --help >/dev/null
printf '%s\n' '{"id":"smoke","type":"get_session_stats"}' \
  | HOME="$TEMP_ROOT/home" timeout 10s pi -e "$PACKAGE_ROOT" --mode rpc --no-session \
  | grep -F '"success":true' >/dev/null
(
  cd "$TEMP_ROOT/project"
  HOME="$TEMP_ROOT/home" pi install -l "$PACKAGE_ROOT" >/dev/null
  HOME="$TEMP_ROOT/home" pi list --approve | grep -F "pi-atif" >/dev/null
)

echo "Packed package and Pi package discovery passed"
