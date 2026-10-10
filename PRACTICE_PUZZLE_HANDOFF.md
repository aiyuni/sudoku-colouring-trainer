# Session handoff, 2026-10-09: easiest-Dragon search and "Practice a technique"

Three pieces of work, all **uncommitted** on `master` (8 modified files, plus new `frontend/src/practice/` and `frontend/practice-tests/`). Nothing was pushed. Detail lives in `CLAUDE.md` ("Search for the easiest dragon", "Practice a technique") and `DRAGON_COLOURING_HANDOFF.md` ("Known issues"); this file is the short version plus what those don't say.

## State at the end of the session

- `npm run build` passes; `npm run lint` shows the same 3 warnings as before the session.
- `npm run test:practice -- --all`: 5022/5022. `npm run test:variants`: 947/947. `npm run test:saved-puzzles`: 62/62.
- `npm run test:ocr` and `npm run test:variant-rating` were **not** run (nothing they cover was touched).
- The Classic equivalence check (whole Techniques list against the old `src/`) was **not** re-run. What was run instead: `dragon-research/easiest-dragon/equivalence.ts`, every plain and Dynamic Dragon move log, old code vs new, setting off: identical (3419 logs, 6 puzzles x 5 profiles).

## 1. The page freeze that started the session: diagnosed, NOT fixed

- Cause: "Max techniques per step" set to a number + "Limit to 1 AIC per step" on + Grouped AIC or ALS-AIC ticked for Dynamic Dragon. One Techniques list took 84 s (2 s with no per-step limit, 0.9 s without those techniques). Lowering the limit makes it worse.
- Mechanism: `branchOnAicTier` in `SudokuDragonFinder.ts` tries every AIC of a tier in its own branch, uncapped when looking for one move; a per-step limit discards the branches that would end the search.
- Not a regression: the same code is fast on builds from before those techniques existed (added 2026-10-03).
- **Open decision for the user**: a branch cap would fix it but changes which Dynamic Dragons are found. Proposed: cap + a sweep showing what is lost at a few cap sizes. Not approved yet. The alternative (move the Techniques list to a Web Worker) keeps the page usable but not fast.
- Workaround given to the user: clear the per-step limit.

## 2. "Search for the easiest dragon" (done)

- Techniques tab checkbox under "Prefer easiest techs within dragon"; setting `techniquesListSearchEasiestDragon`, default off, only applied while the parent is ticked. Techniques list only; single Dynamic Dragons only.
- `findEasiestDynamicDragon` in `techniqueEngine.ts`: technique group first (Defaults, then Advanced, Brutal, Unfair added), then fewest techniques per step, then shortest (Optimize Dynamic search). The ordinary Dragon is always a candidate, so a row is never harder than with the setting off.
- Every run except the ordinary one is on a work budget: new opt-in `DragonExtendOptions.rule3StepBudget` (counts Rule 3 simulation steps and Optimize search states; `extend()` returns null when spent). Inert when unset.
- **Real bug fixed on the way**: endless loop in the every-move Rule 3 enumeration (Optimize Dynamic Dragons) under the AIC limit. `emit` in `extensionRule3Moves` now always marks the candidate `known`. The ordinary one-move search could not hit it.
- Final sweep (12 top1465 puzzles, 46 states, 6 settings profiles): 0 wrong, 0 rows harder or lost, 58-73% of rows easier, 0.4-1.4 s per state against 0.1-0.8 s off, worst 6.7 s.
- **Declined / not done**: the same search for Double Dynamic Dragons (suggested: group tiers only, measure first), and for the Solve Path.

## 3. "Practice a technique" (done)

- Generate Puzzle -> "More…" (Classic only). Files: `src/practice/` (`practiceTargets.ts`, `practicePuzzleGenerator.ts`, `parallelPracticePuzzle.ts`, `practicePuzzle.worker.ts`, `practicePuzzleStock.ts`, `practicePuzzleStockData.ts`, `PracticePuzzleDialog.tsx`), styles at the end of `App.css`, help entry in `helpContent.ts`.
- User decisions to keep: no colouring techniques in the list; "Defaults" is called "Normal" **in this dialog only**; Sue-de-Coq sits in Unfair; a switched-off technique cannot be picked.
- A state qualifies when **every row of the easiest tier is the pick**, judged with the app's own Techniques list under the user's Technique Selections, then re-checked with the full list and against the solution.
- **Start from beginning** (checkbox, off by default, session-only): returns the puzzle at its givens. Promise: taking an easiest move every time, the pick left for last among equally easy ones, reaches a point that needs the pick with nothing harder first. Verified by a one-move-at-a-time replay (`easiestFirstSolveReachesTarget`).
- **Stock** for the targets too rare to find live (Grouped AIC, ALS-xz, UR-AIC, ALS-AIC, UR Type 5, Avoidable Rectangle Type 2): 5 s live search, then a stock position under a random grid symmetry, re-checked in a worker. Sizes: 40 / 38 / 33 / 28 / 23 and **only 4 UR-AIC** (about 6 thread-hours of mining found no more).
- In-app benchmark (production build, 15 workers, every technique on, 32 targets x 5, both modes): 320/320 found, no timeouts; live targets 0.3-3 s, stock targets 5.1-6.4 s; from-the-beginning puzzles have 22-30 givens, median 25.

## Things a new session could get wrong

- **Rarity is not a bug.** Single-thread hit rates have a long tail: Avoidable Rectangle from the beginning missed four 30 s attempts in a row, then hit after 213 puzzles. Check with many attempts before suspecting the code.
- There is **no "unnamed" Short Single-Digit AIC** target on purpose: 17k puzzles walked, none found.
- A UR row that merges types ("Types 4 & 7b") matches only the "Any" target.
- Target ids are permanent (stock, tests, analytics event names). A new technique or pattern needs an entry in `practiceTargets.ts`, a rank in `PRACTICE_TECHNIQUE_RANKS`, and a matcher case in `practice-tests/run.ts` (the suite fails without one).
- Stock entries mined with every technique on hold for any subset of techniques, except that **Double Dragon on** (off while mining) can disqualify them; the picker re-checks and the dialog says so if none fits.
- The practice timings come from a 16-thread machine; the live targets scale with core count.

## How to redo the expensive parts

All in `frontend/`, harnesses under `dragon-research/` (gitignored, build with `npx rolldown <file> --format esm --platform node -o <dir>/.out/<name>.mjs`):

- Benchmark one thread: `practice/bench.ts <attempts> <budgetMs> all [targetId ...]`, `FROM_START=1` for the option.
- Mine stock: `practice/mine-stock.ts <seconds> <targetId ...>` (`ALONE=<targetId>` switches the other above-Dragon techniques off), then `node dragon-research/practice/build-stock.mjs 40 <mined .jsonl ...>`, then `npm run test:practice`.
- Easiest-Dragon sweep and equivalence: `easiest-dragon/sweep.ts`, `easiest-dragon/equivalence.ts`.

## Shell gotchas on this machine

- Bash heredocs containing apostrophes or `\n` escapes break or get mangled; write patch scripts with the Write tool and run them.
- `git stash` / `stash pop` converts working-copy line endings to CRLF (autocrlf); the source files are LF in the working copy.
- The user's dev server on port 5173 was not running at the end of the session. A second worktree, `.claude/worktrees/feature-urlcopy`, belongs to another session; leave it alone.
