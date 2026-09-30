import { OpenAPIHono } from "@hono/zod-openapi";
import {
  authMiddleware,
  LOCAL_PRINCIPAL,
  proxyAuthMiddleware,
  setUserId,
} from "./auth/middleware.ts";
import type { AppDeps } from "./deps.ts";
import { registerAccounts } from "./routes/accounts.ts";
import { registerActivity } from "./routes/activity.ts";
import { registerCapabilities } from "./routes/capabilities.ts";
import { registerComments } from "./routes/comments.ts";
import { registerEvents } from "./routes/events.ts";
import { registerHealth } from "./routes/health.ts";
import { registerLabels } from "./routes/labels.ts";
import { registerMerge } from "./routes/merge.ts";
import { registerNotifications } from "./routes/notifications.ts";
import { registerPulls } from "./routes/pulls.ts";
import { registerReactions } from "./routes/reactions.ts";
import { registerRepos } from "./routes/repos.ts";
import { registerReviewers } from "./routes/reviewers.ts";
import { registerReviews } from "./routes/reviews.ts";
import { registerSnooze } from "./routes/snooze.ts";
import { registerSubscriptions } from "./routes/subscriptions.ts";
import { registerSync } from "./routes/sync.ts";
import { registerViewed } from "./routes/viewed.ts";
import { registerWebhook } from "./routes/webhook.ts";
import { version } from "./version.ts";

const AUTH_EXEMPT = new Set(["/v1/health", "/v1/webhook", "/v1/openapi.json"]);

export function createApp(deps: AppDeps = {}) {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: {
              code: "invalid_request",
              message: "Request validation failed",
              details: result.error.issues,
            },
          },
          400,
        );
      }
    },
  });

  if (deps.proxyAuth) {
    const guard = proxyAuthMiddleware(deps.proxyAuth);
    app.use("/v1/*", async (c, next) => {
      if (AUTH_EXEMPT.has(c.req.path)) return next();
      return guard(c, next);
    });
  } else if (deps.auth) {
    const guard = authMiddleware(deps.auth);
    app.use("/v1/*", async (c, next) => {
      if (AUTH_EXEMPT.has(c.req.path)) return next();
      return guard(c, next);
    });
  } else if (deps.authDisabled) {
    app.use("/v1/*", async (c, next) => {
      if (!AUTH_EXEMPT.has(c.req.path)) setUserId(c, LOCAL_PRINCIPAL);
      return next();
    });
  } else {
    app.use("/v1/*", async (c, next) => {
      if (AUTH_EXEMPT.has(c.req.path)) return next();
      return c.json(
        { error: { code: "unauthorized", message: "Authentication is not configured" } },
        401,
      );
    });
  }

  registerHealth(app, deps);
  registerCapabilities(app, deps);
  registerSync(app, deps);
  registerAccounts(app, deps);
  registerRepos(app, deps);
  registerSubscriptions(app, deps);
  registerPulls(app, deps);
  registerMerge(app, deps);
  registerReviewers(app, deps);
  registerActivity(app, deps);
  registerViewed(app, deps);
  registerSnooze(app, deps);
  registerReviews(app, deps);
  registerReactions(app, deps);
  registerComments(app, deps);
  registerLabels(app, deps);
  registerNotifications(app, deps);
  registerEvents(app, deps);
  registerWebhook(app, deps);

  app.notFound((c) => c.json({ error: { code: "not_found", message: "No such route" } }, 404));
  app.onError((err, c) => {
    const github = githubFailure(err);
    if (github) return c.json({ error: github.error }, github.status);
    const requestId = crypto.randomUUID();
    console.error(`ghreview: unhandled error [${requestId}]`, err);
    return c.json(
      {
        error: { code: "internal", message: "Internal error", details: { request_id: requestId } },
      },
      500,
    );
  });

  app.doc("/v1/openapi.json", {
    openapi: "3.0.3",
    info: {
      title: "cctui gh-review API",
      version,
      description:
        "Versioned HTTP+SSE contract for the GitHub review center. Relays GitHub-shaped " +
        "JSONB payloads verbatim inside typed envelopes.",
    },
    servers: [{ url: "/" }],
  });

  return app;
}

const GITHUB_PASSTHROUGH = new Set([403, 404, 410, 422]);

function githubFailure(
  err: unknown,
): { status: 403 | 404 | 410 | 422 | 502; error: { code: string; message: string } } | null {
  if (!(err instanceof Error) || err.name !== "HttpError") return null;
  const status = (err as Error & { status?: unknown }).status;
  if (typeof status !== "number" || status < 400) return null;
  const detail = err.message.split(" - ")[0] || "request failed";
  if (status === 404) {
    return {
      status,
      error: {
        code: "github_not_found",
        message: `GitHub: ${detail}. The PR may be gone, or the account's token cannot see this repository.`,
      },
    };
  }
  return {
    status: GITHUB_PASSTHROUGH.has(status) ? (status as 403 | 410 | 422) : 502,
    error: { code: `github_${status}`, message: `GitHub ${status}: ${detail}` },
  };
}
