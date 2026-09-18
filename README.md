# Sudoku Solver

A React + TypeScript Sudoku app. All solving logic runs in the browser — there is no backend and
nothing to deploy or host besides the static site. Built to run in **VS Code / Cursor** and to
publish straight to **GitHub Pages**.

## Layout

- `frontend/` — Vite + React app
  - `src/App.tsx` — the grid UI (number entry, pencil-mark candidates, digit highlighting,
    Solve/New puzzle/Clear). Contains no solving logic.
  - `src/sudoku/SudokuSolver.ts` — the solver: a backtracking search with minimum-remaining-values
    cell selection, written as a class. It counts up to two solutions so it can tell a unique
    solution apart from an unsolvable or ambiguous puzzle.
  - `src/sudoku/SudokuGenerator.ts` — the "New puzzle" generator: fills a random valid grid, then
    removes cells one at a time (checking uniqueness via `SudokuSolver` after each removal) until
    20-25 clues remain.
  - `src/sudoku/SudokuRules.ts` — the row/column/box placement rule shared by the solver and the
    generator.
  - `src/sudoku/PuzzleImporter.ts` — parses pasted puzzles: Sudoku.Coach's plain 81-character
    givens-only string, its full `SCv7_32_...` state string (base32(deflate(JSON))) that also
    carries the user's entered digits and candidate marks, and SudokuWiki.org's "text version of
    the board" ASCII grid (one or several digits per cell — several means those are its
    candidates).
  - `src/sudoku/SudokuSingleFinder.ts` — finds naked singles (a cell with one candidate marked) and
    hidden singles (a digit that's a candidate in only one cell of some row, column, or box) from
    the currently marked candidates, for the Auto-solve buttons.
  - `src/sudoku/SudokuPairFinder.ts` — finds naked pairs (two cells in the same row, column, or box
    with the exact same two candidates) as structured instances (the pair's cells/digits plus every
    resulting elimination), used by both the Naked pairs button and the Techniques panel.
  - `src/sudoku/SudokuUnits.ts` — the 27 row/column/box cell groups, shared by the single and pair
    finders.
  - `src/sudoku/SudokuColorFinder.ts` — Simple Coloring: for one digit, builds the strong-link graph
    between its candidate cells, splits it into connected chains, and 2-colors each one, then finds
    Rule 1 (a color conflicting with itself) and Rule 2 (an uncolored cell seeing both colors)
    instances, for the Simple colouring button and the Techniques panel.
  - `src/sudoku/SudokuMedusaFinder.ts` — 3D Medusa: Simple Coloring extended across every digit at
    once. Its strong-link graph has one node per (cell, digit) candidate, linked both by conjugate
    pairs (as in Simple Coloring) and by a bivalue cell's own two candidates, then 2-colors each
    connected chain. Finds the mass eliminations (Rules 1-2, which resolve a whole chain to one
    color) and the per-candidate eliminations (Rules 3-5) for the 3D Medusa button and the
    Techniques panel.
  - `src/sudoku/SolveResponse.ts` — the result type the solver returns (`solved` / `invalid` /
    `unsolvable` / `multiple`), with static factory methods.
  - `src/sudoku/boardUtils.ts` — small board helpers (empty board, clone, given-cell mask) used by
    the UI; not part of the solving algorithm.
- `.vscode/` — tasks so **Run and Debug → Frontend (Chrome)** starts the dev server and opens it
- `.github/workflows/deploy-pages.yml` — builds the frontend and deploys it to github.io

The Solve button only fills in the board when the puzzle has exactly one solution. Otherwise the
board is left untouched and a message explains why (no solution, or more than one solution).

**Undo** and **Redo** step through every grid change one action at a time - entering or erasing a
digit, toggling a candidate, and each of the bulk buttons below (Autofill, a New puzzle, Solve,
Import, ...) all count as a single step, however many cells they touched. Undo goes all the way
back to the puzzle as first loaded; doing something new after an undo discards the redo steps
that came after it, same as any text editor.

Select a cell, then use the **Solution** pad to enter its digit or the **Candidates** pad to pencil
in notes (shown as a 3x3 mini-grid inside the cell: 1-3 top, 4-6 middle, 7-9 bottom). Click any
filled cell, or a digit in the **Highlight** pad, to spotlight every cell and candidate mark that
shares that digit.

Placing a digit (from the Solution pad, the keyboard, or an Auto-solve button) also clears that
digit as a candidate from the rest of its row, column, and box (`SudokuRules.eliminatePeerCandidates`)
— without this, a stale candidate mark left over in a peer cell could later look like a genuine
naked or hidden single and solve a cell incorrectly.

The Candidates panel also has **Autofill all** (fills every unsolved cell with the digits that
don't already conflict in its row, column, or box) and **Clear all** (wipes every pencil mark
without touching solved cells). The **Keyboard enters** button near the top toggles whether typing
1-9 fills in the solution or toggles a candidate.

**Strong links** (also near the top) draws a red line between every pair of candidate marks that
form a conjugate pair: a digit that's a candidate in exactly two cells of some row, column, or box,
so it can't be false in both of them.

**Bivalue cells** (also near the top) outlines every unsolved cell left with exactly two
candidates - the other kind of strong link Simple Coloring/3D Medusa use, since a bivalue cell
must hold one of its two candidates.

The **Auto-solve** panel fills in cells the current candidate marks already force: **Naked
singles** (a cell left with exactly one candidate) and **Naked + hidden singles** (also fills any
cell whose candidate is the only place a digit can go in its row, column, or box, even if that
cell has other candidates too). Both act on your existing marks in one pass — run Autofill all
first if you haven't marked candidates yet.

**Naked pairs** (same panel) eliminates candidates rather than solving a cell: when two cells in
the same row, column, or box have the exact same two candidates and nothing else, neither digit
can belong to any other cell in that house, so it's removed from the rest. It needs every empty
cell to already have its candidates marked (run Autofill all first) — otherwise it shows a status
message explaining that instead of guessing at incomplete information.

**Simple colouring** (same panel) looks at one digit's strong-link chain and 2-colors it (light
blue / light yellow - adjacent cells in the chain always take opposite colors, since a strong link
means exactly one of the two is true). Rule 1: if two cells of the *same* color share a row,
column, or box, that color can't be true anywhere in the chain, so it's solved with the other
color instead. Rule 2: an uncolored cell that shares a unit with a cell of *both* colors can't be
the digit either way, so it's eliminated. The button applies every chain's conclusions at once.

**3D Medusa** (same panel) extends Simple Coloring across every digit at once, chaining through
bivalue cells as well as conjugate pairs, so one chain can mix candidates of different digits.
Mass eliminations (Rules 1-2) resolve an entire chain to one color, just like Simple Coloring's
Rule 1: Rule 1 fires when two same-colored candidates share a cell (a cell can't hold two digits)
or share a unit for the same digit; Rule 2 fires when an uncolored cell's every remaining
candidate sees the same color of its own digit, which would leave that cell with nothing left if
that color were true. Either way, the false color's candidates are eliminated and the true
color's are placed. The other three rules eliminate individual candidates without resolving the
whole chain: Rule 3, a candidate that sees the same digit colored both ways; Rule 4, a cell with a
colored candidate of each color, which eliminates every other candidate in that cell; Rule 5, a
cell with exactly one colored candidate, whose other candidates are eliminated if they see the
same digit colored the opposite way elsewhere. The button applies every chain's mass and
per-candidate conclusions at once.

The **Techniques** panel, to the left of the grid, lists every instance of these techniques the
current candidates support right now, in Sudoku notation - it recomputes live as the board
changes. A naked or hidden single reads `r3c4 is 5`. A naked pair states its two cells, `=>`
("results in"), then each cell it affects: `r4c8, r6c8 => r4c7 is not 4, r4c9 is not 1` — a cell
losing more than one digit uses a bracketed list, e.g. `r1c6 is not [2,6]`. Simple Coloring Rule 1
reads `Light blue is false, so light yellow is true.` (which physical color starts where is
arbitrary - it's about whichever ends up assigned to the conflicting cells); Rule 2 reads like a
naked pair's result, e.g. `r7c1, r7c3 cannot be 7.`. Rule 1 instances are listed before Rule 2 ones
for the same reason Rule 1 takes priority when both apply to the same chain: solving the true
color already implies every Rule 2 elimination for that chain via ordinary peer elimination.
Clicking any row doesn't change the board; it highlights that instance on the grid instead: the
cell(s) it uses get a yellow outline (for Simple Coloring, colored blue/yellow instead), what it
would eliminate turns red, and the digit it would place turns green. This panel is meant to stay a
complete list of every technique the app implements — `buildTechniqueInstances` in `App.tsx` says
so, but noting it here too: a future technique needs an entry added there as well.

Paste a puzzle into the box above the action buttons and click **Import** to load it as a fresh
puzzle. Three formats are supported: Sudoku.Coach's plain 81-character givens string; its full
`SCv7_32_...` state string, which also carries any progress (digits you'd already entered) and
candidate marks — progress is loaded as editable entries, distinct from the puzzle's locked
givens; and SudokuWiki.org's "text version of the board" ASCII grid, where every solved cell is
loaded as an editable entry (that format can't distinguish givens from progress).

## Run locally (VS Code)

1. `npm install` once in `frontend`.
2. Choose **Frontend (Chrome)** in Run and Debug and press F5 — this starts the Vite dev server
   and opens it in Chrome.

Or from a terminal:

```powershell
cd frontend
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

## Publish to GitHub Pages

1. Create a GitHub repo named `sudoku-solver` (recommended so the URL matches the Vite base path).
2. Repo **Settings → Pages → Source: GitHub Actions**.
3. Push this project to `main`:

```powershell
git remote add origin https://github.com/<you>/sudoku-solver.git
git branch -M main
git add .
git commit -m "Initial sudoku solver"
git push -u origin main
```

The site will be `https://<you>.github.io/sudoku-solver/`.

If the repo is a **user site** (`<you>.github.io`) instead of a project site, set `VITE_BASE` to
`/` in `.github/workflows/deploy-pages.yml`.

## First place to change

- UI: `frontend/src/App.tsx` and `frontend/src/App.css`
- Solver: `frontend/src/sudoku/SudokuSolver.ts`
