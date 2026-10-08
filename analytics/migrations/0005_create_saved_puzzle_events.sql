-- Saved Puzzles (frontend/src/savedPuzzles.ts, SavedPuzzlesModal.tsx): one row
-- per action - a visitor saving the puzzle on their grid under a name, saving
-- over that save again, reopening it, or deleting it. Sent with the usage
-- batches (POST /sync, the `saves` array) and tied to the same visitor/visit
-- ids as everything else.
--
-- The saved puzzles themselves live only in the visitor's browser
-- (localStorage); this is the record of what was saved, kept so the exact
-- position can be loaded again by pasting `state` into the import box of the
-- page it came from.
--
--   action        save (a new entry) / update (saved over an existing entry)
--                 / open / delete
--   page          classic / variant - the two pages keep separate lists
--   variant       'Classic', or the Variant page's name for the puzzle:
--                 'Killer', 'Jigsaw', 'Killer Jigsaw', 'X-Sudoku',
--                 'Anti-Knight', 'Entropy' or a mix ('Anti-Knight X-Sudoku');
--                 'Classic' on the variant page = no extra rule on the grid
--   save_id       the saved entry's own id: the same across its updates,
--                 opens and delete
--   name          the name the visitor gave it (as it was at that action)
--   puzzle        the puzzle itself, as "Copy Original" writes it: Classic =
--                 81 digits (0 = empty); Variant = this solver's JSON
--                 ({"variantSudoku":1,"givens",...,"regions","cages",...})
--   state         save / update only: the whole position - givens, entered
--                 digits, candidates, colours - as text the import box reads.
--                 Classic = a Sudoku.Coach state string (what "Copy Puzzle
--                 As-Is" copies); Variant = this solver's JSON with board,
--                 candidates and paint. NULL for open / delete (see the
--                 saved_puzzle_log view, which fills it in) or if it was too
--                 long to send.
--   filled_cells  cells holding a digit at that moment (givens included)
--   rating        the rating line under the grid, if it was known
CREATE TABLE saved_puzzle_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id     TEXT    NOT NULL UNIQUE,   -- client-made, so a resent batch can't double a row
  visit_id      TEXT    NOT NULL,
  visitor_id    TEXT    NOT NULL,
  occurred_at   TEXT    NOT NULL,
  action        TEXT    NOT NULL,
  page          TEXT    NOT NULL,
  variant       TEXT    NOT NULL,
  save_id       TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  puzzle        TEXT,
  state         TEXT,
  filled_cells  INTEGER,
  rating        TEXT
);

CREATE INDEX idx_saved_puzzle_events_visitor ON saved_puzzle_events (visitor_id, occurred_at);
CREATE INDEX idx_saved_puzzle_events_save ON saved_puzzle_events (save_id, occurred_at);
CREATE INDEX idx_saved_puzzle_events_occurred ON saved_puzzle_events (occurred_at);

-- Ready-made views (see README.md). Like the usage views, they leave out bots
-- and excluded visitors.

-- Every action, newest first, with the visitor's label and - for an open or a
-- delete - the position that save held at that moment.
CREATE VIEW saved_puzzle_log AS
SELECT e.occurred_at, e.visitor_id, vr.label AS visitor_label, vr.country, e.visit_id,
       e.action, e.page, e.variant, e.save_id, e.name, e.filled_cells, e.rating, e.puzzle,
       COALESCE(e.state,
                (SELECT s.state FROM saved_puzzle_events s
                  WHERE s.save_id = e.save_id AND s.visitor_id = e.visitor_id
                    AND s.state IS NOT NULL AND s.occurred_at <= e.occurred_at
                  ORDER BY s.occurred_at DESC, s.id DESC LIMIT 1)) AS state
FROM saved_puzzle_events e
JOIN visitors vr ON vr.visitor_id = e.visitor_id
WHERE vr.is_bot = 0 AND vr.excluded = 0
ORDER BY e.occurred_at DESC, e.id DESC;

-- One row per saved puzzle as it now stands: who saved it, what it is, its
-- latest name and position, and how often it was saved over and reopened.
CREATE VIEW saved_puzzles AS
SELECT e.save_id, e.visitor_id, vr.label AS visitor_label, e.page,
       (SELECT l.variant FROM saved_puzzle_events l WHERE l.save_id = e.save_id AND l.visitor_id = e.visitor_id
         ORDER BY l.occurred_at DESC, l.id DESC LIMIT 1) AS variant,
       (SELECT l.name FROM saved_puzzle_events l WHERE l.save_id = e.save_id AND l.visitor_id = e.visitor_id
         ORDER BY l.occurred_at DESC, l.id DESC LIMIT 1) AS name,
       MIN(CASE WHEN e.action IN ('save', 'update') THEN e.occurred_at END) AS first_saved_at,
       MAX(CASE WHEN e.action IN ('save', 'update') THEN e.occurred_at END) AS last_saved_at,
       SUM(e.action IN ('save', 'update')) AS times_saved,
       SUM(e.action = 'open') AS times_opened,
       MAX(CASE WHEN e.action = 'open' THEN e.occurred_at END) AS last_opened_at,
       MAX(CASE WHEN e.action = 'delete' THEN e.occurred_at END) AS deleted_at,
       (SELECT l.filled_cells FROM saved_puzzle_events l
         WHERE l.save_id = e.save_id AND l.visitor_id = e.visitor_id AND l.action IN ('save', 'update')
         ORDER BY l.occurred_at DESC, l.id DESC LIMIT 1) AS filled_cells,
       (SELECT l.rating FROM saved_puzzle_events l
         WHERE l.save_id = e.save_id AND l.visitor_id = e.visitor_id AND l.rating IS NOT NULL
         ORDER BY l.occurred_at DESC, l.id DESC LIMIT 1) AS rating,
       (SELECT l.puzzle FROM saved_puzzle_events l
         WHERE l.save_id = e.save_id AND l.visitor_id = e.visitor_id AND l.puzzle IS NOT NULL
         ORDER BY l.occurred_at DESC, l.id DESC LIMIT 1) AS puzzle,
       (SELECT l.state FROM saved_puzzle_events l
         WHERE l.save_id = e.save_id AND l.visitor_id = e.visitor_id AND l.state IS NOT NULL
         ORDER BY l.occurred_at DESC, l.id DESC LIMIT 1) AS state
FROM saved_puzzle_events e
JOIN visitors vr ON vr.visitor_id = e.visitor_id
WHERE vr.is_bot = 0 AND vr.excluded = 0
GROUP BY e.save_id, e.visitor_id;
