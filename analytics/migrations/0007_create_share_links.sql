-- Short share links (src/share.ts): the page's long share-link fragment
-- (`d=1...` a Dragon replay, `p=1...` a position) stored under a short id,
-- so the link can be `#s=<id>`. Rows are never changed or deleted.
--   id          8-16 base62 characters, derived from SHA-256 of body
--   body        the fragment without its `#`, as the page wrote it
--   created_at  ISO-8601 UTC, set by the Worker
--   site        host of the page that created it (as visits.site)
CREATE TABLE share_links (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  site TEXT
);
