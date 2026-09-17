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
  - `src/sudoku/SolveResponse.ts` — the result type the solver returns (`solved` / `invalid` /
    `unsolvable` / `multiple`), with static factory methods.
  - `src/sudoku/boardUtils.ts` — small board helpers (empty board, clone, given-cell mask) used by
    the UI; not part of the solving algorithm.
- `.vscode/` — tasks so **Run and Debug → Frontend (Chrome)** starts the dev server and opens it
- `.github/workflows/deploy-pages.yml` — builds the frontend and deploys it to github.io

The Solve button only fills in the board when the puzzle has exactly one solution. Otherwise the
board is left untouched and a message explains why (no solution, or more than one solution).

Select a cell, then use the **Solution** pad to enter its digit or the **Candidates** pad to pencil
in notes (shown as a 3x3 mini-grid inside the cell: 1-3 top, 4-6 middle, 7-9 bottom). Click any
filled cell, or a digit in the **Highlight** pad, to spotlight every cell and candidate mark that
shares that digit.

The Candidates panel also has **Autofill all** (fills every unsolved cell with the digits that
don't already conflict in its row, column, or box) and **Clear all** (wipes every pencil mark
without touching solved cells). The **Keyboard enters** button near the top toggles whether typing
1-9 fills in the solution or toggles a candidate.

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
