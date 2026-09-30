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
credential. The data can only be read through your Cloudflare account or the
password-protected `/admin` dashboard (see Usage analytics below). Everything here fits Cloudflare's free tier.

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

## Usage analytics (visitors, visits, time per feature)

Separate from `puzzle_imports` (which is untouched), `frontend/src/usageTracking.ts`
sends one small batch about once a minute while the page is in use (plus one when
the tab is hidden or closed) to `POST /sync`. It is stored in four tables from
migration `0003`:

| table | one row per | key columns |
|---|---|---|
| `visitors` | browser (random id in `localStorage`) | `first_seen_at`, `last_seen_at`, `visit_count`, `total_engaged_ms`, latest location/device, `label`, `excluded`, `is_bot` |
| `visits` | visit (a new one starts after 30 min without activity) | `visit_number` (1 = first ever), `started_at`, `last_seen_at`, `engaged_ms`, `page_loads`, location, device, screen, language, time zone, `referrer`, `campaign` (utm_*) |
| `visit_areas` | visit × area | `area` (e.g. `Solver › Techniques › Dynamic Dragon Colouring`, `Menu › Dragon Configuration`, `Help › Settings`, `How It Works › Dragon Colouring`), `engaged_ms` |
| `events` | action (repeats within one batch are merged into `count`) | `category`, `name`, `label`, `value`. The migration's comment lists every category. |

- **Same visitor, several visits**: the visitor id survives closing the browser.
  A different browser or device, a private window, or clearing site data counts as a
  new visitor. Safari may also clear it after 7 days without a visit. No IP,
  cookie or fingerprint is used.
- **Engaged time** only counts while the tab is visible and the user did
  something (click, key, scroll, touch) in the last 5 minutes. `last_seen_at -
  started_at` is how long the visit was open.
- **Areas** are the layer the user is looking at. An open overlay (How It Works,
  Help) beats an open menu, which beats the solver panel. The part before the first
  ` › ` is the section.
- **Bots** (headless or crawler User-Agents, `navigator.webdriver`) are flagged
  `is_bot = 1` and left out of the dashboard and the views by default.
- **Imports** also appear as `events` rows (`category = 'import'`, `label` = the
  81-char puzzle). That ties each import to a visitor, and you can join it to `puzzle_imports.puzzle`.

### Setup (once)

```sh
cd analytics
npm run migrate:remote                     # adds the 0003 tables (before deploying!)
npx wrangler secret put ADMIN_PASSWORD     # 12+ characters; use a long random one
npm run deploy
```

No new GitHub variable is needed: the page derives `/sync` from `VITE_ANALYTICS_URL`.

### Dashboard (only you)

Open `https://sudoku-trainer-api.<you>.workers.dev/admin` and sign in with
`ADMIN_PASSWORD`. Nothing on the site links to it, and it sends `noindex`.
Without the secret, every `/admin` route returns 404. The session cookie is
HttpOnly and SameSite=Strict, and lasts 30 days. Changing the secret signs every
session out. After 10 wrong passwords in 15 minutes, all logins are refused for
15 minutes.

For any date range, and for either everyone or one visitor (click a visitor row), it shows:
- visitors (new and returning) and visits per visitor
- engaged time per visit, and traffic per day
- time per section and per area
- every button, setting, technique, task, import and error, with counts
- hour of day, day of week, and loyalty (visit number)
- audience: country, city, device, OS, browser, referrer, language, screen

Clicking a visit opens its full timeline. **Name yourself** in the Visitors table
and tick **Exclude** so your own use stays out of the totals. To find your own id,
open the site's devtools: Application → Local Storage → `sudoku-trainer.vid`.

**Export** downloads the visitors, visits, areas or events table as a CSV file,
with the dashboard's current filters. Excel opens these directly. For scripts, any
`/admin` URL also accepts `Authorization: Bearer <ADMIN_PASSWORD>`:

```sh
curl -H "Authorization: Bearer $ADMIN_PASSWORD" "https://sudoku-trainer-api.<you>.workers.dev/admin/export?table=events" -o events.csv
```

### Queries

Three views leave out bots and excluded visitors: `visitor_summary`, `area_summary` and `daily_summary`.

```sh
D1="npx wrangler d1 execute sudoku-analytics --remote --command"

# every visitor: visits, engaged minutes, where, device
$D1 "SELECT * FROM visitor_summary ORDER BY last_seen_at DESC"

# where time goes, most first
$D1 "SELECT * FROM area_summary ORDER BY engaged_minutes DESC"

# visitors / visits / new visitors per day (UTC)
$D1 "SELECT * FROM daily_summary ORDER BY day DESC LIMIT 30"

# one visitor's visits, then their time per area
$D1 "SELECT visit_number, started_at, engaged_ms/1000 AS seconds, page_loads, referrer FROM visits WHERE visitor_id = '<id>' ORDER BY started_at"
$D1 "SELECT area, SUM(engaged_ms)/1000 AS seconds FROM visit_areas WHERE visitor_id = '<id>' GROUP BY area ORDER BY seconds DESC"

# settings people change, and to what
$D1 "SELECT name, label, SUM(count) n, COUNT(DISTINCT visitor_id) visitors FROM events WHERE category = 'setting' GROUP BY 1, 2 ORDER BY n DESC"

# techniques studied / applied
$D1 "SELECT name, label, SUM(count) n FROM events WHERE category = 'technique' GROUP BY 1, 2 ORDER BY n DESC"

# long tasks (puzzle generation etc): how long they take, how often they're cancelled
$D1 "SELECT name, label, COUNT(*) n, ROUND(AVG(value)/1000, 1) avg_seconds FROM events WHERE category = 'task' GROUP BY 1, 2 ORDER BY n DESC"

# imports with the visitor who made them
$D1 "SELECT occurred_at, visitor_id, name, label AS puzzle FROM events WHERE category = 'import' ORDER BY occurred_at DESC LIMIT 50"
```

## Local testing

```sh
npm run migrate:local && npm run dev       # Worker on http://localhost:8787 with a local D1
# frontend/.env.local:  VITE_ANALYTICS_URL=http://localhost:8787/import
# analytics/.dev.vars:   ADMIN_PASSWORD=some-local-password   (then open http://localhost:8787/admin)
npx wrangler d1 execute sudoku-analytics --local --command "SELECT * FROM puzzle_imports"
```
