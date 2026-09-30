#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/check-plugin-archive.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# An archive laid out like $1, with a manifest whose id is $2.
make_tgz() {
  local name="$1" folder="$2" id="$3" stage="$tmp/stage-$1"
  rm -rf "$stage"
  local base="$stage"
  [ "$folder" = "." ] || base="$stage/$folder"
  mkdir -p "$base/web"
  printf '{ "id": "%s", "web": "web" }\n' "$id" > "$base/plugin.json"
  echo 'export default {}' > "$base/web/index.js"
  ( cd "$stage" && tar czf "$tmp/$name.tgz" . )
  echo "$tmp/$name.tgz"
}

failures=0
expect() {
  local want="$1" name="$2"; shift 2
  local out status
  set +e
  out="$("$@" 2>&1)"; status=$?
  set -e
  if [ "$status" -eq "$want" ]; then
    echo "ok   — $name"
  else
    echo "FAIL — $name (exit $status, expected $want)"
    echo "$out" | sed 's/^/       /'
    failures=$((failures + 1))
  fi
}

expect 0 "a folder matching the id passes" \
  bash "$script" "$(make_tgz good ghreview ghreview)"
expect 0 "files at the archive root pass" \
  bash "$script" "$(make_tgz rooted . ghreview)"
expect 1 "the generic plugin/ folder fails" \
  bash "$script" "$(make_tgz generic plugin ghreview)"
expect 1 "a folder that is not the id fails" \
  bash "$script" "$(make_tgz mismatch other other-x)"
expect 1 "a missing archive fails" bash "$script" "$tmp/nope.tgz"

mkdir -p "$tmp/stage-two/a" "$tmp/stage-two/b"
printf '{ "id": "a" }\n' > "$tmp/stage-two/a/plugin.json"
( cd "$tmp/stage-two" && tar czf "$tmp/two.tgz" a b )
expect 1 "two top-level folders fail" bash "$script" "$tmp/two.tgz"

# The real build's own archive, when one has been built.
real="$(ls "$here/../dist"/*.tgz 2>/dev/null | head -1 || true)"
if [ -n "$real" ]; then
  expect 0 "the built archive passes" bash "$script" "$real"
fi

[ "$failures" -eq 0 ] || exit 1
echo "all plugin-archive cases passed"
