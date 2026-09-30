#!/usr/bin/env bash
# Every layout and manifest rule the installer enforces, each with an archive
# that breaks exactly one of them. Two of these cases are defects that shipped:
# `plugin/` as the folder, and `"web": "web"` naming the directory.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script="$here/check-plugin-archive.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# make_tgz <name> <folder|.> <manifest-json> [extra-file ...]
# Always writes web/index.js, web/index.css and skills/gh-review/SKILL.md, so a
# case only has to say what its manifest claims.
make_tgz() {
  local name="$1" folder="$2" manifest="$3"; shift 3
  local stage="$tmp/stage-$name" base
  rm -rf "$stage"
  base="$stage"
  [ "$folder" = "." ] || base="$stage/$folder"
  mkdir -p "$base/web" "$base/skills/gh-review"
  echo 'export default {}' > "$base/web/index.js"
  echo ':root{}' > "$base/web/index.css"
  echo '# skill' > "$base/skills/gh-review/SKILL.md"
  printf '%s\n' "$manifest" > "$base/plugin.json"
  for extra in "$@"; do rm -f "$base/$extra"; done
  ( cd "$stage" && tar czf "$tmp/$name.tgz" . )
  echo "$tmp/$name.tgz"
}

# A manifest that passes every rule; $1 overrides fields via a JSON fragment.
manifest() {
  cat <<JSON
{
  "id": "ghreview",
  "name": "GitHub",
  "description": "d",
  "version": "0.0.0",
  "cctuiApi": 1,
  "icon": "pull-request",
  "web": "web/index.js",
  "page": { "title": "GitHub" },
  "styles": ["web/index.css"],
  "instanceSettings": [{ "key": "backendUrl", "label": "Backend URL", "type": "url" }],
  "backend": { "upstreamSetting": "backendUrl" },
  "hostToken": { "env": "GHREVIEW_CCTUI_TOKEN" },
  "skills": ["gh-review"]
  ${1:+, $1}
}
JSON
}

# manifest_without <field> — the good manifest with one key dropped.
manifest_without() {
  manifest | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const m=JSON.parse(s); delete m[process.argv[1]];
      process.stdout.write(JSON.stringify(m,null,2));
    })' "$1"
}

# manifest_with <field> <json-value> — the good manifest with one key replaced.
manifest_with() {
  manifest | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const m=JSON.parse(s); m[process.argv[1]]=JSON.parse(process.argv[2]);
      process.stdout.write(JSON.stringify(m,null,2));
    })' "$1" "$2"
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

echo "-- archive layout"
expect 0 "a folder matching the id passes" \
  bash "$script" "$(make_tgz good ghreview "$(manifest)")"
expect 0 "files at the archive root pass" \
  bash "$script" "$(make_tgz rooted . "$(manifest)")"
expect 1 "the generic plugin/ folder fails" \
  bash "$script" "$(make_tgz generic plugin "$(manifest)")"
expect 1 "a folder that is not the id fails" \
  bash "$script" "$(make_tgz mismatch other "$(manifest)")"
expect 1 "a missing archive fails" bash "$script" "$tmp/nope.tgz"

mkdir -p "$tmp/stage-two/a" "$tmp/stage-two/b"
printf '{ "id": "a" }\n' > "$tmp/stage-two/a/plugin.json"
( cd "$tmp/stage-two" && tar czf "$tmp/two.tgz" a b )
expect 1 "two top-level folders fail" bash "$script" "$tmp/two.tgz"

echo "-- web module"
expect 1 'web naming the directory ("web") fails' \
  bash "$script" "$(make_tgz webdir ghreview "$(manifest_with web '"web"')")"
expect 1 "web pointing at a missing file fails" \
  bash "$script" "$(make_tgz webgone ghreview "$(manifest)" web/index.js)"
expect 1 "web escaping the plugin folder fails" \
  bash "$script" "$(make_tgz webescape ghreview "$(manifest_with web '"../x.js"')")"
expect 1 "an absolute web path fails" \
  bash "$script" "$(make_tgz webabs ghreview "$(manifest_with web '"/etc/passwd"')")"

echo "-- styles, skills, page"
expect 1 "a styles entry with no file fails" \
  bash "$script" "$(make_tgz stylegone ghreview "$(manifest)" web/index.css)"
expect 1 "a skills entry with no SKILL.md fails" \
  bash "$script" "$(make_tgz skillgone ghreview "$(manifest)" skills/gh-review/SKILL.md)"
expect 1 "a skills entry containing a slash fails" \
  bash "$script" "$(make_tgz skillslash ghreview "$(manifest_with skills '["skills/gh-review"]')")"
expect 1 "a page without web fails" \
  bash "$script" "$(make_tgz pagenoweb ghreview "$(manifest_without web)")"
expect 1 "an empty page title fails" \
  bash "$script" "$(make_tgz pagetitle ghreview "$(manifest_with page '{"title":"  "}')")"

echo "-- identity and api"
expect 1 "an id outside [a-z0-9-] fails" \
  bash "$script" "$(make_tgz badid ghreview "$(manifest_with id '"GhReview"')")"
expect 1 "cctuiApi 2 fails" \
  bash "$script" "$(make_tgz badapi ghreview "$(manifest_with cctuiApi '2')")"
expect 1 "an empty name fails" \
  bash "$script" "$(make_tgz badname ghreview "$(manifest_with name '" "')")"
expect 1 "an empty version fails" \
  bash "$script" "$(make_tgz badversion ghreview "$(manifest_with version '""')")"

echo "-- settings"
expect 1 "a reserved settings env fails" \
  bash "$script" "$(make_tgz badenv ghreview "$(manifest_with settings '[{"key":"apiToken","label":"T","env":"CCTUI_TOKEN","type":"string"}]')")"
expect 1 "a settings type other than string fails" \
  bash "$script" "$(make_tgz badsettingtype ghreview "$(manifest_with settings '[{"key":"apiToken","label":"T","env":"GHREVIEW_T","type":"url"}]')")"
expect 1 "a reserved hostToken env fails" \
  bash "$script" "$(make_tgz badhosttokenenv ghreview "$(manifest_with hostToken '{"env":"CCTUI_TOKEN"}')")"
expect 1 "a hostToken env colliding with a settings env fails" \
  bash "$script" "$(make_tgz hosttokencollide ghreview "$(manifest_with settings '[{"key":"tok","label":"T","env":"GHREVIEW_CCTUI_TOKEN","type":"string"}]')")"
expect 1 "duplicate instanceSettings keys fail" \
  bash "$script" "$(make_tgz dupinstance ghreview "$(manifest_with instanceSettings '[{"key":"backendUrl","label":"A","type":"url"},{"key":"backendUrl","label":"B","type":"url"}]')")"
expect 1 "a backend upstreamSetting that is not declared fails" \
  bash "$script" "$(make_tgz backendundeclared ghreview "$(manifest_with backend '{"upstreamSetting":"nope"}')")"
expect 1 "a backend upstreamSetting of type string fails" \
  bash "$script" "$(make_tgz backendstring ghreview "$(manifest_with instanceSettings '[{"key":"backendUrl","label":"B","type":"string"}]')")"
expect 1 "a secret backend upstreamSetting fails" \
  bash "$script" "$(make_tgz backendsecret ghreview "$(manifest_with instanceSettings '[{"key":"backendUrl","label":"B","type":"url","secret":true}]')")"

# The real build's own archive, when one has been built.
real="$(ls "$here/../dist"/*.tgz 2>/dev/null | head -1 || true)"
if [ -n "$real" ]; then
  echo "-- the built archive"
  expect 0 "the built archive passes" bash "$script" "$real"
fi

[ "$failures" -eq 0 ] || exit 1
echo "all plugin-archive cases passed"
