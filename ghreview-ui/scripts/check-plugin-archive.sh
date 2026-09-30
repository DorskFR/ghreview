#!/usr/bin/env bash
# The installer takes the plugin files at the archive root, or under a single
# folder whose name equals the manifest id. A folder named anything else — the
# generic `plugin/` this build once wrote — is refused with
# "plugin id `x` does not match its folder `y`" *at install*, which no build or
# test noticed. This is the tripwire.
set -euo pipefail

fail() { echo "::error::$*" >&2; exit 1; }

tgz="${1:?usage: check-plugin-archive.sh <archive.tgz>}"
[ -f "$tgz" ] || fail "archive not found: $tgz"

members="$(tar tzf "$tgz")"
[ -n "$members" ] || fail "$tgz is empty"

# First path segment of every member; "./" wrappers are not a folder.
roots="$(printf '%s\n' "$members" | sed 's|^\./||' | cut -d/ -f1 | grep -v '^$' | sort -u)"
count="$(printf '%s\n' "$roots" | wc -l | tr -d ' ')"

if printf '%s\n' "$members" | sed 's|^\./||' | grep -qx 'plugin.json'; then
  echo "OK: plugin.json sits at the archive root"
  exit 0
fi

[ "$count" -eq 1 ] || fail "$tgz has $count top-level entries ($(echo $roots | tr '\n' ' ')); the installer accepts the files at the root or under exactly one folder"

folder="$roots"
printf '%s\n' "$members" | sed 's|^\./||' | grep -qx "$folder/plugin.json" ||
  fail "$tgz has no $folder/plugin.json"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Extract everything: a `./`-prefixed archive has no member literally named
# "$folder/plugin.json" to single out.
tar xzf "$tgz" -C "$tmp"
id="$(node -p "require('$tmp/$folder/plugin.json').id")"

[ "$id" = "$folder" ] ||
  fail "plugin id \`$id\` does not match its folder \`$folder\` — the installer refuses this archive"

printf '%s\n' "$members" | sed 's|^\./||' | grep -qx "$folder/web/index.js" ||
  fail "$tgz has no $folder/web/index.js"

echo "OK: $tgz unpacks to $folder/ matching plugin id $id"
