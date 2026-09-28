-- Usage analytics (frontend/src/usageTracking.ts -> POST /sync). Separate
-- from puzzle_imports, which is untouched. Every table carries visitor_id so
-- anything can be filtered to one visitor without a join.

-- One row per visitor: a random id the page keeps in localStorage, so the
-- same browser coming back days later is the same visitor.
CREATE TABLE visitors (
  visitor_id        TEXT    PRIMARY KEY,
  first_seen_at     TEXT    NOT NULL,          -- ISO-8601 UTC
  last_seen_at      TEXT    NOT NULL,
  visit_count       INTEGER NOT NULL DEFAULT 0,
  total_engaged_ms  INTEGER NOT NULL DEFAULT 0,
  -- Latest known values (a visitor can travel or update their browser; each
  -- visit row keeps its own).
  country           TEXT,
  region            TEXT,
  city              TEXT,
  device_type       TEXT,
  device            TEXT,
  os                TEXT,
  os_version        TEXT,
  browser           TEXT,
  browser_version   TEXT,
  language          TEXT,
  timezone          TEXT,
  -- 1 = automated (headless browser / crawler User-Agent, or navigator.webdriver).
  is_bot            INTEGER NOT NULL DEFAULT 0,
  -- Set from the /admin dashboard: a name you recognise ("me - laptop"), and
  -- excluded = 1 to leave this visitor out of every total (e.g. yourself).
  label             TEXT,
  excluded          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_visitors_last_seen ON visitors (last_seen_at);

-- One row per visit: begins on the first page load after 30 minutes without
-- activity. Refreshes and extra tabs inside a visit add to page_loads.
CREATE TABLE visits (
  visit_id          TEXT    PRIMARY KEY,
  visitor_id        TEXT    NOT NULL,
  visit_number      INTEGER NOT NULL,          -- 1 = the visitor's first visit
  started_at        TEXT    NOT NULL,
  last_seen_at      TEXT    NOT NULL,          -- last batch received
  engaged_ms        INTEGER NOT NULL DEFAULT 0,-- visible + active time, all areas
  page_loads        INTEGER NOT NULL DEFAULT 0,
  country           TEXT,
  region            TEXT,
  city              TEXT,
  device_type       TEXT,
  device            TEXT,
  os                TEXT,
  os_version        TEXT,
  browser           TEXT,
  browser_version   TEXT,
  user_agent        TEXT,
  language          TEXT,
  timezone          TEXT,
  screen            TEXT,                      -- e.g. 390x844@3
  viewport          TEXT,                      -- e.g. 390x664
  referrer          TEXT,                      -- external referring page, if any
  campaign          TEXT,                      -- JSON of utm_source/utm_medium/utm_campaign/ref
  standalone        INTEGER,                   -- 1 = installed / home-screen app
  dark_mode         INTEGER,
  is_bot            INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_visits_visitor ON visits (visitor_id, started_at);
CREATE INDEX idx_visits_started ON visits (started_at);

-- Engaged time per area of the app per visit, e.g. 'Solver › Techniques',
-- 'Solver › Techniques › Dynamic Dragon Colouring', 'Menu › Settings',
-- 'Help › Settings', 'How It Works › Dragon Colouring'. The part before the
-- first ' › ' is the top-level section.
CREATE TABLE visit_areas (
  visit_id          TEXT    NOT NULL,
  visitor_id        TEXT    NOT NULL,
  area              TEXT    NOT NULL,
  engaged_ms        INTEGER NOT NULL DEFAULT 0,
  first_at          TEXT    NOT NULL,
  last_at           TEXT    NOT NULL,
  PRIMARY KEY (visit_id, area)
);

CREATE INDEX idx_visit_areas_visitor ON visit_areas (visitor_id);
CREATE INDEX idx_visit_areas_area ON visit_areas (area);

-- Discrete actions. Repeats inside one ~minute batch arrive merged (count).
--   category 'page'      name 'Page load'
--   category 'view'      name = area opened
--   category 'click'     name = button/tab label, label = area it was in
--   category 'setting'   name = setting key, label = new value
--   category 'task'      name = '<kind>: <title>', label = completed/cancelled/failed, value = ms
--   category 'technique' name = Selected/Applied, label = technique
--   category 'board'     name = Digit placed/Candidate toggled/Undo/...
--   category 'import'    name = string (<format>)/ocr, label = the 81-char puzzle (joins to puzzle_imports.puzzle)
--   category 'puzzle'    name = 'Grid filled'
--   category 'solve path' name = 'Steps applied', value = steps
--   category 'error'     name = message, label = file:line
CREATE TABLE events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  visit_id          TEXT    NOT NULL,
  visitor_id        TEXT    NOT NULL,
  occurred_at       TEXT    NOT NULL,          -- first occurrence in its batch
  category          TEXT    NOT NULL,
  name              TEXT    NOT NULL,
  label             TEXT,
  value             REAL,
  count             INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_events_visit ON events (visit_id);
CREATE INDEX idx_events_visitor ON events (visitor_id, occurred_at);
CREATE INDEX idx_events_category ON events (category, name);
CREATE INDEX idx_events_occurred ON events (occurred_at);

-- Failed /admin logins, for a global lockout against password guessing.
CREATE TABLE admin_login_failures (
  at                TEXT    NOT NULL
);

-- Ready-made views for quick console queries (see README.md). They leave out
-- bots and excluded visitors.
CREATE VIEW visitor_summary AS
SELECT vr.visitor_id, vr.label, vr.first_seen_at, vr.last_seen_at, vr.visit_count,
       ROUND(vr.total_engaged_ms / 60000.0, 1) AS engaged_minutes,
       ROUND(vr.total_engaged_ms / 60000.0 / MAX(vr.visit_count, 1), 1) AS minutes_per_visit,
       vr.country, vr.region, vr.city, vr.device_type, vr.device, vr.os, vr.browser
FROM visitors vr
WHERE vr.is_bot = 0 AND vr.excluded = 0;

CREATE VIEW area_summary AS
SELECT a.area, COUNT(DISTINCT a.visitor_id) AS visitors, COUNT(*) AS visits,
       ROUND(SUM(a.engaged_ms) / 60000.0, 1) AS engaged_minutes,
       ROUND(AVG(a.engaged_ms) / 1000.0, 0) AS avg_seconds_per_visit
FROM visit_areas a
JOIN visitors vr ON vr.visitor_id = a.visitor_id
WHERE vr.is_bot = 0 AND vr.excluded = 0
GROUP BY a.area;

CREATE VIEW daily_summary AS
SELECT substr(v.started_at, 1, 10) AS day,
       COUNT(DISTINCT v.visitor_id) AS visitors,
       COUNT(*) AS visits,
       SUM(v.visit_number = 1) AS new_visitors,
       ROUND(SUM(v.engaged_ms) / 60000.0, 1) AS engaged_minutes
FROM visits v
JOIN visitors vr ON vr.visitor_id = v.visitor_id
WHERE vr.is_bot = 0 AND vr.excluded = 0
GROUP BY day;
