---
name: gh-review
description: Use when the user asks you to review a GitHub pull request they have open in the Review app, or to look at "my PRs", the review inbox, or a specific PR by owner/repo/number — "review PR 42", "what's waiting on me", "leave comments on this PR". Reads the pull requests, diffs and activity that the ghreview backend has already synced, and writes review draft comments the user then publishes from the UI.
---

# gh-review: review synced pull requests

The ghreview plugin mirrors the user's GitHub pull requests, diffs, notifications and
review drafts into its own backend. This skill reaches that backend through cctui, so
you read the same data the Review page shows and write into the same review draft the
user sees there.

**You never talk to GitHub.** Everything below is the local mirror.

## Reaching the backend

Every call goes through the cctui plugin proxy:

```
$CCTUI_WEB_ORIGIN/api/v1/plugins/ghreview/backend/v1/<path>
```

Authenticate with a cctui API token in `GHREVIEW_CCTUI_TOKEN`:

```sh
curl -sS -H "Authorization: Bearer $GHREVIEW_CCTUI_TOKEN" \
  "$CCTUI_WEB_ORIGIN/api/v1/plugins/ghreview/backend/v1/status"
```

`CCTUI_WEB_ORIGIN` is always set in a cctui session. `GHREVIEW_CCTUI_TOKEN` is minted
by cctui itself when the user enables this plugin — nobody pastes it anywhere — and is
revoked when they disable it. So:

- **If `GHREVIEW_CCTUI_TOKEN` is empty, stop and tell the user.** There is no
  session-scoped credential you can fall back on — the proxy takes the cctui session
  cookie or a bearer token, and a session has neither by itself. An empty value means
  the plugin is not enabled for this user, or the session predates them enabling it:
  ask them to enable **GitHub** in Settings › Plugins and start a new session.
- A `403` means the user has not enabled the plugin for themselves; `503` means no
  admin has set `backendUrl` or the backend has no proxy secret. Report which, do not
  retry in a loop.
- An empty `items` from `GET /v1/accounts` means the user has added no GitHub account
  yet, so nothing is synced to read. Tell them to add a GitHub token on the **GitHub**
  page's Accounts tab rather than guessing at repo names.

`?account=<login>` selects which synced GitHub account to act as when the user has more
than one; `GET /v1/accounts` lists them and most endpoints require it.

## Reading

| what | call |
| --- | --- |
| accounts | `GET /v1/accounts` |
| sync status | `GET /v1/status` |
| synced repos | `GET /v1/repos?account=<login>` |
| PRs in a repo | `GET /v1/repos/{owner}/{repo}/pulls?account=<login>` |
| one PR | `GET /v1/repos/{owner}/{repo}/pulls/{number}?account=<login>` |
| PR activity (comments, reviews, timeline) | `GET /v1/repos/{owner}/{repo}/pulls/{number}/activity?account=<login>` |
| notification inbox | `GET /v1/notifications?account=<login>` |

Every record is an envelope — `{ account, kind, synced_at, etag, payload }` — whose
`payload` is the GitHub-shaped JSON relayed verbatim. The diff lives in the PR
envelope's files payload as each file's unified `patch`, so read the patch text rather
than asking for a diff endpoint. List endpoints are cursor-paginated
(`?limit&cursor`, `next_cursor` in the response).

`synced_at` tells you how stale the mirror is. If the user expects something newer
than what you see, say so instead of guessing; `POST /v1/sync` asks for a refresh.

## Writing review comments

Write into the user's **review draft**, never directly to GitHub. Adding the first
comment opens a draft if none exists.

```sh
# add a per-line comment
curl -sS -X POST -H "Authorization: Bearer $GHREVIEW_CCTUI_TOKEN" \
  -H 'content-type: application/json' \
  "$CCTUI_WEB_ORIGIN/api/v1/plugins/ghreview/backend/v1/repos/$OWNER/$REPO/pulls/$N/review-draft/comments" \
  -d '{"account":"<login>","path":"src/main.ts","line":42,"side":"RIGHT","body":"…"}'
```

- `line` is the line number **in the file's new side** (`side: "RIGHT"`, the default);
  use `"LEFT"` for a removed line. `start_line` + `start_side` make it a multi-line
  comment. The line must exist in the PR's diff or the backend rejects it.
- `GET …/review-draft` reads the current draft, `PATCH …/review-draft` sets the
  summary `body` and `verdict`, `PATCH`/`DELETE …/review-draft/comments/{id}` edit and
  remove individual comments.
- Each comment's `body` is markdown; quote the code you mean and say what is wrong,
  one defect per comment.

### Do not publish

`POST …/review-draft/publish` submits the review to GitHub under the user's name.
**Only call it when the user asks you to publish in this conversation** — leaving the
draft for them to read and send in the Review page is the default. Say that you left
a draft and how many comments it has.

## Reporting back

Tell the user what you read (`owner/repo#number`, its title, how many files and how
stale the mirror is) and what you wrote (how many draft comments, on which files).
Point them at the Review page to read and publish.
