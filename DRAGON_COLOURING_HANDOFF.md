# Dragon Colouring handoff

Purpose: let a fresh session change how features treat Dragon Colouring (rules, Dynamic Dragon, UI replay, auto-solve, generator, solve path) without re-deriving the algorithm or silently changing its semantics.

**Provenance.** Reconstructed by reading the code on 2026-09-20; the session that produced this file did no Dragon debugging or experiments. Everything under "Confirmed" was checked against the source at that date. "Observed, not reproduced" = spotted by reading, never run. "Ideas" = unverified. The README claim that Dragon solves all Sudoku.Coach Hell / Beyond Hell puzzles is the author's, not re-verified. The Dragon files were heavily modified and uncommitted at the time (`SudokuDragonFinder.ts` +352/-108 vs HEAD; `SudokuHiddenPairFinder.ts` and `SudokuShortAicFinder.ts` untracked) - check `git status` before assuming HEAD matches.

There is no test suite. Verification is: `npm run build` (type-check), the in-app "generate Dragon / Dynamic Dragon puzzle" buttons, and importing Sudoku.Coach puzzles. `frontend/scratch-*.ts` are stale (only plain Dragon and an older technique subset, no runner) and cannot exercise Dynamic Dragon.

## Where things live

| Thing | Location |
|---|---|
| The algorithm | `frontend/src/sudoku/SudokuDragonFinder.ts` (`SudokuDragonFinder.extend`, ~1600 lines, mostly clause-text builders) |
| Medusa chain building, strong-link graph, growth, Medusa rules 1-5 | `SudokuMedusaFinder.ts` (`findChains`, `buildStrongLinkGraph`, `growChainFromGraph`, `findMassElimination`, `findRule3/4/5Eliminations`) |
| Techniques simulated by Extension Rule 3 (all pure over `(board, candidates)`) | `SudokuLockedCandidateFinder`, `SudokuPairFinder`, `SudokuNakedSubsetFinder`, `SudokuHiddenPairFinder`, `SudokuUniqueRectangleFinder` (Type 1), `SudokuShortAicFinder` |
| "Stuck chain" search + panel/auto-solve glue | `App.tsx`: `computeStuckDragonExtensions`, `computeStuckDynamicDragonExtensions`, dragon block at the end of `buildTechniqueInstances`, `runDragonColouring`, `onDynamicDragonColouring` |
| Replay / highlight | `App.tsx`: `foldDragonMoves`, `TechniquePanel` (stepper), grid pip rendering (`dragonHighlight`, `dragonTechniqueCellKeys`, `dragonAicChains`), `fullTechniqueEffect` |
| Settings | `App.tsx` settings dropdown: `exhaustiveDragonColouring`, `allowedRule3Techniques`, `shortAicEnabled`, `shortSingleDigitAicEnabled`, `aicLimitPerDragonStep`, `dynamicDragonAutoSolveIncludesAics`, `effectiveAllowedRule3Techniques` |
| Puzzle generation | `SudokuDragonPuzzleGenerator.ts` (`generate({requireDynamic})`) |

## Concepts (confirmed)

- **Medusa chain** = a connected component (>= 2 nodes) of the strong-link graph over (cell, digit) candidates, two edge kinds: *bilocal* (digit has exactly 2 places in a unit) and *bivalue* (cell has exactly 2 candidates). Each edge means "exactly one of the two is true", so the component is 2-coloured `blue`/`yellow`. Components with an odd cycle are silently dropped by `findChains`. Which of the two colours is `blue` is arbitrary (first node reached), so never attach meaning to "blue" beyond "side A".
- **Two sides.** Side A = blue, side B = yellow. Exactly one side is true. Each side has a *primary* colour (Medusa colour) and a *secondary/dragon* colour (`blue`/`darkBlue`, `yellow`/`orange`; UI labels light blue / dark blue / yellow / orange). `sideOf()` maps any of the four colours to a side.
  - Primary node: true **iff** its side is true.
  - Secondary node: true **if** its side is true (one-way; converse unproven).
- **Promotion** turns a secondary into a primary when it is proven equivalent to its side (below).
- **Dragon Colouring only applies to a *stuck* chain**: none of Medusa's own mass elimination / rules 3-5 fire for it. `extend` does not check this; callers do, and the identical 4-line predicate is **copy-pasted in four places** (`computeStuckDragonExtensions`, `computeStuckDynamicDragonExtensions`, generator `buildRobustCheckpoint`, generator `applyOneDragonRound`). Change all together.
- **Snapshot semantics.** `board`/`candidates` are never mutated during `extend`. Extension Rules 1-2 read the real candidates. The hidden-single check and Extension Rule 3 reason on a *cloned hypothetical board* (`buildHypotheticalBoard`): every node of the assumed side (primary and secondary) is placed as a given and `eliminatePeerCandidates` is applied. The strong-link graph is built once, lazily, from the **real** candidates (only used by medusa-growth), so links created by hypothetical eliminations are never used except inside the AIC search on the hypothetical board.

## `extend()` main loop (confirmed; order matters)

`extend(medusaChain, board, candidates, {dynamic, allowedRule3Techniques, aicLimitPerStep})` returns `{moves}` or `null`. Every iteration:

1. **Eliminations** (`findEliminationMoves`) over all current nodes, using *sides*, not exact colours. If anything is found, append it and **return** (chain grows only until the first elimination exists). If a mass elimination exists it is returned alone; otherwise all Rule 3 + Rule 4 + Rule 5 finds are appended (Rule 3s, then 4s, then 5s), one `DragonMove` per find.
2. **Promotion** (`findPromotionMove`), before any extension, then `continue`. A pair of nodes (a, b) promotes when they are on opposite sides, not both already primary, and either (i) same digit in the same unit or (ii) same cell. Reasoning: they cannot both be true, and exactly one side is true, so a<=>A and b<=>B. Each secondary in the pair becomes its side's primary (`buildPromotionMove` lists only the recoloured nodes). Terminates because each promotion strictly reduces the number of secondaries. Right after a promotion, `findMedusaGrowthMove` runs `growChainFromGraph` from each promoted node (now known-true, so its strong links are usable) and colours newly reachable candidates as primaries (`medusa-growth`). Promotion/growth don't take part in turn alternation.
3. **Extension**, for the side whose turn it is (`turnPrimary`, starts `blue`): Rule 1 -> Rule 2 -> hidden single -> (only if `dynamic`) Rule 3. If the turn-side has none, the same chain is tried for the other side. After any extension move `turnPrimary` flips to the opposite of the side that just extended. If neither side yields a move: **return `null`** (whole partial colouring discarded).

**Exhaustive mode** (`options.exhaustive`, UI "Exhaustive Dragon Colouring", App default ON; finder/generator default OFF, which is exactly the behaviour above). Only a *non-mass* elimination changes: it is recorded, applied to a private copy of the candidates (`workingCandidates`; the strong-link graph is reset), and the loop continues with `continuing = true`, where the per-iteration order becomes promotion -> eliminations -> extension (before the first elimination it stays elimination -> promotion -> extension, so the first elimination is identical to OFF). Every promotion/extension stays its own move. Ends when: a **mass elimination** is found (kept as the last move); `findColouringSolutionMove` finds that exactly one side's nodes (primary or dragon) cover every empty cell (terminal `kind:'solution'` move, relies on puzzle uniqueness, checked after mass elimination and skipped if both sides cover); no dragon (secondary) node remains after promotions; or no extension exists. The last three cut the log back to `lastEliminationEnd` (the end of the last elimination group), so results never end on promotions/extensions that led nowhere. Whether `extend` returns `null` is decided by the first elimination and is the same on/off, so the plain-vs-Dynamic classification (and the generator) call it with exhaustive OFF. The spec's "a colour completely eliminated -> stop at the previous elimination" is only reachable as a mass elimination in practice (Rules 3-5 never eliminate coloured nodes), and that step is kept, per the "stop at that elimination step" rule. Cost is roughly 2.5-4x per `extend` call in a quick measurement, and it runs live on every board change and in the solve-path search.

Consequences: a returned result always ends with elimination move(s) (or the exhaustive `solution` move); dynamic Rule 3 for side X runs *before* plain rules for side Y (order is per side, not "all plain first"); the caller is what guarantees plain-before-dynamic (see below).

Each extension move colours exactly one new candidate with the side's secondary colour; an already-coloured candidate (any colour) is never re-coloured except by promotion, which guarantees termination.

### Extension rules, exact conditions

- **Rule 1** (`findExtensionRule1Move`): for a unit and digit with >= 2 unsolved candidate cells, count the cells that do **not** see a *primary*-coloured node of that side with the same digit (`seesColor`, own cell excluded). If exactly one such cell and its candidate isn't coloured -> colour it secondary. Note it looks at the primary colour only, unlike Rule 2. (Observed: this is likely subsumed by the hidden-single check, which uses the fuller hypothetical board; not tested. Rule 1 still wins the race and so sets the reported `kind`.)
- **Rule 2** (`findExtensionRule2Move`): unsolved cell with no already-coloured candidate; among its candidates, those not seeing a same-side node (**primary or secondary**, `seesSide`) of the same digit; exactly one survivor -> colour it secondary.
- **Hidden single** (`findExtensionHiddenSingleMove`, always on, *not* a "dynamic" technique): on the hypothetical board, first unit (rows, then columns, then boxes; digits 1-9) where a digit has exactly one candidate cell and that candidate isn't coloured -> secondary. Design decision (commit `656a576` "removed hidden singles from dynamic dragons"): it is plain-Dragon logic, so `'hidden single'` never appears in a move's `dynamicTechniques` or in the "Dynamic Dragon Colouring (...)" label.
- **Rule 3, Dynamic only** (`findExtensionRule3Move`, next section).

### Elimination rules (side-generalised Medusa, `findMassElimination`/`findRule3/4/5`) - confirmed and reasoned sound

Mass elimination (checked in this order): (1) two nodes in one cell on the same side; (2) same digit, same unit, same side; (3) an uncoloured unsolved cell where every candidate sees a node of one side. Any of these proves that side false. `buildMassMove` then: **eliminates only the false side's *primary* nodes** and **solves every node (primary and secondary) of the true side**. A false side says nothing about its secondaries (denying the antecedent), so they are not eliminated. `provenTrueColor` records the conclusion; the UI summary says "X is true".
Rule 3: uncoloured candidate seeing the same digit on both sides. Rule 4: cell with a node of each side -> every uncoloured candidate in it. Rule 5: cell with exactly one coloured node; another candidate there sees the same digit on the opposite side.

## Dynamic Dragon = Extension Rule 3 (confirmed)

Dynamic mode differs from plain **only** by allowing Extension Rule 3 as an extra last-resort extension. `findExtensionRule3Move` simulates on the hypothetical board for up to `MAX_RULE3_SIMULATION_STEPS` (200) iterations. Each iteration tries, in this fixed simplest-first order, and applies **only the first instance that has eliminations** (mutating `hypCandidates` only), then restarts from the top:

hidden single -> locked candidate -> naked pair -> naked triple -> naked quad -> hidden pair -> Unique Rectangle Type 1 -> AIC (single-digit or general).

After each application it checks `findNewlySingleCandidateCell` (an uncoloured cell reduced to exactly one candidate). If found, that cell/digit is coloured secondary and the move is finished (`buildRule3CombinedMove`). A hidden single found in the simulation, or a UR Type 1 with `solvedDigit`, is itself the conclusion. If the loop runs dry or hits the cap -> `null` (steps discarded). Applications that didn't force anything are kept as chain steps.

- `allowedRule3Techniques`: `naked pair` is always re-added by `extend`. In the UI the `hidden single`, `locked candidate` and `naked pair` checkboxes are disabled (always on). `DEFAULT_RULE3_TECHNIQUES` = everything except the two AIC kinds, so AICs are opt-in.
- **Dependency pruning** (`selectRelevantChainSteps`): walks the recorded steps backwards keeping only those whose `affectedCells` intersect the dependency set (final basis cells, growing with kept steps' basis cells). Result: the description chains kept antecedents with "which reveals", `dynamicTechniques` lists kept antecedents + the final technique (minus `'hidden single'`), `dynamicTechniqueCells` lists their basis cells. Hidden single passes its whole unit as the dependency set (`dependencyCells`).
- **Plain vs dynamic classification lives in the callers.** `computeStuckDynamicDragonExtensions` skips a chain if plain `extend` already succeeds on it, so a chain never appears as both. The panel name is `Dynamic Dragon Colouring (<techniques used, fixed order>)`.
- UR Type 1 in the simulation implicitly relies on the puzzle having a unique solution.

### AIC handling (confirmed)

- Run on the *hypothetical* candidates via `findShortAics` (length 3 or 5, strong-weak-strong[-weak-strong], one chain kept per elimination set). `classifyShortAic`: `single-digit` = length 3 and one digit; everything else `general`. Gated by the technique being in `allowedTechniques`.
- Limit: `aicLimitPerStep` (UI "Limit to 1 AIC per step", default on) means at most **one AIC application per `findExtensionRule3Move` call**, counting every AIC *tried* (`aicStepsUsed`), not only the ones that end up relevant. Off = unlimited within the call's 200-step cap.
- An AIC's eliminations only mutate the hypothetical candidates. They are stored on the move as `aicChains[].hypotheticalEliminations` and drawn as hollow circle + faint cross (`technique-aic-hypothetical`), never as real eliminations; the move's own `eliminated` is `[]`.
- Master switches: `shortAicEnabled` (default **off**) and `shortSingleDigitAicEnabled` (default **on**) strip the matching kinds via `effectiveAllowedRule3Techniques`; but since the checkbox set defaults to no AIC kinds, Dynamic Dragon uses no AIC until the user ticks one.
- Auto-solve: the "Dynamic Dragon Colouring" button drops whole chains whose moves list any AIC technique unless `dynamicDragonAutoSolveIncludesAics`.
- The standalone panel entries for AIC suppress eliminations already covered by easier techniques; the Dragon simulation does **not** apply that suppression.

## `DragonMove` semantics (confirmed)

Fields: `id`, `kind`, `description` (display text only; nothing parses it), `colored: DragonNode[]`, `eliminated`, `solved`, plus `provenTrueColor` (mass-elimination), `dynamicTechniques` / `dynamicTechniqueCells` / `aicChains` (extension-rule3).
Sequence: `moves[0]` is always `kind:'medusa'` with the whole seed chain coloured. Then any interleaving of `promotion`, `medusa-growth`, `extension-rule1|rule2|hidden-single|rule3`. Then the terminal group of `mass-elimination` **or** `rule3`/`rule4`/`rule5` moves (with exhaustive ON, several such rule3/4/5 groups can be interleaved with promotions/extensions, ending in a final group, a `mass-elimination`, or a `solution`). Only elimination/solution moves carry `eliminated`/`solved`. Ids: shared counter `${kind}-${n}` for extension/promotion/growth; terminal moves keep `id: ''` (nothing in the UI keys on it). State at step *k* = fold of moves 0..k.

## UI replay (confirmed)

- `TechniqueInstance` for Dragon has `moves`, empty `usedCells`/`usedCandidates`; `eliminatedCandidates`/`solvedCandidates` are the flattened moves' (used by solve path and summary). Instance id = `dragon-` or `dynamic-dragon-` + sorted chain-candidate keys (with colour initial), so selection is lost if the chain composition changes. Panel order: everything else first, then Dragon, then Dynamic, each sorted by `moves.length` ascending.
- `foldDragonMoves(moves, k)`: colour per candidate = *latest* colour among moves 0..k (promotion overwrites secondary with primary); eliminated/solved accumulate. Grid pips prefer `dragonHighlight.*` over the instance's static fields. `darkBlue`/`orange` exist only via the fold.
- `dynamicTechniqueCells` and `aicChains` are taken from the **current step's move only**, not folded.
- The stepper is a walkthrough only: **Apply always commits the whole chain** (`fullTechniqueEffect` folds to the last move), a Dragon chain counts as **one** step in Solve Path, and `dragonStepIndex` resets to 0 on selecting another row.
- Auto-solve (`runDragonColouring`): unions every chain's solved/eliminated (deduped) computed against the same pre-apply snapshot and applies at once via `commitAutoSolve` (clears the cached solve path). Buttons: bivalue-seeded (`hasBivalueCellLink`), any Medusa, Dynamic. The panel's `minBaseMedusaFilter` (>= 3 base candidates) applies to the panel only; the auto-solve buttons pass 0.

## Puzzle generator coupling (confirmed)

`SudokuDragonPuzzleGenerator` removes clues one at a time (uniqueness via `SudokuSolver`) until a **freshly autofilled**, singles-only-solved checkpoint has: no locked candidates / pairs / triples / quads / hidden pairs / UR1 / Simple Colouring, every Medusa chain stuck, and Dragon (or, with `requireDynamic`, Dynamic-but-not-plain on at least one chain) can progress. It then confirms full solvability by alternating an easy-technique grind with one `applyOneDragonRound`. Short AIC is checked per kind (`classifyShortAic`) and only when that kind is *not* disregarded: `generate({disregardSingleDigitAic, disregardAic})`, both default **true**, so by default a checkpoint may still have an AIC available next to the Dragon technique. The grind (`applyShortAic`) still uses every AIC regardless. The Settings "Puzzle generation" toggles feed these; `App.tsx` handlers keep the invariants (Short AIC enabled => Single-Digit AIC enabled; a disregard flag is only false while its technique is enabled; disregard-AIC only false while disregard-single-digit is false). Turning Short AIC ON asks for `window.confirm` because non-disregarded AIC makes generation slower. The generator hardcodes its own finder lists (adding a technique means touching both the "nothing easier" check and the grind) and **never receives the UI's Rule 3 technique set or AIC limit**: `generate({requireDynamic})` uses `extend`'s defaults (no AICs). The Settings hint claims the technique set applies "for both puzzle generation and solving"; the code does not do this for generation.

## Invariants to preserve

1. Exactly one of side A / B is true; every deduction must be valid under both cases. Don't relax mass-elimination's "primary-only eliminated, all true-side solved" asymmetry.
2. A candidate has at most one colour in `nodeMap`; only promotion recolours.
3. Candidate marks must be accurate: strong links and every hypothetical technique trust them (the app separately flags inaccurate candidates).
4. Plain vs Dynamic must stay disjoint per chain, and hidden single stays outside `dynamicTechniques`.
5. `extend` must stay side-effect free on `board`/`candidates` and cheap: it runs live on every board/candidate change (`useMemo` in `App`), from the solve-path search, and hundreds of times per generated puzzle. Rule 3 clones the board and reruns whole-board finders (incl. the AIC search) up to 200 iterations per call, per side, per extension move; the solve path's 4 s budget is only checked *between* steps.
6. New/changed techniques usable inside Rule 3 need: `Rule3Technique`, `ALL_RULE3_TECHNIQUES` (single source of truth, also drives the settings checkboxes), a branch in `findExtensionRule3Move`, antecedent + final clause builders, and `RULE3_TECHNIQUE_LABELS` in `App.tsx`; plus the generator lists above.

## Known issues / edge cases

Observed, not reproduced:
- **Dependency gap in explanations.** `buildRule3CombinedMove` tracks dependencies from the final technique's *basis* cells only (hidden single is the exception). A kept-worthy earlier step that only trimmed the *forced* cell (not the basis cells) is dropped, so the description / `dynamicTechniques` label can omit a technique the conclusion depended on. The colouring itself remains sound.
- Rule 1 counts only primary visibility (see above).
- `growChainFromGraph` doc says traversal "stops at an already-known node"; the code keeps traversing through known nodes (only *reporting* is filtered). This is sound, since strong links are exact-one-of relations, but the comment is wrong.
- Terminal rule 3/4/5 moves can eliminate the same candidate twice, so the summary "eliminates N candidates" can over-count (applying is idempotent).
- Contradictions in the hypothetical are ignored: `findNewlySingleCandidateCell` / `findNewlyHiddenSingleCell` skip candidates already coloured (by any colour), so "assumption A forces a candidate that B has coloured" is not used as a proof.

Unresolved from earlier work (prior conversation, from memory notes dated 2026-09-18, not re-checked): the user's worked examples for 3D Medusa rules 3-5 didn't match their claimed results (rules 1-2 did). Dragon's rules 3-5 are generalisations of those, so a fix there may need to be mirrored.

## Ideas (unverified; each changes intended semantics, so ask the user first)

- Treat an empty hypothetical cell / digit with no place in a unit as "assumed side is false" (a contradiction rule; new mass-elimination reason).
- Same for a forced candidate that is already coloured by the opposite side.
- Let Rule 1 use `seesSide` for parity with Rule 2 (or drop it as redundant with the hidden-single check).
- Extend the dependency set with the forced cell to fix the explanation gap.
- Hoist the four copies of the stuck-chain predicate into one helper.
