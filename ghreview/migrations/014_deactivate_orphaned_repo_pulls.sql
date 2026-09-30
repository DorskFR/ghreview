-- Pull requests discovered by a repo subscription outlived it when the repo
-- subscription went away, and kept being polled and listed as open forever.

UPDATE ghreview.subscriptions p
SET active = false
WHERE p.kind = 'pull_request'
  AND p.source = 'repo'
  AND p.active
  AND NOT EXISTS (
      SELECT 1 FROM ghreview.subscriptions r
      WHERE r.kind = 'repo'
        AND r.active
        AND r.account = p.account
        AND r.target = split_part(p.target, '#', 1)
  );

