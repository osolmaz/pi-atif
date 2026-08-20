#!/usr/bin/env bash
set -euo pipefail

HARBOR_COMMIT=c3ce0c60bbd2fd1888b327efcc880dbd86d8b7cf
PYDANTIC_VERSION=2.12.5
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT

if [[ -n "${HARBOR_SOURCE:-}" ]]; then
  HARBOR_ROOT="$HARBOR_SOURCE"
else
  HARBOR_ROOT="$TEMP_ROOT/harbor-$HARBOR_COMMIT"
  git init --quiet "$HARBOR_ROOT"
  git -C "$HARBOR_ROOT" remote add origin https://github.com/harbor-framework/harbor.git
  git -C "$HARBOR_ROOT" fetch --quiet --depth 1 origin "$HARBOR_COMMIT"
  git -C "$HARBOR_ROOT" checkout --quiet FETCH_HEAD
fi

python3 -m venv "$TEMP_ROOT/venv"
"$TEMP_ROOT/venv/bin/python" -m pip install --quiet "pydantic==$PYDANTIC_VERSION"
"$TEMP_ROOT/venv/bin/python" -m pip install --quiet --no-deps "$HARBOR_ROOT"
mapfile -t TRAJECTORIES < <(find fixtures/golden -maxdepth 1 -type f -name '*.json' -print | sort)
"$TEMP_ROOT/venv/bin/python" scripts/validate-harbor.py "$HARBOR_ROOT" "${TRAJECTORIES[@]}"
