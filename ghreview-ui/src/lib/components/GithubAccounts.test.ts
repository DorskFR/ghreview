import { QueryClient } from "@tanstack/svelte-query";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime } from "../api/config";
import QueryHost from "../testing/QueryHost.svelte";
import GithubAccounts from "./GithubAccounts.svelte";

let component: ReturnType<typeof mount> | undefined;
let client: QueryClient;

function respondWith(items: unknown[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ items }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

async function settleUntil(condition: () => boolean): Promise<void> {
  await vi.waitFor(() => {
    flushSync();
    if (!condition()) throw new Error("condition not met yet");
  });
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  configureRuntime({ baseUrl: "https://ghreview.example", token: null, account: "acct" });
});

afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  document.body.replaceChildren();
  client.clear();
  configureRuntime(null);
  vi.restoreAllMocks();
});

describe("GithubAccounts", () => {
  it("lists the repositories the token cannot read", async () => {
    respondWith([
      {
        id: "a1",
        login: "octocat",
        active: true,
        inaccessible_repos: ["acme/private-repo", "acme/other-repo"],
      },
    ]);
    component = mount(QueryHost, {
      target: document.body,
      props: { client, component: GithubAccounts as never },
    });
    await settleUntil(() => document.querySelector(".inaccessible") !== null);

    const slugs = [...document.querySelectorAll(".inaccessible code")].map((n) => n.textContent);
    expect(slugs).toContain("acme/private-repo");
    expect(slugs).toContain("acme/other-repo");
    expect(document.querySelector(".inaccessible")?.textContent).toContain("repo");
  });

  it("shows no warning when every repository is readable", async () => {
    respondWith([{ id: "a1", login: "octocat", active: true, inaccessible_repos: [] }]);
    component = mount(QueryHost, {
      target: document.body,
      props: { client, component: GithubAccounts as never },
    });
    await settleUntil(() => document.body.textContent?.includes("octocat") ?? false);

    expect(document.querySelector(".inaccessible")).toBeNull();
  });
});
