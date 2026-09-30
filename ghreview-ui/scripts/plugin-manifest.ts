#!/usr/bin/env bun
/**
 * The installer's manifest rules, mirrored from cctui's `validate_manifest` in
 * `crates/cctui-server/src/plugins.rs`. Two installs were refused by rules this
 * build never checked — the archive folder, then `web` naming a directory
 * instead of the module file — so the build now fails on anything the installer
 * would reject.
 *
 * `exists` answers whether a relative path is a *file* of the plugin, exactly as
 * the server's `PluginFiles::exists` does: a directory is not a file, which is
 * what `"web": "web"` got wrong.
 *
 * Keep the error strings close to the server's; they are what shows up in a 400.
 */

const CCTUI_API = 1;
const MAX_ID_LEN = 40;
const MAX_SETTINGS = 32;

const RESERVED_EXACT = ["SESSION_ID", "REPLY_URL", "BASH_ENV", "ENV", "PATH"];
const RESERVED_PREFIXES = ["CCTUI_", "TASK_", "LD_", "DYLD_"];
const PLUGIN_DENIED_EXACT = ["HOME", "SHELL", "USER", "NODE_OPTIONS", "TMPDIR", "XDG_CONFIG_HOME"];
const PLUGIN_DENIED_PREFIXES = ["ANTHROPIC_", "CLAUDE_", "OPENAI_", "FIREWORKS_", "CODEX_"];

export function validId(id: unknown): boolean {
  return (
    typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LEN && /^[a-z0-9-]+$/.test(id)
  );
}

/** A relative path of plain components: no root, no `..`, no `.`, no hidden segment. */
export function safeRelative(path: unknown): boolean {
  if (typeof path !== "string" || path === "" || path.includes("\\") || path.includes("\0")) {
    return false;
  }
  const segments = path.split("/");
  return segments.every((s) => s !== "" && !s.startsWith("."));
}

function validSettingKey(key: unknown): boolean {
  return typeof key === "string" && key.length <= 40 && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key);
}

function reservedEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  return (
    RESERVED_EXACT.includes(upper) ||
    RESERVED_PREFIXES.some((p) => upper.startsWith(p)) ||
    upper.endsWith("_PROXY")
  );
}

export function validPluginEnvName(name: unknown): boolean {
  if (typeof name !== "string" || name.length > 64 || !/^[A-Z][A-Z0-9_]*$/.test(name)) return false;
  return (
    !reservedEnvName(name) &&
    !PLUGIN_DENIED_EXACT.includes(name) &&
    !PLUGIN_DENIED_PREFIXES.some((p) => name.startsWith(p))
  );
}

interface Manifest {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  cctuiApi?: unknown;
  web?: unknown;
  page?: { title?: unknown } | null;
  styles?: unknown;
  skills?: unknown;
  settings?: unknown;
  instanceSettings?: unknown;
  backend?: { upstreamSetting?: unknown } | null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Every reason the installer would refuse this manifest, in the server's order. */
export function validateManifest(
  manifest: Manifest,
  folder: string,
  exists: (rel: string) => boolean,
): string[] {
  const id = typeof manifest.id === "string" ? manifest.id : "";
  if (!validId(manifest.id)) return [`plugin id \`${id}\` must match [a-z0-9-]{1,40}`];
  if (id !== folder) return [`plugin id \`${id}\` does not match its folder \`${folder}\``];
  if (manifest.cctuiApi !== CCTUI_API) {
    return [`plugin \`${id}\` targets cctuiApi ${String(manifest.cctuiApi)}, the server speaks 1`];
  }
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") {
    return [`plugin \`${id}\`: \`name\` is empty`];
  }
  if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
    return [`plugin \`${id}\`: \`version\` is empty`];
  }

  const errors: string[] = [];
  const bad = (why: string) => errors.push(`plugin \`${id}\`: ${why}`);

  if (manifest.web !== undefined && manifest.web !== null) {
    if (!safeRelative(manifest.web)) {
      bad(`path \`${String(manifest.web)}\` must be relative and stay inside the plugin folder`);
    } else if (!exists(manifest.web as string)) {
      // A directory is not a file: this is the `"web": "web"` failure.
      bad(`\`${String(manifest.web)}\` does not exist`);
    }
  } else if (manifest.page) {
    bad("declares a `page` but no `web` module to export it from");
  }
  if (manifest.page && String(record(manifest.page).title ?? "").trim() === "") {
    bad("`page.title` is empty");
  }

  for (const style of asArray(manifest.styles)) {
    if (!safeRelative(style)) {
      bad(`path \`${String(style)}\` must be relative and stay inside the plugin folder`);
    } else if (!exists(style as string)) {
      bad(`\`${String(style)}\` does not exist`);
    }
  }

  for (const skill of asArray(manifest.skills)) {
    if (!safeRelative(skill) || String(skill).includes("/")) {
      bad(`path \`${String(skill)}\` must be relative and stay inside the plugin folder`);
    } else if (!exists(`skills/${String(skill)}/SKILL.md`)) {
      bad(`\`skills/${String(skill)}/SKILL.md\` does not exist`);
    }
  }

  const settings = asArray(manifest.settings);
  if (settings.length > MAX_SETTINGS) bad("too many settings");
  const keys = new Set<string>();
  const envs = new Set<string>();
  for (const raw of settings) {
    const s = record(raw);
    const key = String(s.key ?? "");
    const badSetting = (why: string) => bad(`setting \`${key}\` is invalid: ${why}`);
    if (!validSettingKey(s.key)) badSetting("key must match [a-zA-Z][a-zA-Z0-9_-]{0,39}");
    else if (String(s.label ?? "").trim() === "") badSetting("label is empty");
    else if (s.type !== "string") badSetting('type must be "string"');
    else if (!validPluginEnvName(s.env)) {
      badSetting("env must match ^[A-Z][A-Z0-9_]{0,63}$ and not be reserved");
    } else if (keys.has(key) || envs.has(String(s.env))) badSetting("duplicate key or env");
    keys.add(key);
    envs.add(String(s.env));
  }

  const instance = asArray(manifest.instanceSettings);
  if (instance.length > MAX_SETTINGS) bad("too many instanceSettings");
  const instanceKeys = new Set<string>();
  for (const raw of instance) {
    const s = record(raw);
    const key = String(s.key ?? "");
    const badSetting = (why: string) => bad(`instance setting \`${key}\` is invalid: ${why}`);
    if (!validSettingKey(s.key)) badSetting("key must match [a-zA-Z][a-zA-Z0-9_-]{0,39}");
    else if (String(s.label ?? "").trim() === "") badSetting("label is empty");
    else if (s.type !== "string" && s.type !== "url") badSetting('type must be "string" or "url"');
    else if (instanceKeys.has(key)) badSetting("duplicate key");
    instanceKeys.add(key);
  }

  if (manifest.backend) {
    const wanted = String(record(manifest.backend).upstreamSetting ?? "");
    const declared = instance.map(record).find((s) => String(s.key ?? "") === wanted);
    if (!declared) bad("backend is invalid: upstreamSetting names no instanceSettings entry");
    else if (declared.type !== "url") {
      bad('backend is invalid: upstreamSetting must be an instance setting of type "url"');
    } else if (declared.secret === true) {
      bad("backend is invalid: upstreamSetting must not be secret");
    }
  }

  return errors;
}

if (import.meta.main) {
  const [dir, folder] = process.argv.slice(2);
  if (!dir) {
    console.error("usage: plugin-manifest.ts <plugin-dir> [folder]");
    process.exit(2);
  }
  const { readFile } = await import("node:fs/promises");
  const { statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const manifest = JSON.parse(await readFile(join(dir, "plugin.json"), "utf8")) as Manifest;
  const isFile = (rel: string): boolean => {
    try {
      return statSync(join(dir, rel)).isFile();
    } catch {
      return false;
    }
  };
  const errors = validateManifest(manifest, folder ?? String(manifest.id ?? ""), isFile);
  for (const e of errors) console.error(`::error::${e}`);
  if (errors.length > 0) process.exit(1);
  console.log(`OK: plugin.json satisfies the installer's manifest rules`);
}
