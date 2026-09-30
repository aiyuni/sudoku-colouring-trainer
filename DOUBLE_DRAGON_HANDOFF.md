# Double Dragon Colouring handoff

Purpose: let a fresh session continue the Double Dragon / Double Dynamic Dragon work from 2026-09-28 to 2026-09-30 without re-deriving it. Read `DRAGON_COLOURING_HANDOFF.md` first (plain/Dynamic Dragon internals); this file covers what was added on top, what was measured, what is still running, and what is open.

**Provenance.** Written at the end of the session that built and verified everything here (2026-09-30 ~02:15 UTC). Numbers are from runs in that session. **Nothing below is committed** (see "Repository state").

## The technique (user's own, experimental)

The user invented Double Dragon Colouring and asked for it to be checked, not assumed correct. The logic was checked and found sound; the summary below is the version the user accepted.

- **First Dragon** (light blue/dark blue = side A, yellow/orange = side B): a plain (or, for Double Dynamic, Dynamic) Dragon coloured until it is stuck. Exactly one of A/B is true; every node means "true if its side is true".
- **Second Dragon** from another stuck Medusa: pink/purple = side X, lime green/dark green = side X'. The display colours are the candidate palette's swatches 3, 7, 6 and 8 (the user chose these).
- **Dragon link:** if a node of X and a first-Dragon node on side S can't both be true (same cell with different digits, or same digit in a shared unit), then S => not X, i.e. X => S' (the first Dragon's *other* side). So X implies every S' node; they are coloured X's dragon colour (purple for pink) and used from then on like any other X node. The second Dragon then carries on as a normal Dragon. All existing elimination rules stay sound because exactly one of X/X' is true and each implies its own nodes.
- **Link conclusions:** X linked to both A and B => X false. X linked to S while an S' node is an X' *Medusa* colour => X false. X and X' both linked to the same S => S' true (a move about the first Dragon's colours, `secondDragon: false`).
- The user's original example (Sudoku.Coach state in the conversation, first Medusa 9r1c1/9r2c2, second 6r3c4 vs 6r1c6/6r6c4) is reproduced exactly: pink 6r3c4 sees dark-blue 6r1c6, absorbs yellow/orange, Rule 3 on 6r1c1 and 6r6c3, and with Exhaustive it proves pink false.

**Double Dynamic Dragon** = the same with Extension Rule 3 allowed in the Dragons. The user's definition: it counts as Double Dynamic if **at least one** Dragon is Dynamic (so Dynamic first + plain second is Double Dynamic, not Double Plain).

## Where it lives

| What | Where |
|---|---|
| Stuck colouring, link, pair search | `SudokuDragonFinder.ts`: `stuckColouring`, `extendDouble`, `findDoubleDragons`, `findDragonLinkMove`, `findDragonLinkConclusion`, `dragonLinks`, `LinkedDragonState`, `DynamicDragonLimits`, `renameToSecondDragon`, `SECOND_DRAGON_LABELS`, `dragonColourLabel` |
| Engine rows | `techniqueEngine.ts`: `computeDoubleDragonExtensions`, `computeDoubleDynamicDragonExtensions`, `RANK_DOUBLE_DRAGON` (17), `RANK_DYNAMIC_DRAGON` (18), `RANK_DOUBLE_DYNAMIC_DRAGON` (19), `buildDragonInstance` idPrefixes `double-dragon` / `double-dynamic-dragon` |
| Replay colours | `dragonReplay.ts` (`foldDragonMoves` keeps each Dragon's colours separately: `pink/purple/limeGreen/darkGreenCandidates`); `App.tsx` `renderDragonSplit` / `DRAGON_HIGHLIGHT_HEX` (a candidate coloured by both Dragons is a split pip, first Dragon bottom-left); `App.css` `technique-pink/-purple/-limegreen/-darkgreen/-dragon-split` |
| Find by elims | `SudokuDragonTargetFinder.ts`: kinds `dragon`, `double`, `dynamic`, `double-dynamic` (tie-break simplest first, `KIND_ORDER`) |
| Settings | `settingsDefaults.ts`: `doubleDragonEnabled`, `doubleDynamicDragonEnabled`, `dynamicDragonPuzzleForbidsDoubleDragon` (all default OFF); wired through App state, `liveAnalysisInputs`, `solvePathOptions`, `solvePath.worker.ts`, `solvePathInWorker.ts`, `resetSettingsToDefaults`, `trackSettingsChanges`, `helpContent.ts` |
| Generator | `SudokuDragonPuzzleGenerator.ts`: `requireDoubleDragon`, `forbidDoubleDragon`; `applyOneDragonRound(..., useDouble)` |
| Practice stocks | `dynamicDragonPuzzleStockData.ts`, `doubleDragonPuzzleStockData.ts`, `doubleDynamicDragonPuzzleStockData.ts`; pickers in `dynamicDragonPuzzleStock.ts` (`pickStockDynamicDragonPuzzle`, `pickStockDoubleDragonPuzzle`, `pickStockDoubleDynamicDragonPuzzle`, shared `pickFromStock`) |
| Tutorial | "Double Dragons" tab: `buildDoubleDragonLesson` (lessonBuilders.ts), positions in `buildDoubleDragonGroups` (tutorialExamples.ts) |

### Behaviour decisions (user-confirmed unless marked "mine")

- Double Dragon: OFF by default, rank between Dragon and Dynamic, **no auto-solve button**. Follows Exhaustive **and Optimize Dragons** (the link is one more branch in `extendOptimized`'s search; Optimize never changes whether a pair resolves). "Require 3+ base Medusa candidates" applies to the **first** Medusa only.
- Double Dynamic: OFF by default, under Dynamic Dragon Colouring, off while Dynamic Dragons are disabled, no auto-solve. Follows the Dynamic technique set, "Limit to 1 AIC per step" and "Max techniques per step" **per Dragon**, Exhaustive, and Optimize Dynamic Dragons. 3+ base filter on the first Dragon only. Same colours as Double Dragon (substep clauses are renamed too).
- Mine (user was told, didn't object): Double Dynamic ranks above Dynamic Dragon (top tier). A Double Dynamic result must contain an `extension-rule3` move. A pair plain Double Dragon resolves is not listed again as Double Dynamic while Double Dragon is on. A chain the single Dragon (plain resp. Dynamic) resolves is never part of a pair. Find by elims searches Double and Double Dynamic when enabled.
- Absorbed first-Dragon candidates keep their first-Dragon colour and also get the second Dragon's colour (split pip) - the user asked for multi-colour here. By the logic it is pink's *dragon* colour (purple), not pink.
- Pair search prefilter (`findDoubleDragons`): a pair whose two single-Dragon stuck colourings have no weak link at all is skipped - exact, because the second Dragon runs exactly as its single-Dragon run until its first link.
- Menu labels were renamed by the user to "Enable Double Dragons" / "Enable Double Dynamic Dragons"; the help page items read "Enable Double Dragon" (singular) / "Enable Double Dynamic Dragons" - one small label mismatch to check.

## "Limit to 1 AIC per step" - changed meaning (2026-09-30)

User's definition: a Dynamic step may **rely on** at most one AIC; a dead-end AIC must not use up the quota. Old code counted every AIC the simulation *tried*, so an irrelevant first AIC blocked the one that mattered. Now (`extensionRule3Moves`, `branchOnAicTier`, `AicMode` 'all' | 'branch' | 'none'): with the limit on, wherever an AIC tier is reached, each of that tier's AICs is tried in its own branch (applied to a copy, simulation continues with AICs off); the main line then continues as if the tier found nothing. First branch = the old path. Enumeration (limit > 1) caps branches at `MAX_RULE3_ENUMERATION_AIC_BRANCHES` (8).

Verified against a saved copy of the old source (`frontend/dragon-research/aiclimit-compare.ts`, states in `data/aiclimit-states.txt`; it expects the old source at `frontend/dragon-research/src-before/`, which is **not** saved in the repo - recreate from git if needed): limit off **0 differences in 12,368 `extend()` comparisons** (4 option combos x 2 technique caps); limit on 435 -> **769** chains resolved, 0 lost, 0 unsound, max 1 AIC relied on per step; about 2x the time on those very hard positions.

**Known, not fixed:** a Dynamic step's explanation (substeps, `dynamicTechniques`) can omit a technique it really relied on (pruning tracks the final technique's basis cells only - the "dependency gap" in `DRAGON_COLOURING_HANDOFF.md`). Seen concretely: a single Dynamic Dragon whose steps show 0 AICs is stuck when AICs are disabled. Offered to the user to fix; no answer yet.

## Verification and research results

All checks compare against the backtracking solution; "0 unsound" = no true candidate eliminated, no wrong placement, and every node of the actually-true second-Dragon side true.

- **Double Dragon soundness:** 27 Dynamic-stock puzzles + 277 generated puzzles walked through every state: 75 plain-stuck states, Double Dragon progressed in 22; 0 unsound over ~30,000 pairs; exhaustive x optimize combos: 0 unsound, 0 resolve mismatches.
- **Double Dynamic research** (scenarios: S1 no limits; S2 AIC 1/tech 1; S3 AIC 1/tech 2; S4 AIC 1/tech unlimited; S5 app defaults; all AICs, fish, ALS-xz on standalone except S5) over 3,301 hard puzzles (magictour top1465/top870/top2365/top95 + famous hardest + stock): Double Dynamic helped only in S4 (4 states) and S5 (10 states); never in S1/S2/S3. **S4 Double Dynamic never goes beyond S1 single Dynamic**; S1 Double Dynamic never progressed where S1 single was stuck (7 puzzles: Easter Monster, AI Escargot, Inkala 2012 and similar, all stuck at the start). 10,000 random minimal puzzles never got stuck at all. *These numbers predate the AIC-limit change* (S2-S4 used the old counting).
- **Clue-variant hunt** (adding correct clues to the S1-stuck puzzles changes where they get stuck): S1 (unlimited) - 5,257 variants, 398 stuck, 34 with a Double-Dynamic-only position, 18 fully solved with Double Dynamic; 5 verified through the app engine -> `DOUBLE_DYNAMIC_DRAGON_PUZZLE_STOCK`. S6 (AIC 1, max 3 techniques) - see the list file below.
- **Double Dynamic stock (6 positions; the 6th added 2026-09-30 by `ddd-light-hunt.ts`)** was verified with the AIC limit **off**, so the AIC-limit change doesn't affect it. Stored as whole Sudoku.Coach states (mid-solve positions), served as-is (no symmetry). At app-default settings these positions show no row - they need every Dynamic technique with no limits (the button's status text says so).

## Reference files in the repo (user asked to keep; **never delete** `dragon-stock-rejected.txt` or `dragon-stock-pending/`)

| File | Contents |
|---|---|
| `frontend/dragon-stock-rejected.txt` | 12 earlier stock positions a fish or ALS-xz also progresses (with the reason; 6 were Double Dragon positions). User chose to leave them out. |
| `frontend/dragon-stock-pending/` | `stock-dynamic-only.txt` (42, all loaded), `stock-double.txt` (26, all loaded), `genboth.ts` + `classify.ts` (the running stock search) |
| `frontend/double-dynamic-dragon-examples.txt` | 11 positions where Double Dynamic works and Double Plain doesn't (S4/S5 research, old AIC counting) |
| `frontend/double-dynamic-dragon-aic1-tech3.txt` | **9** puzzles where single Dynamic (all techniques, AIC limit 1, max 3 per step, everything else on) is stuck but Double Dynamic progresses and the puzzle then solves with no guessing - re-verified under the new AIC limit; 43 former entries that single Dynamic now solves are listed at the bottom |
| `frontend/dragon-research/` | the harnesses: `research.ts` (scenario grind + stuck-state records; exports `runPuzzle`, `SCENARIOS` incl. S6), `ddd-hunt.ts` (clue-variant hunt; env `SCENARIO`, `TAG`, `SEEDS`, `SEEDS_TOO`), `verify-ddd.ts` (app-engine verification; env `AIC_LIMIT=1`, `MAX_TECH`, `OUT_FILE`; exports `verify`), `ddd-light-hunt.ts` (clue-variant hunt at the strongest settings that grades every Double Dynamic stuck position by the smallest technique set that still works, adds stock-eligible ones to `data/ddd-light-hits.jsonl` and stops at the first light one - found the tutorial's third Double Dynamic position after ~2,000 variants), `compare.ts`, `aiclimit-compare.ts`, `ddcore.ts` (prototype + checks); `data/` has the hard-puzzle corpora and the latest verification results. Data dir = env `DRAGON_RESEARCH_DIR` or `frontend/dragon-research/data/`. |

Harnesses are outside `tsconfig` and run the same way the OCR test does: `npx rolldown <file>.ts --format esm --platform node -o <out>.mjs && node <out>.mjs ...` (from `frontend/`). `research.ts` only runs its own main block when started as `research.mjs` (so other harnesses can import it).

## Practice-puzzle stocks

Strict definition (user's): at a fresh autofill, **no AIC of any kind, no fish, no ALS-xz** (verified with every AIC kind not disregarded, all fish and ALS-xz enabled).

| Stock | In app | Target | Served by |
|---|---|---|---|
| Dynamic-only (no plain, no Double Dragon) | 42 | 42 (full) | Dynamic practice puzzle with "must not allow plain" + "must not allow double Dragons" |
| Double Dragon (plain stuck everywhere, Double progresses; Dynamic may too) | 26 | 42 (search stopped at 26) | "Generate Double Dragon colouring puzzle"; also Dynamic practice with only "must not allow plain" (union of both stocks) |
| Double Dynamic | 6 | - | "Generate Double Dynamic Dragon Colouring puzzle" |

`pickFromStock` now tries the next entry when one fails re-verification under the current settings (it used to serve it unverified).

## Stock search (stopped)

- **Double Dragon stock search** (`genboth2.mjs` built from `frontend/dragon-stock-pending/genboth.ts`, 14 workers, started 2026-09-29 16:13 UTC, stopped by the user on 2026-09-29 at double 26/42). It appends to `frontend/dragon-stock-pending/stock-double.txt` and stops at 42/42. At hand-off: dynamic-only 42/42, double 26/42 (~1 Double hit per 30-90 min). It dies with this session's machine/terminal; restart from `frontend/` with the rolldown command above on `dragon-stock-pending/genboth.ts` (it resumes from the counts in the files).
- To load found positions into the app: re-check each with `classify()` and write the two stock data files (the session did this with a small script: all 53 passed).

## Open items / next steps

1. Done: all 26 Double Dragon positions re-checked with `classify()` and loaded. Restart the search if more are wanted.
2. Rerun the S6 clue-variant hunt under the **new** AIC limit to rebuild `double-dynamic-dragon-aic1-tech3.txt` beyond 9 (offered, not asked for yet). The research tables above for S2-S4 also predate the change.
3. Decide on the explanation-gap fix (Dynamic step text omitting a relied-on technique) - offered, not answered.
4. **Bug found, not fixed:** Simple Colouring Rule 1 rows (`techniqueEngine.ts`, `simple-color-rule1-*`) have empty `solvedCandidates`/`eliminatedCandidates` although `findRule1` returns `solvedCells` - Apply does nothing and Easy Solve can pick that row forever. Offered; no answer yet.
5. Help label mismatch "Enable Double Dragon" vs menu "Enable Double Dragons".
6. Done (2026-09-29): Techniques overview has a "Double Dragons" tab (`buildDoubleDragonGroups` in tutorialExamples.ts, `buildDoubleDragonLesson` in lessonBuilders.ts), one lesson each for plain and Dynamic; split pips in `TutorialGrid`.
7. Performance: Double Dynamic with unlimited AICs added ~2.6 s to one hard position's analysis; with the AIC limit on, Dynamic Dragons can cost up to ~2x more on very hard positions since the AIC-limit change.

## Repository state

Nothing from this work is committed. `git status` at hand-off: many staged (`A`/`M`) and further-modified (`MM`) files across `frontend/src` (App, engine, finder, generator, stocks, settings, help, worker), plus untracked `double-dynamic-dragon-aic1-tech3.txt`, `double-dynamic-dragon-examples.txt`, `doubleDynamicDragonPuzzleStockData.ts`, `dragon-research/`, this file. `npm run build` and `npm run lint` pass (the only lint warnings are the old ones in `scratch-verify-dragon.ts`).
