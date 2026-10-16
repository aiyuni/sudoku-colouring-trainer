-- Which deployment of the site a visit or import came from, now that the
-- page is served from two places: GitHub Pages (aiyuni.github.io) and
-- sudoku-trainer.sekaiproject.ca (a Cloudflare Worker, frontend/wrangler.jsonc).
-- The host of the request's Origin header, e.g. 'aiyuni.github.io',
-- 'sudoku-trainer.sekaiproject.ca', 'localhost:5173' - set by the Worker
-- (only an origin in ALLOWED_ORIGINS gets that far), never by the page.
--
-- NULL = recorded before this migration (2026-10-15). Until then the only
-- public deployment was GitHub Pages, so the dashboards show NULL as that.
ALTER TABLE visits ADD COLUMN site TEXT;
ALTER TABLE puzzle_imports ADD COLUMN site TEXT;

CREATE INDEX idx_visits_site ON visits (site, started_at);
