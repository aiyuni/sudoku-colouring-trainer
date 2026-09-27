-- One row per puzzle import (string or screenshot/OCR).
CREATE TABLE puzzle_imports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 81 chars, row-major, '0' = empty. For an OCR or mid-solve import this is
  -- every solved digit on the grid, not just the original givens.
  puzzle          TEXT    NOT NULL CHECK (length(puzzle) = 81),
  -- 'ocr' or 'string'
  import_type     TEXT    NOT NULL CHECK (import_type IN ('ocr', 'string')),
  -- Which string format was pasted: 'plain', 'sudoku-coach', 'sudokuwiki';
  -- NULL for OCR.
  source_format   TEXT,
  -- 1 if the grid has exactly one solution, else 0. Computed by the Worker,
  -- not trusted from the client.
  is_valid_puzzle INTEGER NOT NULL CHECK (is_valid_puzzle IN (0, 1)),
  -- 'solved' | 'multiple' | 'unsolvable' | 'invalid' - why is_valid_puzzle is 0.
  solve_status    TEXT    NOT NULL,
  -- Number of filled cells in `puzzle`.
  clue_count      INTEGER NOT NULL,
  -- ISO-8601 UTC, e.g. 2026-09-26T14:03:11.123Z
  imported_at     TEXT    NOT NULL,
  -- ISO 3166-1 alpha-2 from Cloudflare's geolocation ('XX' = unknown,
  -- 'T1' = Tor). No IP address is ever stored.
  country         TEXT
);

CREATE INDEX idx_puzzle_imports_imported_at ON puzzle_imports (imported_at);
CREATE INDEX idx_puzzle_imports_puzzle ON puzzle_imports (puzzle);
CREATE INDEX idx_puzzle_imports_country ON puzzle_imports (country);
