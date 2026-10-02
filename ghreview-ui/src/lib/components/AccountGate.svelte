<script lang="ts">
  import { Button, EmptyState, Stack } from "@dorsk/tsumikit";
  import { createQuery } from "@tanstack/svelte-query";
  import type { Snippet } from "svelte";
  import { api } from "../api/client";
  import { keys } from "../api/queries";
  import { router } from "../router/router.svelte";

  let { children }: { children: Snippet } = $props();

  const query = createQuery(() => ({
    queryKey: keys.accounts(),
    queryFn: () => api.accounts(),
  }));

  // An error is the inner views' to report — they say which call failed.
  const gated = $derived(query.isSuccess && (query.data?.items ?? []).length === 0);
</script>

{#if query.isPending}
  <div class="pending" aria-busy="true"></div>
{:else if gated}
  <div class="gate">
    <Stack gap="var(--gh-space-3)">
      <EmptyState
        icon="user"
        title="Connect a GitHub account"
        description="This page reads your pull requests and notifications through a GitHub personal access token. Nothing syncs until you add one."
      />
      <div class="action">
        <Button variant="primary" onclick={() => router.navigate("/accounts")}>
          Add a GitHub account
        </Button>
      </div>
    </Stack>
  </div>
{:else}
  {@render children()}
{/if}

<style>
  .gate {
    flex: 1;
    display: grid;
    place-items: center;
    padding: var(--gh-space-4);
  }
  .pending {
    flex: 1;
  }
  .action {
    display: flex;
    justify-content: center;
  }
</style>
