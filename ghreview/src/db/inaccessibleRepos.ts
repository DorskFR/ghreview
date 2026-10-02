import type { DbHandle } from "./client.ts";

export const INACCESSIBLE_BACKOFF_MS = 60 * 60 * 1000;

export async function markRepoInaccessible(
  db: DbHandle,
  account: string,
  owner: string,
  repo: string,
  status: number,
): Promise<void> {
  await db.sql`
    INSERT INTO inaccessible_repos (account, owner, repo, status, checked_at)
    VALUES (${account}, ${owner}, ${repo}, ${status}, now())
    ON CONFLICT (account, owner, repo) DO UPDATE SET
      status = EXCLUDED.status,
      checked_at = now()
  `;
}

export async function clearRepoInaccessible(
  db: DbHandle,
  account: string,
  owner: string,
  repo: string,
): Promise<void> {
  await db.sql`
    DELETE FROM inaccessible_repos
    WHERE account = ${account} AND owner = ${owner} AND repo = ${repo}
  `;
}

export async function isRepoBackedOff(
  db: DbHandle,
  account: string,
  owner: string,
  repo: string,
  backoffMs: number = INACCESSIBLE_BACKOFF_MS,
): Promise<boolean> {
  const rows = await db.sql<{ n: number }[]>`
    SELECT 1 AS n FROM inaccessible_repos
    WHERE account = ${account} AND owner = ${owner} AND repo = ${repo}
      AND checked_at > now() - make_interval(secs => ${backoffMs / 1000})
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function listInaccessibleRepos(db: DbHandle, account: string): Promise<string[]> {
  const rows = await db.sql<{ slug: string }[]>`
    SELECT owner || '/' || repo AS slug FROM inaccessible_repos
    WHERE account = ${account}
    ORDER BY owner, repo
  `;
  return rows.map((r) => r.slug);
}
