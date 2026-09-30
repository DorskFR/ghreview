<script lang="ts">
  import { type QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
  import AccountGate from "../components/AccountGate.svelte";

  let { client }: { client: QueryClient } = $props();
</script>

<QueryClientProvider {client}>
  <AccountGate>
    <p class="inner">pull requests</p>
  </AccountGate>
</QueryClientProvider>
