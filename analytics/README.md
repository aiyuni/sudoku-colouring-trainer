# Import analytics (Cloudflare Worker + D1)

Every successful puzzle import on the site (pasted string or screenshot OCR)
fires one invisible `sendBeacon` to this Worker, which stores a row in the
`puzzle_imports` D1 table:

| column | meaning |
|---|---|
| `puzzle` | 81-char string, `0` = empty (every solved digit on the imported grid) |
| `import_type` | `string` or `ocr` |
| `source_format` | `plain`, `sudoku-coach`, `sudokuwiki` (NULL for OCR) |
| `is_valid_puzzle` | 1 if exactly one solution, else 0 (computed on the Worker with the app's own `SudokuSolver`) |
| `solve_status` | `solved` / `multiple` / `unsolvable` / `invalid` |
| `clue_count` | filled cells |
| `imported_at` | ISO-8601 UTC, set by the Worker |
| `country` | ISO country code from Cloudflare geolocation (`XX` unknown, `T1` Tor). No IP is stored. |
| `device_type` | `phone` / `tablet` / `desktop` / `unknown` |
| `device` | e.g. `iPhone`, `iPad`, `Samsung SM-S918B`, `Google Pixel 7`, `Chromebook`, `Mac`, `Windows PC` |
| `os`, `os_version` | e.g. `iOS` `15.4`, `iPadOS` `17.1`, `Android` `14`, `Windows` `11`, `ChromeOS`, `macOS` |
| `browser`, `browser_version` | e.g. `Safari` `17.1`, `Chrome` `129`, `Samsung Internet` `23`, `Firefox`, `Edge` |
| `user_agent` | the raw User-Agent header (max 512 chars), for re-classifying rows later |

The device columns (NULL on rows from before migration `0002`) are worked out
on the Worker by `src/device.ts`, mainly from the request's User-Agent header.
Some things the header can't tell, so the page adds a few hints:
- **iPads** that report themselves as a Mac are identified by their touch screen.
- **Chromium browsers** hide the phone model and the real Android, macOS and
  Windows versions. The page fills these in from User-Agent Client Hints.

Where nothing reveals the version, `os_version` stays NULL (Safari on a Mac,
Chrome on Android without hints), or is `10/11` (Windows in Firefox).

The browser only sends `{puzzle, importType, sourceFormat, device}` (`device` = those hints). It never holds a
credential, and the Worker has no read endpoint, so the data can only be read
through your Cloudflare account. Everything here fits Cloudflare's free tier.

## One-time setup

```sh
cd analytics
npm install
npx wrangler login
npx wrangler d1 create sudoku-analytics   # copy the printed database_id into wrangler.toml
npm run migrate:remote                     # creates the table
npm run deploy                             # prints https://sudoku-trainer-api.<you>.workers.dev
```

Then in GitHub, go to repo **Settings → Secrets and variables → Actions → Variables**
and add `VITE_ANALYTICS_URL` = the URL `npm run deploy` printed, plus `/import`
(e.g. `https://sudoku-trainer-api.aiyuni.workers.dev/import`, not a placeholder).
Rebuild or redeploy the site. If the variable is unset, the frontend sends nothing.

If the site moves to another origin, add it to `ALLOWED_ORIGINS` in `wrangler.toml`
and redeploy. Requests from any other origin are rejected with 403.

## Updating

When a migration is added (e.g. `0002_add_device_columns.sql`), apply it **before**
deploying the Worker that writes the new columns. Otherwise every insert fails
until the migration runs:

```sh
npm run migrate:remote
npm run deploy
```

The frontend can go out before or after these two steps: the old Worker ignores
the extra `device` field, and the new Worker doesn't require it.

## Querying

In the Cloudflare dashboard, go to **Storage & Databases → D1 → sudoku-analytics → Console**,
or use the CLI:

```sh
npx wrangler d1 execute sudoku-analytics --remote --command "SELECT * FROM puzzle_imports ORDER BY id DESC LIMIT 20"

# imports per device / OS version
npx wrangler d1 execute sudoku-analytics --remote --command "SELECT device_type, device, os, os_version, COUNT(*) n FROM puzzle_imports GROUP BY 1,2,3,4 ORDER BY n DESC"

# imports per country
npx wrangler d1 execute sudoku-analytics --remote --command "SELECT country, COUNT(*) n FROM puzzle_imports GROUP BY country ORDER BY n DESC"

# most-imported puzzles
npx wrangler d1 execute sudoku-analytics --remote --command "SELECT puzzle, COUNT(*) n, MAX(is_valid_puzzle) valid FROM puzzle_imports GROUP BY puzzle ORDER BY n DESC LIMIT 20"

# per day, split by method
npx wrangler d1 execute sudoku-analytics --remote --command "SELECT substr(imported_at,1,10) day, import_type, COUNT(*) FROM puzzle_imports GROUP BY 1,2 ORDER BY 1 DESC"

# full export
npx wrangler d1 export sudoku-analytics --remote --output imports.sql
```

## Local testing

```sh
npm run migrate:local && npm run dev       # Worker on http://localhost:8787 with a local D1
# frontend/.env.local:  VITE_ANALYTICS_URL=http://localhost:8787/import
npx wrangler d1 execute sudoku-analytics --local --command "SELECT * FROM puzzle_imports"
```
