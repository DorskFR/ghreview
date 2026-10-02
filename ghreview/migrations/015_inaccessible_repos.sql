-- Repositories an account's token cannot read. The sync skips their pulls until
-- checked_at is older than the backoff, and a PAT rotation clears the account's rows.

CREATE TABLE IF NOT EXISTS ghreview.inaccessible_repos (
    account     TEXT NOT NULL,
    owner       TEXT NOT NULL,
    repo        TEXT NOT NULL,
    status      INTEGER NOT NULL,
    checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account, owner, repo)
);
