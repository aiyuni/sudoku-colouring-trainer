-- Which device/OS/browser each import came from (see src/device.ts).
-- All NULL for rows recorded before this migration.

-- 'phone' | 'tablet' | 'desktop' | 'unknown'
ALTER TABLE puzzle_imports ADD COLUMN device_type TEXT;
-- e.g. 'iPhone', 'iPad', 'Samsung SM-S918B', 'Google Pixel 7', 'Chromebook', 'Mac', 'Windows PC'
ALTER TABLE puzzle_imports ADD COLUMN device TEXT;
-- e.g. 'iOS', 'iPadOS', 'Android', 'Windows', 'macOS', 'ChromeOS', 'Linux'
ALTER TABLE puzzle_imports ADD COLUMN os TEXT;
-- e.g. '15.4', '13', '11', '10/11' (Windows without Client Hints). NULL when
-- the browser doesn't reveal it (Safari on a Mac, Chrome on Android without hints).
ALTER TABLE puzzle_imports ADD COLUMN os_version TEXT;
-- e.g. 'Safari', 'Chrome', 'Samsung Internet', 'Firefox', 'Edge'
ALTER TABLE puzzle_imports ADD COLUMN browser TEXT;
ALTER TABLE puzzle_imports ADD COLUMN browser_version TEXT;
-- The raw User-Agent header (max 512 chars), so rows the parser got wrong
-- or didn't recognise can be re-classified later.
ALTER TABLE puzzle_imports ADD COLUMN user_agent TEXT;

CREATE INDEX idx_puzzle_imports_device ON puzzle_imports (os, device);
