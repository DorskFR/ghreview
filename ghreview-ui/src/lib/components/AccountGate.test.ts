import { QueryClient } from "@tanstack/svelte-query";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime } from "../api/config";
import { keys } from "../api/queries";
import { router } from "../router/router.svelte";
import GateHost from "../testing/GateHost.svelte";

let component: ReturnType<typeof mount> | undefined;
let client: QueryClient;

function respondWith(items: unknown[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ items, next_cursor: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

function mountGate(): void {
  component = mount(GateHost, { target: document.body, props: { client } });
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
  router.navigate("/");
});

afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  document.body.replaceChildren();
  client.clear();
  configureRuntime(null);
  vi.restoreAllMocks();
});

describe("AccountGate", () => {
  it("asks for a GitHub account when the user has none", async () => {
    respondWith([]);
    mountGate();
    await settleUntil(() => document.querySelector(".gate") !== null);

    expect(document.body.textContent).toContain("Connect a GitHub account");
    expect(document.querySelector(".inner")).toBeNull();
  });

  it("gets the user to the add form in one click", async () => {
    respondWith([]);
    mountGate();
    await settleUntil(() => document.querySelector(".gate button") !== null);

    const button = document.querySelector(".gate button") as HTMLButtonElement;
    expect(button.textContent?.trim()).toBe("Add a GitHub account");
    button.click();
    flushSync();

    expect(router.current.name).toBe("accounts");
  });

  it("renders the page itself once an account exists", async () => {
    respondWith([{ id: "a1", login: "someone", active: true }]);
    mountGate();
    await settleUntil(() => document.querySelector(".inner") !== null);

    expect(document.querySelector(".gate")).toBeNull();
    expect(document.querySelector(".inner")?.textContent).toBe("pull requests");
  });

  it("renders neither the page nor the gate while accounts are loading", async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    mountGate();
    flushSync();

    expect(document.querySelector(".inner")).toBeNull();
    expect(document.querySelector(".gate")).toBeNull();

    release(
      new Response(JSON.stringify({ items: [], next_cursor: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await settleUntil(() => document.querySelector(".gate") !== null);
    expect(document.querySelector(".inner")).toBeNull();
  });

  it("renders the page immediately when accounts are already cached", () => {
    client.setQueryData(keys.accounts(), {
      items: [{ id: "a1", login: "someone", active: true }],
      next_cursor: null,
    });
    respondWith([{ id: "a1", login: "someone", active: true }]);
    mountGate();
    flushSync();

    expect(document.querySelector(".inner")?.textContent).toBe("pull requests");
  });
});
