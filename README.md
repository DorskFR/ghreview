# ghreview

A GitHub review centre that installs into [cctui](https://github.com/DorskFR/cctui)
as a plugin: pull requests, diffs, inline review drafts and the notification inbox,
all served from a warm local mirror instead of live GitHub round trips.

Two pieces:

| directory | what it is |
| --- | --- |
| `ghreview/` | the backend — a Bun + Hono service exposing a versioned `/v1` HTTP + SSE contract, with a GitHub sync daemon and a Postgres JSONB document store. Ships as `ghcr.io/dorskfr/ghreview`. |
| `ghreview-ui/` | the frontend — a Svelte 5 app packaged as a cctui plugin (`ghreview-<ver>.tgz`), and runnable standalone for development. |

Each has its own README with the details; this file covers installing and running the pair.

## Install as a cctui plugin

The plugin archive is attached to every [release](../../releases) as
`ghreview-<ver>.tgz`, and the backend image is published as
`ghcr.io/dorskfr/ghreview:<ver>` for the same version.

### 1. Deploy the backend

```sh
docker run -p 8790:8790 \
  -e DATABASE_URL=postgres://…            # its own database; no cctui schema access needed
  -e GHREVIEW_SEAL_KEY=…                  # seals stored GitHub PATs
  -e GHREVIEW_AUTH_MODE=proxy \
  -e GHREVIEW_PROXY_SECRET=…              # from the install response, see below
  ghcr.io/dorskfr/ghreview:<ver>
```

`GHREVIEW_AUTH_MODE=proxy` is the deployed mode: the backend trusts no bearer
tokens and instead verifies the HMAC-signed `X-Cctui-*` identity headers that the
cctui plugin proxy adds, rejecting stale timestamps
(`GHREVIEW_PROXY_MAX_SKEW_SECONDS`, default 300). The caller's user id comes from
those headers. `GHREVIEW_AUTH_MODE=static` (shared tokens) and `none`
(loopback-only, requires `GHREVIEW_UNSAFE_ALLOW_ANONYMOUS=true`) exist for
development and tests.

### 2. Install the plugin in cctui

Install `ghreview-<ver>.tgz` from **Settings › Plugins** — either from the
published catalog entry or by uploading the archive. Because the manifest declares
a `backend`, cctui mints a proxy signing secret on install and returns it **once**:
that value is the `GHREVIEW_PROXY_SECRET` above.
`POST /api/v1/admin/plugins/ghreview/proxy-secret` rotates it (also returned once).

### 3. Point the plugin at the backend

The plugin declares exactly one instance setting, `backendUrl` — its
`backend.upstreamSetting`. Set it to the backend's origin in Settings › Plugins, or:

```sh
PUT /api/v1/admin/plugins/ghreview/settings   {"values":{"backendUrl":"https://…"}}
```

The signing secret is never an instance setting. Until `backendUrl` is set — and
whenever the backend is unreachable — the page shows a single "backend not
configured or not reachable" state with the observed status and a retry, rather
than a wall of failing queries.

Browser requests then go through the host at
`/api/v1/plugins/ghreview/backend/v1/…` with cookie auth, including the SSE
stream; no bearer token ever reaches the browser.

### 4. Add a GitHub account

Add a personal access token in the plugin's own **Accounts** view. The token is
sealed with `GHREVIEW_SEAL_KEY` before storage, and the sync daemon starts
mirroring that account's repositories, pull requests and notifications.

## Development

```sh
# backend — loopback-only anonymous mode is the simplest thing to point a UI at
cd ghreview
bun install
DATABASE_URL=postgres://localhost/ghreview \
GHREVIEW_AUTH_MODE=none GHREVIEW_UNSAFE_ALLOW_ANONYMOUS=true bun run dev

# frontend — standalone vite dev server on :5290, proxying /v1 to the backend
cd ghreview-ui
bun install
GHREVIEW_URL=http://localhost:8790 bun run dev
```

Both projects use **bun** (pinned by `bun.lock`), and each exposes the same gate:

```sh
bun run check          # typecheck + lint + tests
```

The backend's OpenAPI document and typed client are generated, not written:

```sh
cd ghreview && bun run gen     # openapi.json + src/generated/api.ts
```

CI fails if the committed output does not match the generators.

### Building the plugin archive

```sh
cd ghreview-ui && bun run build:plugin
# → dist/ghreview/{plugin.json,web/,skills/} and dist/ghreview-<ver>.tgz
```

The archive's top folder is the plugin id, which is what the installer accepts
(`scripts/check-plugin-archive.sh` asserts it, with its own test cases).

The version stamped into `plugin.json` and the archive name comes from
`GHREVIEW_VERSION`, falling back to `package.json`; the release workflow sets it
from the tag so tag, manifest and filename always agree.

### Host runtime versions

Svelte and `@dorsk/tsumikit` are **external** in the plugin bundle — the host
serves them at `/plugin-runtime/*` — so `ghreview-ui` must declare exactly the
versions the host ships, not merely compatible ones. `host-runtime.json` pins
them and `scripts/check-host-deps.sh` enforces equality in CI.

## Agent skill

The plugin ships a `gh-review` skill (`ghreview-ui/skills/gh-review/`) so a cctui
session can list and read the synced pull requests it is reviewing. See
[`ghreview-ui/skills/gh-review/SKILL.md`](ghreview-ui/skills/gh-review/SKILL.md).

## License

MIT — see [LICENSE](./LICENSE).
