#!/usr/bin/env bun
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The installer accepts an archive whose files sit at the root or under a single
// folder named exactly like the manifest id — anything else is refused at
// install, so the id names the folder, the tar member and the manifest alike.
// Keep vite.plugin.config.ts's outDir in step.
const PLUGIN_ID = "ghreview";
const distDir = join(root, "dist", PLUGIN_ID);
const skillsDir = join(root, "skills");

// The server refuses an archive above this, so a bundle that outgrows it is a
// build failure here rather than an install failure on someone's instance.
const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;

interface PluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  cctuiApi: 1;
  icon: string;
  web: string;
  page: { title: string; icon?: string };
  backend: { upstreamSetting: string };
  styles?: string[];
  instanceSettings: { key: string; label: string; type: "string" | "url"; secret?: boolean }[];
  settings?: { key: string; label: string; env: string; type: "string" | "url" }[];
  hostToken?: { env: string };
  skills?: string[];
}

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { cwd: root, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}`);
}

async function exists(path: string): Promise<boolean> {
  return await Bun.file(path).exists();
}

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version: string };
const version = process.env.GHREVIEW_VERSION ?? pkg.version;

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

await run(["bunx", "vite", "build", "--config", "vite.plugin.config.ts"]);

// `web` must name the ES module file itself — the installer asks whether the
// path is a *file*, and a folder ("web") is refused with "`web` does not exist".
const WEB_MODULE = "web/index.js";
const WEB_STYLESHEET = "web/index.css";

const bundle = join(distDir, WEB_MODULE);
if (!(await exists(bundle))) throw new Error(`vite produced no bundle at ${bundle}`);

// The page is unreadable without the token/diff/markdown sheets, so a build that
// lost them is a failure rather than a silently unstyled install.
const stylesheet = join(distDir, WEB_STYLESHEET);
if (!(await exists(stylesheet))) throw new Error(`vite produced no stylesheet at ${stylesheet}`);

const hasSkill = await exists(join(skillsDir, "gh-review", "SKILL.md"));
if (hasSkill) {
  await mkdir(join(distDir, "skills"), { recursive: true });
  await run(["cp", "-R", join(skillsDir, "gh-review"), join(distDir, "skills", "gh-review")]);
}

const manifest: PluginManifest = {
  id: PLUGIN_ID,
  name: "GitHub",
  description:
    "GitHub review centre: pull requests, diffs, inline review drafts and the notification inbox, served by a separately deployed ghreview backend.",
  version,
  cctuiApi: 1,
  icon: "pull-request",
  web: WEB_MODULE,
  page: { title: "GitHub", icon: "pull-request" },
  backend: { upstreamSetting: "backendUrl" },
  styles: [WEB_STYLESHEET],
  // `backend.upstreamSetting` must name a declared, non-secret `url` setting or
  // the server refuses the manifest. The proxy signing secret is minted and
  // sealed server-side on install; it is never an instance setting.
  instanceSettings: [{ key: "backendUrl", label: "Backend URL", type: "url" }],
  // A session has no cctui credential of its own. `hostToken` has the host mint
  // the user one on enable and revoke it on disable, so nobody is asked to paste
  // a cctui token into cctui.
  ...(hasSkill
    ? { hostToken: { env: "GHREVIEW_CCTUI_TOKEN" }, skills: ["gh-review"] }
    : {}),
};

await writeFile(join(distDir, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const tgz = join(root, "dist", `${PLUGIN_ID}-${version}.tgz`);
await rm(tgz, { force: true });
await run(["tar", "czf", tgz, "-C", join(root, "dist"), PLUGIN_ID]);
await run(["bash", join(root, "scripts", "check-plugin-archive.sh"), tgz]);

const size = Bun.file(tgz).size;
console.log(`plugin.json + web/index.js -> ${tgz} (${(size / 1024).toFixed(1)} KiB)`);
if (size > MAX_ARCHIVE_BYTES) {
  throw new Error(
    `${tgz} is ${(size / 1024 / 1024).toFixed(2)} MB, over the server's 5 MB archive limit`,
  );
}
