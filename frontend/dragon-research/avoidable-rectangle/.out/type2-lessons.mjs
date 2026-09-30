import fs from "fs";
//#region src/sudoku/boardUtils.ts
function cloneBoard(board) {
	return board.map((row) => [...row]);
}
function cloneCandidates(candidates) {
	return candidates.map((row) => row.map((cell) => [...cell]));
}
/** Which digits (1-9) are marked as candidates in a single cell. */
function markedCandidateDigits(cellCandidates) {
	const digits = [];
	for (let i = 0; i < cellCandidates.length; i++) if (cellCandidates[i]) digits.push(i + 1);
	return digits;
}
/** Placement rules shared by the solver and the puzzle generator. */
var SudokuRules = class {
	static isSafe(grid, row, col, value) {
		for (let i = 0; i < 9; i++) if (grid[row][i] === value || grid[i][col] === value) return false;
		const boxRow = Math.floor(row / 3) * 3;
		const boxCol = Math.floor(col / 3) * 3;
		for (let r = boxRow; r < boxRow + 3; r++) for (let c = boxCol; c < boxCol + 3; c++) if (grid[r][c] === value) return false;
		return true;
	}
	/**
	* Removes `digit` as a candidate from every unsolved peer of (row, col) in
	* its row, column, and box, in place. Once a digit is placed in a cell,
	* Sudoku's rules forbid it anywhere else in that row, column, or box, so
	* any leftover candidate mark for it there is stale and must be cleared -
	* otherwise later candidate-based deductions (like hidden singles) can
	* mistake that stale mark for a real possibility and solve a cell wrong.
	*/
	static eliminatePeerCandidates(candidates, board, row, col, digit) {
		const boxRow = Math.floor(row / 3) * 3;
		const boxCol = Math.floor(col / 3) * 3;
		for (let i = 0; i < 9; i++) {
			if (board[row][i] === 0) candidates[row][i][digit - 1] = false;
			if (board[i][col] === 0) candidates[i][col][digit - 1] = false;
		}
		for (let r = boxRow; r < boxRow + 3; r++) for (let c = boxCol; c < boxCol + 3; c++) if (board[r][c] === 0) candidates[r][c][digit - 1] = false;
	}
};
//#endregion
//#region src/sudoku/SudokuUnits.ts
/** Every row, column, and box, each as a list of its nine cells. The layout
* never changes, so it is built once and shared: Dynamic Dragon's simulation
* calls this inside its hottest loops (every simulated step, every finder),
* where rebuilding 27 arrays of tuples each time was a tenth of the whole
* solve-path search. Callers only read it - don't mutate what comes back. */
function sudokuUnits() {
	return cachedUnits ??= buildSudokuUnits();
}
let cachedUnits = null;
function buildSudokuUnits() {
	const units = [];
	for (let row = 0; row < 9; row++) units.push(Array.from({ length: 9 }, (_, col) => [row, col]));
	for (let col = 0; col < 9; col++) units.push(Array.from({ length: 9 }, (_, row) => [row, col]));
	for (let box = 0; box < 9; box++) {
		const boxRow = Math.floor(box / 3) * 3;
		const boxCol = box % 3 * 3;
		const cells = [];
		for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) cells.push([boxRow + dr, boxCol + dc]);
		units.push(cells);
	}
	return units;
}
//#endregion
//#region src/sudoku/SudokuAlsXzFinder.ts
/** Past this many ALS pairs one find() stops looking - a guard against a
* pathological candidate grid (Dynamic Dragon simulates on hypothetical ones),
* far above what a real position needs: a fresh autofill of a hard puzzle has
* a few hundred ALS, so tens of thousands of pairs. */
const MAX_ALS_PAIRS = 2e6;
const WORD_BITS = 27;
let cachedPeerWords = null;
/** Per cell, the 20 peers as three words. */
function peerWords() {
	if (cachedPeerWords) return cachedPeerWords;
	const words = /* @__PURE__ */ new Int32Array(243);
	for (let a = 0; a < 81; a++) {
		const ra = Math.floor(a / 9);
		const ca = a % 9;
		for (let b = 0; b < 81; b++) {
			if (a === b) continue;
			const rb = Math.floor(b / 9);
			const cb = b % 9;
			const sameBox = Math.floor(ra / 3) === Math.floor(rb / 3) && Math.floor(ca / 3) === Math.floor(cb / 3);
			if (ra === rb || ca === cb || sameBox) words[a * 3 + Math.floor(b / WORD_BITS)] |= 1 << b % WORD_BITS;
		}
	}
	return cachedPeerWords = words;
}
/**
* ALS-xz, singly linked, as defined on HoDoKu's ALS page
* (hodoku.sourceforge.net/en/tech_als.php).
*
*  - An Almost Locked Set (ALS) is N unsolved cells in one house with N+1
*    candidates between them. A single bivalue cell is an ALS (N = 1).
*    Remove any one of its digits and the rest become a locked set - N cells,
*    N digits, every digit placed somewhere in the ALS.
*  - A Restricted Common Candidate (RCC) X of two ALS A and B is a digit both
*    hold where every X in A sees every X in B. X can then be true in at most
*    one of them, so at least one of A and B loses X and is locked.
*    HoDoKu lets ALS overlap in every ALS technique, provided the overlap holds
*    no RCC - which needs no separate check here: an overlap cell holding X
*    would have to see itself.
*  - ALS-xz: take any other digit Z both hold. Whichever ALS is locked has a Z
*    in it, so Z is in A or in B, and can go from every other cell that sees
*    every Z in both. (Those cells are never in A or B themselves - see
*    Als.commonPeers.)
*
* Two ALS that fit in one house together are skipped: that is always a naked
* set, never a real ALS-xz. Inside one house any common digit outside the
* overlap is automatically an RCC, and counting digits (each ALS has one more
* digit than cells, X and Z are shared, and on a consistent grid k overlap
* cells hold at least k digits, none of them X) leaves two cases: either the
* union of the two ALS is a naked set, or the overlap cells are one on their
* own and Z is one of their digits. Either way the naked set makes every
* elimination the ALS-xz would. On a realistic grid that was nearly all of
* what this used to find (32 of 34 instances on one mid-solve position), so
* the check, one AND per pair, also saves most of the work.
*
* Only the singly linked form. A pair of ALS with two RCCs (the doubly linked
* case) is still reported here, once per RCC, each taken on its own - which
* is sound, it just leaves out the extra eliminations doubly linked ALS-XZ
* would add. ALS-XY-Wing, ALS chains and Death Blossom are not implemented.
*
* find() never mutates. Results are sorted simplest-first (fewest cells across
* both ALS, then most eliminations), and a pair whose eliminations a simpler
* pair already makes is left out - the same conclusion is typically reachable
* from several nearly identical pairs.
*/
var SudokuAlsXzFinder = class {
	find(board, candidates) {
		const allAls = this.findAllAls(board, candidates);
		const digitCandidates = /* @__PURE__ */ new Int32Array(27);
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0) continue;
			const index = row * 9 + col;
			for (let d = 0; d < 9; d++) if (candidates[row][col][d]) digitCandidates[d * 3 + Math.floor(index / WORD_BITS)] |= 1 << index % WORD_BITS;
		}
		const found = [];
		let pairsChecked = 0;
		for (let i = 0; i < allAls.length && pairsChecked < MAX_ALS_PAIRS; i++) {
			const a = allAls[i];
			for (let j = i + 1; j < allAls.length; j++) {
				const b = allAls[j];
				pairsChecked++;
				if (a.houseMask & b.houseMask) continue;
				const common = a.digitMask & b.digitMask;
				if ((common & common - 1) === 0) continue;
				for (let x = 0; x < 9; x++) {
					if (!(common & 1 << x) || !this.isRestrictedCommon(a, b, x)) continue;
					const eliminations = [];
					const zDigits = [];
					for (let z = 0; z < 9; z++) {
						if (z === x || !(common & 1 << z)) continue;
						const before = eliminations.length;
						for (let w = 0; w < 3; w++) {
							let targets = a.commonPeers[z * 3 + w] & b.commonPeers[z * 3 + w] & digitCandidates[z * 3 + w];
							while (targets) {
								const bit = 31 - Math.clz32(targets & -targets);
								targets &= targets - 1;
								const index = w * WORD_BITS + bit;
								eliminations.push({
									row: Math.floor(index / 9),
									col: index % 9,
									digit: z + 1
								});
							}
						}
						if (eliminations.length > before) zDigits.push(z + 1);
					}
					if (eliminations.length === 0) continue;
					eliminations.sort((p, q) => p.row - q.row || p.col - q.col || p.digit - q.digit);
					found.push({
						alsA: {
							cells: a.cells,
							digits: a.digits
						},
						alsB: {
							cells: b.cells,
							digits: b.digits
						},
						rcc: x + 1,
						zDigits,
						eliminations,
						reasonText: alsXzReasonText(a, b, x + 1, zDigits)
					});
				}
			}
		}
		found.sort((p, q) => p.alsA.cells.length + p.alsB.cells.length - (q.alsA.cells.length + q.alsB.cells.length) || q.eliminations.length - p.eliminations.length);
		const kept = [];
		for (const instance of found) {
			const keys = instance.eliminations.map((e) => `${e.row}.${e.col}.${e.digit}`);
			if (kept.some((k) => keys.every((key) => k.keys.has(key)))) continue;
			kept.push({
				instance,
				keys: new Set(keys)
			});
		}
		return kept.map((k) => k.instance);
	}
	/** Every X in B sees every X in A - equivalently, B's X cells all lie in
	* A's common peers for X. */
	isRestrictedCommon(a, b, x) {
		for (let w = 0; w < 3; w++) {
			const bCells = b.digitCells[x * 3 + w];
			if ((bCells & a.commonPeers[x * 3 + w]) !== bCells) return false;
		}
		return true;
	}
	/** Every ALS on the grid, each distinct cell set once (two cells of a row
	* that also share a box are found from both houses), smallest first. */
	findAllAls(board, candidates) {
		const peers = peerWords();
		const byKey = /* @__PURE__ */ new Map();
		for (const unit of sudokuUnits()) {
			const open = [];
			for (const [row, col] of unit) {
				if (board[row][col] !== 0) continue;
				let mask = 0;
				for (let d = 0; d < 9; d++) if (candidates[row][col][d]) mask |= 1 << d;
				if (mask !== 0) open.push({
					cell: [row, col],
					mask
				});
			}
			const subsetCount = 1 << open.length;
			for (let subset = 1; subset < subsetCount; subset++) {
				let digitMask = 0;
				let size = 0;
				for (let k = 0; k < open.length; k++) if (subset & 1 << k) {
					digitMask |= open[k].mask;
					size++;
				}
				if (popcount$1(digitMask) !== size + 1) continue;
				const cells = open.filter((_, k) => subset & 1 << k).map((o) => o.cell);
				cells.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
				const key = cells.map(([r, c]) => r * 9 + c).join(",");
				if (byKey.has(key)) continue;
				const digitCells = /* @__PURE__ */ new Int32Array(27);
				const commonPeers = /* @__PURE__ */ new Int32Array(27);
				for (let d = 0; d < 9; d++) if (digitMask & 1 << d) commonPeers[d * 3] = commonPeers[d * 3 + 1] = commonPeers[d * 3 + 2] = -1;
				for (const [row, col] of cells) {
					const index = row * 9 + col;
					for (let d = 0; d < 9; d++) {
						if (!candidates[row][col][d]) continue;
						digitCells[d * 3 + Math.floor(index / WORD_BITS)] |= 1 << index % WORD_BITS;
						for (let w = 0; w < 3; w++) commonPeers[d * 3 + w] &= peers[index * 3 + w];
					}
				}
				byKey.set(key, {
					cells,
					digits: bitsOf$1(digitMask).map((d) => d + 1),
					digitMask,
					houseMask: houseMaskOf(cells),
					digitCells,
					commonPeers
				});
			}
		}
		return [...byKey.values()].sort((p, q) => p.cells.length - q.cells.length);
	}
};
function houseMaskOf(cells) {
	const [row, col] = cells[0];
	const box = Math.floor(row / 3) * 3 + Math.floor(col / 3);
	let mask = 0;
	if (cells.every(([r]) => r === row)) mask |= 1 << row;
	if (cells.every(([, c]) => c === col)) mask |= 1 << 9 + col;
	if (cells.every(([r, c]) => Math.floor(r / 3) * 3 + Math.floor(c / 3) === box)) mask |= 1 << 18 + box;
	return mask;
}
function alsLabel(als) {
	return `{${als.digits.join(",")}} at ${als.cells.map(([row, col]) => `r${row + 1}c${col + 1}`).join(", ")}`;
}
function alsXzReasonText(a, b, rcc, zDigits) {
	const zLabel = zDigits.length === 1 ? `${zDigits[0]} must be in one of them` : `${zDigits.slice(0, -1).join(", ")} and ${zDigits[zDigits.length - 1]} must each be in one of them`;
	return `ALS A ${alsLabel(a)} and ALS B ${alsLabel(b)} are linked by RCC digit ${rcc} (every ${rcc} in A sees every ${rcc} in B, so at most one of them holds ${rcc} and the other is locked), so ${zLabel}`;
}
function popcount$1(mask) {
	let count = 0;
	for (let m = mask; m; m &= m - 1) count++;
	return count;
}
function bitsOf$1(mask) {
	const bits = [];
	for (let x = 0; x < 9; x++) if (mask & 1 << x) bits.push(x);
	return bits;
}
//#endregion
//#region src/sudoku/SudokuAvoidableRectangleFinder.ts
const boxOf$2 = (row, col) => Math.floor(row / 3) * 3 + Math.floor(col / 3);
const cellRef$3 = ([row, col]) => `r${row + 1}c${col + 1}`;
const sees$1 = (a, b) => a[0] === b[0] || a[1] === b[1] || boxOf$2(a[0], a[1]) === boxOf$2(b[0], b[1]);
/**
* Avoidable Rectangles: a Unique Rectangle some of whose cells are already
* solved. Four cells spanning exactly two rows, two columns and two boxes,
* holding A, B, A, B round the rectangle, could swap A and B and the grid
* would stay valid - a second solution, unless one of the four is a given.
* So if the solved corners are *solved by the solver, not givens*, the
* unsolved ones must not complete the pattern.
*
* - Type 1 (SudokuWiki's "Avoidable Rectangle", HoDoKu's Type 1): three
*   corners solved, the same digit A on two diagonal ones and B on the
*   third. The fourth corner can't be B.
* - Type 2 (HoDoKu's Type 2, the UR Type 2 analogue): two corners side by
*   side solved as A and B; each of the other two holds only the digit that
*   would complete the pattern (the one on its diagonal) plus the same extra
*   candidate X. One of them must be X, so X goes from every cell seeing
*   both. (Side by side, as HoDoKu's examples have it: the unsolved pair
*   shares a row or column.)
*
* This is the one technique that needs to know which cells are givens: the
* same rectangle with a given corner is no contradiction at all - the given
* is what stops the swap - so it must never be treated as solved. Callers
* without a givens mask (null) get nothing rather than a wrong answer.
*
* Only the 4-cell patterns, by request - not the extended (6+ cell) forms.
*/
var SudokuAvoidableRectangleFinder = class {
	find(board, candidates, givens) {
		if (!givens) return [];
		const solvedNonGiven = ([row, col]) => board[row][col] !== 0 && !givens[row][col];
		const value = ([row, col]) => board[row][col];
		const type1 = [];
		const type2 = [];
		for (let r1 = 0; r1 < 9; r1++) for (let r2 = r1 + 1; r2 < 9; r2++) for (let c1 = 0; c1 < 9; c1++) for (let c2 = c1 + 1; c2 < 9; c2++) {
			if ((/* @__PURE__ */ new Set([
				boxOf$2(r1, c1),
				boxOf$2(r1, c2),
				boxOf$2(r2, c1),
				boxOf$2(r2, c2)
			])).size !== 2) continue;
			const cells = [
				[r1, c1],
				[r1, c2],
				[r2, c2],
				[r2, c1]
			];
			const unsolved = [
				0,
				1,
				2,
				3
			].filter((i) => board[cells[i][0]][cells[i][1]] === 0);
			if (!cells.every((cell, i) => unsolved.includes(i) || solvedNonGiven(cell))) continue;
			if (unsolved.length === 1) {
				const found = this.type1(cells, unsolved[0], value, candidates);
				if (found) type1.push(found);
			} else if (unsolved.length === 2) {
				const found = this.type2(cells, unsolved, value, board, candidates);
				if (found) type2.push(found);
			}
		}
		return [...type1, ...type2];
	}
	type1(cells, u, value, candidates) {
		const target = cells[u];
		const opposite = cells[(u + 2) % 4];
		const pairA = cells[(u + 1) % 4];
		const pairB = cells[(u + 3) % 4];
		const pairDigit = value(pairA);
		const digit = value(opposite);
		if (value(pairB) !== pairDigit || digit === pairDigit || !candidates[target[0]][target[1]][digit - 1]) return null;
		return {
			type: 1,
			cells,
			digits: pairDigit < digit ? [pairDigit, digit] : [digit, pairDigit],
			solvedCells: [
				pairA,
				opposite,
				pairB
			],
			eliminations: [{
				row: target[0],
				col: target[1],
				digit
			}],
			extraDigit: null,
			reasonText: `where ${cellRef$3(pairA)} and ${cellRef$3(pairB)} are ${pairDigit} and ${cellRef$3(opposite)} is ${digit} (solved, not givens)`
		};
	}
	type2(cells, unsolved, value, board, candidates) {
		const [i, j] = unsolved;
		if (j - i === 2) return null;
		const needs = unsolved.map((k) => value(cells[(k + 2) % 4]));
		if (needs[0] === needs[1]) return null;
		let extraDigit = 0;
		for (const [n, k] of unsolved.entries()) {
			const [row, col] = cells[k];
			const marks = candidates[row][col].flatMap((on, d) => on ? [d + 1] : []);
			const extra = marks.filter((d) => d !== needs[n]);
			if (marks.length !== 2 || extra.length !== 1 || extraDigit !== 0 && extra[0] !== extraDigit) return null;
			extraDigit = extra[0];
		}
		const [a, b] = unsolved.map((k) => cells[k]);
		const eliminations = [];
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			const cell = [row, col];
			if (board[row][col] !== 0 || !candidates[row][col][extraDigit - 1] || cells.some(([r, c]) => r === row && c === col)) continue;
			if (sees$1(cell, a) && sees$1(cell, b)) eliminations.push({
				row,
				col,
				digit: extraDigit
			});
		}
		if (eliminations.length === 0) return null;
		const solved = [
			0,
			1,
			2,
			3
		].filter((k) => !unsolved.includes(k)).map((k) => cells[k]);
		const [s1, s2] = solved;
		return {
			type: 2,
			cells,
			digits: [value(s1), value(s2)].sort((x, y) => x - y),
			solvedCells: solved,
			eliminations,
			extraDigit,
			reasonText: `where ${cellRef$3(s1)} is ${value(s1)} and ${cellRef$3(s2)} is ${value(s2)} (solved, not givens) and ${cellRef$3(a)} {${[needs[0], extraDigit].sort().join(",")}} and ${cellRef$3(b)} {${[needs[1], extraDigit].sort().join(",")}} would complete the rectangle unless one of them is ${extraDigit}`
		};
	}
};
const DIGITS$1 = [
	1,
	2,
	3,
	4,
	5,
	6,
	7,
	8,
	9
];
/** Safety nets against a pathological candidate grid (hand-painted, or from
* a bug elsewhere) rather than anything a real solve reaches: a *valid*
* board's candidates never come close to either limit - real puzzles have
* only a handful of cells eligible for any one digit pair. Without them, a
* grid where most cells are pure bivalue for the same pair (so nearly every
* cell is mutually "adjacent" to 15-20 others) turns simple-cycle
* enumeration catastrophic: this finder runs on every board/candidate
* change, so it must return quickly regardless of what candidates it's
* handed, not just on realistic ones. */
/** A pair with more eligible cells than this is skipped outright - cheap to
* check before ever building its graph. */
const MAX_NODES_PER_PAIR = 40;
/** Total DFS edge-visits allowed across the *entire* find() call, all pairs
* combined - once hit, the search stops early and returns whatever it has
* found so far, rather than search further. */
const MAX_SEARCH_STEPS = 3e5;
function sameUnit$5(a, b) {
	const [ar, ac] = a;
	const [br, bc] = b;
	if (ar === br || ac === bc) return true;
	return Math.floor(ar / 3) === Math.floor(br / 3) && Math.floor(ac / 3) === Math.floor(bc / 3);
}
/**
* Bivalue Oddagon (a "Deadly Loop"): an odd number (5, 7, 9, ...) of bivalue
* cells, all holding the exact same two candidates, arranged in a loop where
* each cell shares a unit (row, column, or box) with the next. In any actual
* solution, two cells sharing a unit can't hold the same digit - so if every
* loop cell really did resolve to one of just the two loop digits, walking
* the loop would have to alternate them, cell by cell. An *even* loop
* returns to a consistent assignment; an *odd* one doesn't - the last cell
* would need to be both digits at once. A valid Sudoku always has a
* solution, so an odd loop that's *entirely* pure bivalue can never actually
* occur - somewhere in it, at least one cell's real solution must be
* something other than the two loop digits.
*
* That "somewhere" is only usable as a deduction when it's narrowed down to
* one or a few candidates: a cell in the loop holding one extra candidate
* beyond the pair (a "guardian", since it's what stops the loop being
* deadly) is exactly that escape hatch.
*  - **Type 1**: exactly one guardian cell. It's the *only* place the loop
*    can break, so its extra candidate must be its solution (eliminate the
*    two loop digits from it, same as Unique Rectangle Type 1).
*  - **Type 2**: two or three guardian cells, all sharing the *same* extra
*    candidate. That candidate is confined to being the solution of
*    whichever one of them breaks the loop - "locked" between them - so it
*    can be eliminated from any other cell that sees every guardian cell,
*    same reasoning as a naked pair/triple.
*
* Search: for each of the 36 digit pairs, build a small graph of that pair's
* pure and guardian cells (edges = sharing a unit) and depth-first search
* for simple cycles up to `maxLength`, allowing at most 3 guardian cells per
* path and requiring them to share one extra digit. Real puzzles have very
* few cells eligible for any one pair, so this graph is tiny in practice;
* only the search depth is bounded to keep a worst case bounded too.
*/
var SudokuBivalueOddagonFinder = class {
	find(board, candidates, maxLength = 15) {
		const limit = maxLength % 2 === 0 ? maxLength - 1 : maxLength;
		if (limit < 5) return [];
		const instances = [];
		const seen = /* @__PURE__ */ new Set();
		const budget = { stepsLeft: MAX_SEARCH_STEPS };
		outer: for (let ai = 0; ai < DIGITS$1.length - 1; ai++) for (let bi = ai + 1; bi < DIGITS$1.length; bi++) {
			const a = DIGITS$1[ai];
			const b = DIGITS$1[bi];
			const nodes = this.eligibleNodes(board, candidates, a, b);
			if (nodes.length < 5 || nodes.length > MAX_NODES_PER_PAIR) continue;
			this.findLoopsForPair(board, candidates, [a, b], nodes, limit, instances, seen, budget);
			if (budget.stepsLeft <= 0) break outer;
		}
		return this.pickBestPerOutcome(instances);
	}
	/** Different loops (different pure cells filling out the rest of the
	* cycle) can reach the exact same conclusion - same cell solved, or the
	* same set of candidates eliminated. Keeps only the shortest (simplest)
	* loop per distinct conclusion, the same "most elegant explanation wins"
	* rule Short AIC's pickBestPerEliminationSet applies. */
	pickBestPerOutcome(instances) {
		const bestByOutcome = /* @__PURE__ */ new Map();
		for (const instance of instances) {
			const key = instance.type === 1 ? `solve:${instance.solvedCell[0]}.${instance.solvedCell[1]}.${instance.guardianDigit}` : `elim:${instance.eliminations.map((e) => `${e.row}.${e.col}.${e.digit}`).sort().join("|")}`;
			const current = bestByOutcome.get(key);
			if (!current || instance.cells.length < current.cells.length) bestByOutcome.set(key, instance);
		}
		return Array.from(bestByOutcome.values());
	}
	/** Every unsolved cell holding both `a` and `b` as candidates, with
	* nothing else marked but at most one further digit. */
	eligibleNodes(board, candidates, a, b) {
		const nodes = [];
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0) continue;
			const digits = markedCandidateDigits(candidates[row][col]);
			if (!digits.includes(a) || !digits.includes(b)) continue;
			if (digits.length === 2) nodes.push({
				cell: [row, col],
				extraDigit: null
			});
			else if (digits.length === 3) nodes.push({
				cell: [row, col],
				extraDigit: digits.find((d) => d !== a && d !== b)
			});
		}
		return nodes;
	}
	findLoopsForPair(board, candidates, loopDigits, nodes, maxLength, out, seen, budget) {
		const n = nodes.length;
		const adjacency = nodes.map((node, i) => nodes.flatMap((other, j) => i !== j && sameUnit$5(node.cell, other.cell) ? [j] : []));
		const path = [];
		const inPath = new Array(n).fill(false);
		let extraDigit = null;
		let guardianCount = 0;
		/** Registers `index`'s own guardian status (a no-op if it's a pure
		* cell) before it's added to the path, honouring the "at most 3, all
		* the same extra digit" rule - returns whether it was allowed on. */
		const tryEnterGuardian = (index) => {
			const extra = nodes[index].extraDigit;
			if (extra === null) return true;
			if (guardianCount >= 3 || extraDigit !== null && extraDigit !== extra) return false;
			extraDigit = extra;
			guardianCount++;
			return true;
		};
		const exitGuardian = (index) => {
			if (nodes[index].extraDigit === null) return;
			guardianCount--;
			if (guardianCount === 0) extraDigit = null;
		};
		const visit = (current, startIndex) => {
			for (const next of adjacency[current]) {
				if (budget.stepsLeft-- <= 0) return;
				if (next === startIndex) {
					if (path.length >= 5 && path.length % 2 === 1) this.reportLoop(board, candidates, loopDigits, nodes, path, out, seen);
					continue;
				}
				if (inPath[next] || next < startIndex) continue;
				if (!tryEnterGuardian(next)) continue;
				if (path.length < maxLength) {
					path.push(next);
					inPath[next] = true;
					visit(next, startIndex);
					inPath[next] = false;
					path.pop();
				}
				exitGuardian(next);
			}
		};
		for (let start = 0; start < n; start++) {
			if (budget.stepsLeft <= 0) return;
			if (!tryEnterGuardian(start)) continue;
			path.push(start);
			inPath[start] = true;
			visit(start, start);
			inPath[start] = false;
			path.pop();
			exitGuardian(start);
		}
	}
	reportLoop(board, candidates, loopDigits, nodes, path, out, seen) {
		const loopNodes = path.map((i) => nodes[i]);
		const guardians = loopNodes.filter((node) => node.extraDigit !== null);
		if (guardians.length === 0) return;
		const guardianDigit = guardians[0].extraDigit;
		const cells = loopNodes.map((node) => node.cell);
		const guardianCells = guardians.map((node) => node.cell);
		const key = `${loopDigits.join(",")}|${guardianDigit}|${[...cells].map(([r, c]) => `${r}.${c}`).sort().join("-")}`;
		if (seen.has(key)) return;
		seen.add(key);
		if (guardianCells.length === 1) {
			out.push({
				type: 1,
				loopDigits,
				cells,
				guardianCells,
				guardianDigit,
				solvedCell: guardianCells[0],
				eliminations: []
			});
			return;
		}
		const loopCellKeys = new Set(cells.map(([r, c]) => `${r},${c}`));
		const eliminations = [];
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0 || loopCellKeys.has(`${row},${col}`)) continue;
			if (!candidates[row][col][guardianDigit - 1]) continue;
			if (guardianCells.every(([gr, gc]) => sameUnit$5([row, col], [gr, gc]))) eliminations.push({
				row,
				col,
				digit: guardianDigit
			});
		}
		if (eliminations.length === 0) return;
		out.push({
			type: 2,
			loopDigits,
			cells,
			guardianCells,
			guardianDigit,
			solvedCell: null,
			eliminations
		});
	}
};
//#endregion
//#region src/sudoku/SudokuBugPlusOneFinder.ts
/** Which kind of unit a set of cells belongs to - used to say "row",
* "column", or "box" instead of the vaguer "section". */
function classifyUnitKind$1(cells) {
	if (cells.every(([r]) => r === cells[0][0])) return "row";
	if (cells.every(([, c]) => c === cells[0][1])) return "column";
	return "box";
}
/**
* BUG+1 (Bivalue Universal Grave + 1): a grid where every unsolved cell is
* bivalue except exactly one, which holds three candidates, is one step
* short of a "BUG" - a deadly pattern where every digit's remaining
* candidates pair up two-to-a-cell across every row, column, and box it
* touches, so any of those pairs could swap and the grid would still look
* consistent. A valid Sudoku always has exactly one solution, so a puzzle
* can never actually reach a state where *every* cell is bivalue - the one
* cell with a third candidate is what keeps this position out of that
* deadly pattern, and its solution must be whichever of its three
* candidates is what breaks the pattern.
*
* In a true BUG, a digit's candidates always come in pairs within any one
* unit (0 or 2 of them, never 1 - that would already be a hidden single -
* and never an odd number beyond that). The lone tri-value cell adds one
* extra instance of its third candidate to each of its row, column, and
* box; whichever of those three units already had exactly two other cells
* holding that digit now shows three, an odd count a real BUG can't have -
* so that candidate is what the grid is actually resolving to, and it's the
* cell's solution.
*/
var SudokuBugPlusOneFinder = class {
	find(board, candidates) {
		let triValueCell = null;
		let triValueDigits = null;
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0) continue;
			const digits = markedCandidateDigits(candidates[row][col]);
			if (digits.length === 2) continue;
			if (digits.length !== 3 || triValueCell) return null;
			triValueCell = [row, col];
			triValueDigits = digits;
		}
		if (!triValueCell || !triValueDigits) return null;
		for (const unit of sudokuUnits()) {
			if (!unit.some(([r, c]) => r === triValueCell[0] && c === triValueCell[1])) continue;
			for (const digit of triValueDigits) if (unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1]).length === 3) return {
				cell: triValueCell,
				candidates: triValueDigits,
				solvedDigit: digit,
				unit,
				unitKind: classifyUnitKind$1(unit)
			};
		}
		return null;
	}
};
//#endregion
//#region src/sudoku/SudokuColorFinder.ts
function cellKey$3(row, col) {
	return `${row},${col}`;
}
function sameUnit$4(a, b) {
	const [ar, ac] = a;
	const [br, bc] = b;
	if (ar === br || ac === bc) return true;
	return Math.floor(ar / 3) === Math.floor(br / 3) && Math.floor(ac / 3) === Math.floor(bc / 3);
}
/**
* Simple Coloring: for one digit, builds the graph of strong links
* (conjugate pairs) between its candidate cells, splits it into connected
* chains, and 2-colors each chain - adjacent cells always take opposite
* colors, since a strong link between two candidate cells in a unit is a
* biconditional (the unit needs the digit placed somewhere, and only these
* two cells can hold it, so exactly one of them is true).
*/
var SudokuColorFinder = class {
	findChains(board, candidates, digit) {
		const adjacency = /* @__PURE__ */ new Map();
		const cellByKey = /* @__PURE__ */ new Map();
		const edgeKeys = /* @__PURE__ */ new Set();
		const addEdge = (a, b) => {
			const ka = cellKey$3(a[0], a[1]);
			const kb = cellKey$3(b[0], b[1]);
			const edgeKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
			if (edgeKeys.has(edgeKey)) return;
			edgeKeys.add(edgeKey);
			cellByKey.set(ka, a);
			cellByKey.set(kb, b);
			if (!adjacency.has(ka)) adjacency.set(ka, []);
			if (!adjacency.has(kb)) adjacency.set(kb, []);
			adjacency.get(ka).push(b);
			adjacency.get(kb).push(a);
		};
		for (const unit of sudokuUnits()) {
			const withCandidate = unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1]);
			if (withCandidate.length === 2) addEdge(withCandidate[0], withCandidate[1]);
		}
		const visited = /* @__PURE__ */ new Set();
		const chains = [];
		for (const startKey of adjacency.keys()) {
			if (visited.has(startKey)) continue;
			const colorMap = /* @__PURE__ */ new Map();
			const componentKeys = [startKey];
			const queue = [startKey];
			colorMap.set(startKey, "blue");
			visited.add(startKey);
			let consistent = true;
			while (queue.length > 0) {
				const currentKey = queue.shift();
				const nextColor = colorMap.get(currentKey) === "blue" ? "yellow" : "blue";
				for (const neighbor of adjacency.get(currentKey) ?? []) {
					const neighborKey = cellKey$3(neighbor[0], neighbor[1]);
					if (!colorMap.has(neighborKey)) {
						colorMap.set(neighborKey, nextColor);
						visited.add(neighborKey);
						componentKeys.push(neighborKey);
						queue.push(neighborKey);
					} else if (colorMap.get(neighborKey) !== nextColor) consistent = false;
				}
			}
			if (!consistent || componentKeys.length < 2) continue;
			const cells = componentKeys.map((key) => {
				const [row, col] = cellByKey.get(key);
				return {
					row,
					col,
					color: colorMap.get(key)
				};
			});
			chains.push({
				digit,
				cells
			});
		}
		return chains;
	}
	/** Rule 1: two same-colored cells sharing a unit means that color can't be
	* true everywhere (the digit would repeat in that unit), so it's false
	* throughout the chain and the other color is true throughout. */
	findRule1(chain) {
		for (const color of ["blue", "yellow"]) {
			const cellsOfColor = chain.cells.filter((c) => c.color === color);
			if (cellsOfColor.some((cellA, i) => cellsOfColor.slice(i + 1).some((cellB) => sameUnit$4([cellA.row, cellA.col], [cellB.row, cellB.col])))) {
				const trueColor = color === "blue" ? "yellow" : "blue";
				return {
					digit: chain.digit,
					chain,
					falseColor: color,
					trueColor,
					solvedCells: chain.cells.filter((c) => c.color === trueColor).map((c) => [c.row, c.col])
				};
			}
		}
		return null;
	}
	/** Rule 2: an uncolored cell that can see a cell of both colors can't be
	* the digit either way - whichever color turns out true, it's eliminated
	* by a cell it shares a unit with. */
	findRule2(chain, board, candidates) {
		const digit = chain.digit;
		const chainKeys = new Set(chain.cells.map((c) => cellKey$3(c.row, c.col)));
		const blueCells = chain.cells.filter((c) => c.color === "blue");
		const yellowCells = chain.cells.filter((c) => c.color === "yellow");
		const eliminated = [];
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0 || !candidates[row][col][digit - 1]) continue;
			if (chainKeys.has(cellKey$3(row, col))) continue;
			const seesBlue = blueCells.some((b) => sameUnit$4([row, col], [b.row, b.col]));
			const seesYellow = yellowCells.some((y) => sameUnit$4([row, col], [y.row, y.col]));
			if (seesBlue && seesYellow) eliminated.push([row, col]);
		}
		return eliminated.length > 0 ? {
			digit,
			chain,
			eliminatedCells: eliminated
		} : null;
	}
};
//#endregion
//#region src/sudoku/SudokuFishFinder.ts
const ALL_FISH_TECHNIQUES = [
	"x-wing",
	"finned x-wing",
	"swordfish",
	"finned swordfish"
];
const FISH_TECHNIQUE_NAMES = {
	"x-wing": "X-Wing",
	"finned x-wing": "Finned X-Wing",
	swordfish: "Swordfish",
	"finned swordfish": "Finned Swordfish"
};
/**
* X-Wing, Swordfish and their finned forms, for one digit at a time.
*
* Internally this is the general base/cover set formulation of fish (as on
* HoDoKu's fish pages), kept out of every user-facing string on purpose - the
* app explains fish in the traditional "rows confined to columns" terms:
*  - Base sets: n rows (or n columns). Every candidate of the digit in them
*    is a base candidate. Each base set holds exactly one true digit, so the
*    n base sets together hold exactly n.
*  - Cover sets: n columns (or rows). Each holds at most one true digit, so
*    if every base candidate lies in some cover set, the n true base digits
*    use up every cover set - no other candidate of the digit in a cover set
*    can be true.
*  - Fins: base candidates in no cover set. If some fin is true the argument
*    above breaks, so only cover candidates that see *every* fin can go
*    (either the fish holds, or a fin is true and removes them directly).
*
* evaluateFish is that rule, written generically over whichever houses are
* passed in; the enumeration below only picks which rows/columns to try,
* using bitmasks to skip combinations that can't produce a fish before
* paying for evaluateFish.
*
* Validity rules on top of the logic itself (the logic alone would accept
* degenerate patterns that are really something simpler):
*  - Every base set has at least 2 candidates (1 is a hidden single).
*  - Every base set keeps at least 2 candidates inside the cover sets once
*    the fins are set aside - otherwise the fin-less remainder is degenerate
*    and the fish is Sashimi, not (yet) implemented. For a basic fish this is
*    the same as the rule above.
*  - Every cover set holds at least one base candidate.
*  - It eliminates something.
*
* Fins only ever lead to an elimination when they share a box: cells seeing
* fins in different boxes of one base row are only in that row, and those
* seeing fins in two different rows and boxes are base cells themselves. So
* a finned fish's uncovered columns must fit in one band of three, which is
* what the enumeration prunes on; evaluateFish still does the exact check.
*
* find() never mutates, and returns results sorted simplest-technique-first
* then by digit; the same technique+digit+eliminations is only reported once
* (a fish in rows and one in columns, or two different cover choices, can
* prove exactly the same thing).
*/
var SudokuFishFinder = class {
	find(board, candidates) {
		const out = [];
		const seen = /* @__PURE__ */ new Set();
		for (const technique of ALL_FISH_TECHNIQUES) {
			const size = technique === "x-wing" || technique === "finned x-wing" ? 2 : 3;
			const finned = technique === "finned x-wing" || technique === "finned swordfish";
			for (let digit = 1; digit <= 9; digit++) for (const lineKind of ["row", "col"]) for (const instance of this.findForDigit(board, candidates, digit, lineKind, size, finned, technique)) {
				const key = `${technique}|${digit}|${instance.eliminations.map((e) => `${e.row}.${e.col}`).join(",")}`;
				if (seen.has(key)) continue;
				seen.add(key);
				out.push(instance);
			}
		}
		return out;
	}
	findForDigit(board, candidates, digit, lineKind, size, finned, technique) {
		const cellAt = (line, cross) => lineKind === "row" ? [line, cross] : [cross, line];
		const masks = [];
		for (let line = 0; line < 9; line++) {
			let mask = 0;
			for (let cross = 0; cross < 9; cross++) {
				const [row, col] = cellAt(line, cross);
				if (board[row][col] === 0 && candidates[row][col][digit - 1]) mask |= 1 << cross;
			}
			masks.push(mask);
		}
		const maxPerLine = finned ? size + 3 : size;
		const eligible = masks.map((mask, line) => ({
			mask,
			line
		})).filter(({ mask }) => popcount(mask) >= 2 && popcount(mask) <= maxPerLine).map(({ line }) => line);
		const results = [];
		for (const lines of combinations(eligible, size)) {
			const union = lines.reduce((acc, line) => acc | masks[line], 0);
			const unionSize = popcount(union);
			const coverChoices = [];
			if (!finned) {
				if (unionSize === size) coverChoices.push(union);
			} else if (unionSize > size && unionSize <= size + 3) for (const cover of combinations(bitsOf(union), size)) {
				const coverMask = cover.reduce((acc, x) => acc | 1 << x, 0);
				if (bandsOf(union & ~coverMask) === 1) coverChoices.push(coverMask);
			}
			for (const coverMask of coverChoices) {
				if (lines.some((line) => popcount(masks[line] & coverMask) < 2)) continue;
				const crossLines = bitsOf(coverMask);
				const evaluated = evaluateFish(board, candidates, digit, lines.map((index) => ({
					kind: lineKind,
					index
				})), crossLines.map((index) => ({
					kind: lineKind === "row" ? "col" : "row",
					index
				})));
				if (!evaluated || evaluated.eliminations.length === 0 || evaluated.fins.length > 0 !== finned) continue;
				results.push({
					technique,
					digit,
					lineKind,
					lines,
					crossLines,
					cells: evaluated.baseCells,
					fins: evaluated.fins,
					eliminations: evaluated.eliminations,
					reasonText: fishReasonText(digit, lineKind, lines, crossLines, evaluated.fins)
				});
			}
		}
		return results;
	}
};
function houseContains(house, [row, col]) {
	switch (house.kind) {
		case "row": return row === house.index;
		case "col": return col === house.index;
		case "box": return boxOf$1(row, col) === house.index;
	}
}
const houseCellsCache = /* @__PURE__ */ new Map();
function houseCells(house) {
	const cacheKey = `${house.kind}${house.index}`;
	const cached = houseCellsCache.get(cacheKey);
	if (cached) return cached;
	const cells = [];
	for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) if (houseContains(house, [row, col])) cells.push([row, col]);
	houseCellsCache.set(cacheKey, cells);
	return cells;
}
function boxOf$1(row, col) {
	return Math.floor(row / 3) * 3 + Math.floor(col / 3);
}
function sees([r1, c1], [r2, c2]) {
	return (r1 !== r2 || c1 !== c2) && (r1 === r2 || c1 === c2 || boxOf$1(r1, c1) === boxOf$1(r2, c2));
}
/** The base/cover fish rule for one digit (see the class comment): null when
* some base or cover set holds no base candidate, otherwise the base
* candidates, the fins among them, and every cover candidate that isn't a
* base candidate and sees all the fins. General over any houses, although
* the finder only ever passes rows and columns. */
function evaluateFish(board, candidates, digit, bases, covers) {
	const holds = ([row, col]) => board[row][col] === 0 && candidates[row][col][digit - 1];
	const key = ([row, col]) => row * 9 + col;
	const baseByKey = /* @__PURE__ */ new Map();
	for (const base of bases) {
		const own = houseCells(base).filter(holds);
		if (own.length === 0) return null;
		for (const cell of own) baseByKey.set(key(cell), cell);
	}
	const baseCells = [...baseByKey.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	if (covers.some((cover) => !baseCells.some((cell) => houseContains(cover, cell)))) return null;
	const fins = baseCells.filter((cell) => !covers.some((cover) => houseContains(cover, cell)));
	const eliminationByKey = /* @__PURE__ */ new Map();
	for (const cover of covers) for (const cell of houseCells(cover)) {
		if (!holds(cell) || baseByKey.has(key(cell)) || !fins.every((fin) => sees(cell, fin))) continue;
		eliminationByKey.set(key(cell), {
			row: cell[0],
			col: cell[1],
			digit
		});
	}
	return {
		baseCells,
		fins,
		eliminations: [...eliminationByKey.values()].sort((a, b) => a.row - b.row || a.col - b.col)
	};
}
function fishReasonText(digit, lineKind, lines, crossLines, fins) {
	const lineWord = lineKind === "row" ? "rows" : "columns";
	const crossWord = lineKind === "row" ? "columns" : "rows";
	const base = `${digit} in ${lineWord} ${joinNumbers(lines)} is confined to ${crossWord} ${joinNumbers(crossLines)}`;
	if (fins.length === 0) return base;
	const finsLabel = fins.map(([row, col]) => `r${row + 1}c${col + 1}`).join(", ");
	return `${base}, apart from the fin${fins.length === 1 ? "" : "s"} at ${finsLabel}`;
}
function joinNumbers(indices) {
	const labels = indices.map((i) => `${i + 1}`);
	return labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
function popcount(mask) {
	let count = 0;
	for (let m = mask; m; m &= m - 1) count++;
	return count;
}
function bitsOf(mask) {
	const bits = [];
	for (let x = 0; x < 9; x++) if (mask & 1 << x) bits.push(x);
	return bits;
}
/** How many bands of three (columns 1-3, 4-6, 7-9, or the same for rows) a
* mask touches. */
function bandsOf(mask) {
	let bands = 0;
	for (let band = 0; band < 3; band++) if (mask & 7 << band * 3) bands++;
	return bands;
}
function* combinations(items, k, start = 0, prefix = []) {
	if (prefix.length === k) {
		yield [...prefix];
		return;
	}
	for (let i = start; i <= items.length - (k - prefix.length); i++) {
		prefix.push(items[i]);
		yield* combinations(items, k, i + 1, prefix);
		prefix.pop();
	}
}
//#endregion
//#region src/sudoku/SudokuHiddenPairFinder.ts
/**
* Hidden pairs: when two candidate digits, within a single row, column, or
* box, are only ever marked in the same two cells and nowhere else in that
* unit, those two cells must be those two digits, in some order - so every
* other candidate still marked in those two cells can be eliminated, even
* though the cells themselves keep showing marks beyond just the pair until
* that happens. A unit where both cells already show only the pair's two
* digits (nothing to eliminate) is a naked pair, not a hidden one, and is
* left to SudokuPairFinder instead.
*/
var SudokuHiddenPairFinder = class {
	findHiddenPairs(board, candidates) {
		const seen = /* @__PURE__ */ new Set();
		const instances = [];
		for (const unit of sudokuUnits()) {
			const digitCells = Array.from({ length: 9 }, () => []);
			for (const [row, col] of unit) {
				if (board[row][col] !== 0) continue;
				for (const digit of markedCandidateDigits(candidates[row][col])) digitCells[digit - 1].push([row, col]);
			}
			for (let d1 = 1; d1 <= 9; d1++) {
				const cellsA = digitCells[d1 - 1];
				if (cellsA.length !== 2) continue;
				for (let d2 = d1 + 1; d2 <= 9; d2++) {
					const cellsB = digitCells[d2 - 1];
					if (cellsB.length !== 2 || !sameCells(cellsA, cellsB)) continue;
					const eliminations = [];
					for (const [row, col] of cellsA) for (const digit of markedCandidateDigits(candidates[row][col])) if (digit !== d1 && digit !== d2) eliminations.push({
						row,
						col,
						digit
					});
					if (eliminations.length === 0) continue;
					const key = `${cellsA[0][0]}.${cellsA[0][1]}-${cellsA[1][0]}.${cellsA[1][1]}|${d1},${d2}`;
					if (seen.has(key)) continue;
					seen.add(key);
					instances.push({
						cells: [cellsA[0], cellsA[1]],
						digits: [d1, d2],
						eliminations
					});
				}
			}
		}
		return instances;
	}
	findHiddenPairEliminations(board, candidates) {
		const eliminations = /* @__PURE__ */ new Map();
		for (const pair of this.findHiddenPairs(board, candidates)) for (const elimination of pair.eliminations) eliminations.set(`${elimination.row},${elimination.col},${elimination.digit}`, elimination);
		return Array.from(eliminations.values());
	}
};
/** Whether two same-length cell lists built by walking the same `unit`
* array (so equal-valued lists are also equal-ordered) refer to the same
* two cells. */
function sameCells(a, b) {
	return a[0][0] === b[0][0] && a[0][1] === b[0][1] && a[1][0] === b[1][0] && a[1][1] === b[1][1];
}
//#endregion
//#region src/sudoku/SudokuLockedCandidateFinder.ts
/**
* Locked Candidates, in its two forms:
*  - Pointing: within a box, if every remaining candidate for a digit sits
*    in a single row (or column), that digit can't be the solution to any
*    other cell of that row (or column) outside the box, since one of the
*    box's own cells must hold it.
*  - Claiming: within a row (or column), if every remaining candidate for a
*    digit sits in a single box, that digit can't be the solution to any
*    other cell of that box, since one of the row's (or column's) own
*    cells must hold it.
*/
var SudokuLockedCandidateFinder = class {
	findPointingInstances(board, candidates) {
		const instances = [];
		for (let boxRow = 0; boxRow < 3; boxRow++) for (let boxCol = 0; boxCol < 3; boxCol++) {
			const boxCells = [];
			for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
				const row = boxRow * 3 + dr;
				const col = boxCol * 3 + dc;
				if (board[row][col] === 0) boxCells.push([row, col]);
			}
			for (let digit = 1; digit <= 9; digit++) {
				const holders = boxCells.filter(([row, col]) => candidates[row][col][digit - 1]);
				if (holders.length < 2) continue;
				const rows = new Set(holders.map(([row]) => row));
				const cols = new Set(holders.map(([, col]) => col));
				if (rows.size === 1) {
					const [row] = rows;
					const eliminations = [];
					for (let col = 0; col < 9; col++) {
						if (Math.floor(col / 3) === boxCol) continue;
						if (candidates[row][col][digit - 1]) eliminations.push({
							row,
							col,
							digit
						});
					}
					if (eliminations.length > 0) instances.push({
						type: "pointing",
						digit,
						basisCells: holders,
						eliminations
					});
				}
				if (cols.size === 1) {
					const [col] = cols;
					const eliminations = [];
					for (let row = 0; row < 9; row++) {
						if (Math.floor(row / 3) === boxRow) continue;
						if (candidates[row][col][digit - 1]) eliminations.push({
							row,
							col,
							digit
						});
					}
					if (eliminations.length > 0) instances.push({
						type: "pointing",
						digit,
						basisCells: holders,
						eliminations
					});
				}
			}
		}
		return instances;
	}
	findClaimingInstances(board, candidates) {
		const instances = [];
		for (let row = 0; row < 9; row++) {
			const rowCells = [];
			for (let col = 0; col < 9; col++) if (board[row][col] === 0) rowCells.push([row, col]);
			for (let digit = 1; digit <= 9; digit++) {
				const holders = rowCells.filter(([, col]) => candidates[row][col][digit - 1]);
				if (holders.length < 2) continue;
				const boxCols = new Set(holders.map(([, col]) => Math.floor(col / 3)));
				if (boxCols.size !== 1) continue;
				const [boxCol] = boxCols;
				const boxRow = Math.floor(row / 3);
				const eliminations = [];
				for (let dr = 0; dr < 3; dr++) {
					const r = boxRow * 3 + dr;
					if (r === row) continue;
					for (let dc = 0; dc < 3; dc++) {
						const c = boxCol * 3 + dc;
						if (candidates[r][c][digit - 1]) eliminations.push({
							row: r,
							col: c,
							digit
						});
					}
				}
				if (eliminations.length > 0) instances.push({
					type: "claiming",
					digit,
					basisCells: holders,
					eliminations
				});
			}
		}
		for (let col = 0; col < 9; col++) {
			const colCells = [];
			for (let row = 0; row < 9; row++) if (board[row][col] === 0) colCells.push([row, col]);
			for (let digit = 1; digit <= 9; digit++) {
				const holders = colCells.filter(([row]) => candidates[row][col][digit - 1]);
				if (holders.length < 2) continue;
				const boxRows = new Set(holders.map(([row]) => Math.floor(row / 3)));
				if (boxRows.size !== 1) continue;
				const [boxRow] = boxRows;
				const boxCol = Math.floor(col / 3);
				const eliminations = [];
				for (let dc = 0; dc < 3; dc++) {
					const c = boxCol * 3 + dc;
					if (c === col) continue;
					for (let dr = 0; dr < 3; dr++) {
						const r = boxRow * 3 + dr;
						if (candidates[r][c][digit - 1]) eliminations.push({
							row: r,
							col: c,
							digit
						});
					}
				}
				if (eliminations.length > 0) instances.push({
					type: "claiming",
					digit,
					basisCells: holders,
					eliminations
				});
			}
		}
		return instances;
	}
	findInstances(board, candidates) {
		return [...this.findPointingInstances(board, candidates), ...this.findClaimingInstances(board, candidates)];
	}
	findEliminations(board, candidates) {
		const eliminations = /* @__PURE__ */ new Map();
		for (const instance of this.findInstances(board, candidates)) for (const elimination of instance.eliminations) eliminations.set(`${elimination.row},${elimination.col},${elimination.digit}`, elimination);
		return Array.from(eliminations.values());
	}
};
//#endregion
//#region src/sudoku/SudokuMedusaFinder.ts
function candidateKey$1(row, col, digit) {
	return `${row},${col},${digit}`;
}
function cellKey$2(row, col) {
	return `${row},${col}`;
}
function sameUnit$3(a, b) {
	const [ar, ac] = a;
	const [br, bc] = b;
	if (ar === br || ac === bc) return true;
	return Math.floor(ar / 3) === Math.floor(br / 3) && Math.floor(ac / 3) === Math.floor(bc / 3);
}
function opposite(color) {
	return color === "blue" ? "yellow" : "blue";
}
var SudokuMedusaFinder = class {
	/** Builds the strong-link graph shared by findChains and growChainFrom:
	* one node per (cell, digit) candidate, with a bilocal edge for every
	* digit conjugate pair and a bivalue edge for every two-candidate cell.
	* Public so a caller making several growChainFromGraph calls against the
	* same board/candidates (e.g. one per promotion within a single Dragon
	* Colouring extension) can build it once and reuse it, rather than
	* paying this O(board) cost again for every single call. */
	buildStrongLinkGraph(board, candidates) {
		const adjacency = /* @__PURE__ */ new Map();
		const nodeByKey = /* @__PURE__ */ new Map();
		const edgeKeys = /* @__PURE__ */ new Set();
		const bivalueEdgeKeys = /* @__PURE__ */ new Set();
		const addEdge = (aKey, a, bKey, b, kind) => {
			const edgeKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
			if (edgeKeys.has(edgeKey)) return;
			edgeKeys.add(edgeKey);
			if (kind === "bivalue") bivalueEdgeKeys.add(edgeKey);
			nodeByKey.set(aKey, a);
			nodeByKey.set(bKey, b);
			if (!adjacency.has(aKey)) adjacency.set(aKey, []);
			if (!adjacency.has(bKey)) adjacency.set(bKey, []);
			adjacency.get(aKey).push(bKey);
			adjacency.get(bKey).push(aKey);
		};
		for (let digit = 1; digit <= 9; digit++) for (const unit of sudokuUnits()) {
			const withCandidate = unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1]);
			if (withCandidate.length === 2) {
				const [[r1, c1], [r2, c2]] = withCandidate;
				addEdge(candidateKey$1(r1, c1, digit), {
					row: r1,
					col: c1,
					digit
				}, candidateKey$1(r2, c2, digit), {
					row: r2,
					col: c2,
					digit
				}, "bilocal");
			}
		}
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0) continue;
			const digits = markedCandidateDigits(candidates[row][col]);
			if (digits.length === 2) {
				const [d1, d2] = digits;
				addEdge(candidateKey$1(row, col, d1), {
					row,
					col,
					digit: d1
				}, candidateKey$1(row, col, d2), {
					row,
					col,
					digit: d2
				}, "bivalue");
			}
		}
		return {
			adjacency,
			nodeByKey,
			bivalueEdgeKeys
		};
	}
	/** Convenience one-shot form of growChainFromGraph for a single call -
	* builds the graph itself, at the cost of rebuilding it from scratch
	* every time. A caller making more than one call against the same
	* board/candidates (see buildStrongLinkGraph) should build the graph
	* once and use growChainFromGraph directly instead. */
	growChainFrom(board, candidates, start, startColor, known) {
		return this.growChainFromGraph(this.buildStrongLinkGraph(board, candidates), start, startColor, known);
	}
	/** Re-runs the same strong-link propagation findChains uses, but seeded
	* from one already-known-true candidate (e.g. one Dragon Colouring just
	* promoted to its primary Medusa colour) instead of picking an arbitrary
	* starting point - so a promotion can discover genuinely new Medusa
	* candidates it just made reachable, without re-deriving every chain on
	* the board from scratch. `known` is the set of "row,col,digit" keys
	* already accounted for (already coloured, by any means) - traversal
	* stops at an already-known node rather than trying to recolour it, so a
	* node whose Dragon-derived colour happens to disagree with what strong-
	* link propagation would assign here is left alone rather than
	* overridden or flagged; that disagreement would only matter for a
	* contradiction this method isn't responsible for finding. */
	growChainFromGraph(graph, start, startColor, known) {
		const { adjacency, nodeByKey, bivalueEdgeKeys } = graph;
		const startKey = candidateKey$1(start.row, start.col, start.digit);
		const added = [];
		if (!adjacency.has(startKey)) return {
			added,
			hasBivalueCellLink: false
		};
		const colorMap = /* @__PURE__ */ new Map([[startKey, startColor]]);
		const visited = /* @__PURE__ */ new Set([startKey]);
		const queue = [startKey];
		let hasBivalueCellLink = false;
		while (queue.length > 0) {
			const currentKey = queue.shift();
			const nextColor = opposite(colorMap.get(currentKey));
			for (const neighborKey of adjacency.get(currentKey) ?? []) {
				const edgeKey = currentKey < neighborKey ? `${currentKey}|${neighborKey}` : `${neighborKey}|${currentKey}`;
				if (bivalueEdgeKeys.has(edgeKey)) hasBivalueCellLink = true;
				if (visited.has(neighborKey)) continue;
				visited.add(neighborKey);
				colorMap.set(neighborKey, nextColor);
				queue.push(neighborKey);
				if (!known.has(neighborKey)) added.push({
					...nodeByKey.get(neighborKey),
					color: nextColor
				});
			}
		}
		return {
			added,
			hasBivalueCellLink
		};
	}
	findChains(board, candidates) {
		const { adjacency, nodeByKey, bivalueEdgeKeys } = this.buildStrongLinkGraph(board, candidates);
		const visited = /* @__PURE__ */ new Set();
		const chains = [];
		for (const startKey of adjacency.keys()) {
			if (visited.has(startKey)) continue;
			const colorMap = /* @__PURE__ */ new Map();
			const componentKeys = [startKey];
			const queue = [startKey];
			colorMap.set(startKey, "blue");
			visited.add(startKey);
			let consistent = true;
			let hasBivalueCellLink = false;
			while (queue.length > 0) {
				const currentKey = queue.shift();
				const nextColor = opposite(colorMap.get(currentKey));
				for (const neighborKey of adjacency.get(currentKey) ?? []) {
					const edgeKey = currentKey < neighborKey ? `${currentKey}|${neighborKey}` : `${neighborKey}|${currentKey}`;
					if (bivalueEdgeKeys.has(edgeKey)) hasBivalueCellLink = true;
					if (!colorMap.has(neighborKey)) {
						colorMap.set(neighborKey, nextColor);
						visited.add(neighborKey);
						componentKeys.push(neighborKey);
						queue.push(neighborKey);
					} else if (colorMap.get(neighborKey) !== nextColor) consistent = false;
				}
			}
			if (!consistent || componentKeys.length < 2) continue;
			const candidatesList = componentKeys.map((key) => {
				return {
					...nodeByKey.get(key),
					color: colorMap.get(key)
				};
			});
			chains.push({
				candidates: candidatesList,
				hasBivalueCellLink
			});
		}
		return chains;
	}
	/**
	* Mass eliminations (rules 1-2): a single contradiction that pins down
	* which color must be false for the WHOLE chain, so every candidate of
	* the other color becomes the solution for its cell.
	*/
	findMassElimination(chain, board, candidates) {
		const byCell = /* @__PURE__ */ new Map();
		for (const node of chain.candidates) {
			const key = cellKey$2(node.row, node.col);
			const list = byCell.get(key) ?? [];
			list.push(node);
			byCell.set(key, list);
		}
		for (const nodes of byCell.values()) {
			if (nodes.length < 2) continue;
			for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) if (nodes[i].color === nodes[j].color) return this.buildMassInstance(chain, {
				kind: "cell",
				color: nodes[i].color,
				row: nodes[i].row,
				col: nodes[i].col,
				digitA: nodes[i].digit,
				digitB: nodes[j].digit
			});
		}
		for (const color of ["blue", "yellow"]) {
			const nodesOfColor = chain.candidates.filter((n) => n.color === color);
			for (let i = 0; i < nodesOfColor.length; i++) for (let j = i + 1; j < nodesOfColor.length; j++) {
				const a = nodesOfColor[i];
				const b = nodesOfColor[j];
				if (a.digit === b.digit && sameUnit$3([a.row, a.col], [b.row, b.col])) return this.buildMassInstance(chain, {
					kind: "unit",
					color,
					digit: a.digit,
					a: [a.row, a.col],
					b: [b.row, b.col]
				});
			}
		}
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0) continue;
			const digits = markedCandidateDigits(candidates[row][col]);
			if (digits.length === 0 || byCell.has(cellKey$2(row, col))) continue;
			for (const color of ["blue", "yellow"]) if (digits.every((digit) => chain.candidates.some((n) => n.color === color && n.digit === digit && sameUnit$3([row, col], [n.row, n.col])))) return this.buildMassInstance(chain, {
				kind: "emptied",
				color,
				row,
				col,
				digits
			});
		}
		return null;
	}
	buildMassInstance(chain, conflict) {
		const falseColor = conflict.color;
		const trueColor = opposite(falseColor);
		return {
			chain,
			conflict,
			falseColor,
			trueColor,
			solvedCells: chain.candidates.filter((n) => n.color === trueColor),
			eliminatedCandidates: chain.candidates.filter((n) => n.color === falseColor)
		};
	}
	/** Rule 3: a candidate that isn't itself part of the chain, but sees both
	* colours of the same digit - whichever colour turns out true, one of
	* those two sightings eliminates it. */
	findRule3Eliminations(chain, board, candidates) {
		const coloredKeys = new Set(chain.candidates.map((n) => candidateKey$1(n.row, n.col, n.digit)));
		const byColorDigit = /* @__PURE__ */ new Map();
		for (const node of chain.candidates) {
			const key = `${node.color}:${node.digit}`;
			const list = byColorDigit.get(key) ?? [];
			list.push(node);
			byColorDigit.set(key, list);
		}
		const results = [];
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0) continue;
			for (const digit of markedCandidateDigits(candidates[row][col])) {
				if (coloredKeys.has(candidateKey$1(row, col, digit))) continue;
				const blueNode = (byColorDigit.get(`blue:${digit}`) ?? []).find((n) => sameUnit$3([row, col], [n.row, n.col]));
				const yellowNode = (byColorDigit.get(`yellow:${digit}`) ?? []).find((n) => sameUnit$3([row, col], [n.row, n.col]));
				if (blueNode && yellowNode) results.push({
					chain,
					row,
					col,
					digit,
					blueSeen: [blueNode.row, blueNode.col],
					yellowSeen: [yellowNode.row, yellowNode.col]
				});
			}
		}
		return results;
	}
	/** Rule 4: a cell with a colored candidate of each colour - one of those
	* two colours must be true, so whichever digit lands there, it's one of
	* those two, and every other candidate in the cell is eliminated. */
	findRule4Eliminations(chain, candidates) {
		const byCell = /* @__PURE__ */ new Map();
		for (const node of chain.candidates) {
			const key = cellKey$2(node.row, node.col);
			const list = byCell.get(key) ?? [];
			list.push(node);
			byCell.set(key, list);
		}
		const results = [];
		for (const [key, nodes] of byCell) {
			const hasBlue = nodes.some((n) => n.color === "blue");
			const hasYellow = nodes.some((n) => n.color === "yellow");
			if (!hasBlue || !hasYellow) continue;
			const [row, col] = key.split(",").map(Number);
			const coloredDigits = new Set(nodes.map((n) => n.digit));
			const eliminatedDigits = markedCandidateDigits(candidates[row][col]).filter((digit) => !coloredDigits.has(digit));
			if (eliminatedDigits.length > 0) results.push({
				chain,
				row,
				col,
				coloredCandidates: nodes,
				eliminatedDigits
			});
		}
		return results;
	}
	/** Rule 5: a cell with exactly one colored candidate - if one of its
	* other, uncolored candidates has the same digit colored the opposite
	* colour somewhere else it can see, that candidate can't survive either
	* colour turning out true, so it's eliminated. */
	findRule5Eliminations(chain, candidates) {
		const byCell = /* @__PURE__ */ new Map();
		for (const node of chain.candidates) {
			const key = cellKey$2(node.row, node.col);
			const list = byCell.get(key) ?? [];
			list.push(node);
			byCell.set(key, list);
		}
		const byColorDigit = /* @__PURE__ */ new Map();
		for (const node of chain.candidates) {
			const key = `${node.color}:${node.digit}`;
			const list = byColorDigit.get(key) ?? [];
			list.push(node);
			byColorDigit.set(key, list);
		}
		const results = [];
		for (const [key, nodes] of byCell) {
			if (nodes.length !== 1) continue;
			const [row, col] = key.split(",").map(Number);
			const coloredNode = nodes[0];
			const otherColor = opposite(coloredNode.color);
			for (const digit of markedCandidateDigits(candidates[row][col])) {
				if (digit === coloredNode.digit) continue;
				const opponent = (byColorDigit.get(`${otherColor}:${digit}`) ?? []).find((n) => !(n.row === row && n.col === col) && sameUnit$3([row, col], [n.row, n.col]));
				if (opponent) results.push({
					chain,
					row,
					col,
					coloredDigit: coloredNode.digit,
					coloredColor: coloredNode.color,
					eliminatedDigit: digit,
					opponent: [opponent.row, opponent.col]
				});
			}
		}
		return results;
	}
};
//#endregion
//#region src/sudoku/SudokuNakedSubsetFinder.ts
/**
* Naked triples/quads: the same idea as naked pairs, generalized to three or
* four cells - if N cells in the same row, column, or box collectively use
* only N candidate digits between them (each cell holding some non-empty
* subset of those N, and nothing else), those N cells must fill exactly
* those N digits, in some order - so none of them can appear anywhere else
* in that unit, and get eliminated from the unit's other cells.
*/
var SudokuNakedSubsetFinder = class {
	findNakedTriples(board, candidates) {
		return this.findNakedSubsets(board, candidates, 3);
	}
	findNakedQuads(board, candidates) {
		return this.findNakedSubsets(board, candidates, 4);
	}
	/** Triples and quads computed together, sharing the per-unit scan for
	* cells with 2-4 marked candidates (a triple's eligible cells are just
	* that set narrowed to <=3) instead of each doing its own full pass over
	* every unit. Dynamic Dragon's Extension Rule 3 simulation calls both
	* back to back, unconditionally, on every step it reaches this far - with
	* the per-step AIC limit off that can be hundreds of times per Dragon
	* step, and the separate scans were a measurable chunk of it. Produces
	* the exact same instances (in the exact same order) as calling
	* findNakedTriples and findNakedQuads separately - kept as its own method
	* rather than replacing them, since most callers (the Techniques panel)
	* only ever need one size at a time and never benefit from the shared
	* scan. */
	findNakedTriplesAndQuads(board, candidates) {
		const triples = [];
		const quads = [];
		const seenTriples = /* @__PURE__ */ new Set();
		const seenQuads = /* @__PURE__ */ new Set();
		for (const unit of sudokuUnits()) {
			const unsolvedCells = unit.filter(([row, col]) => board[row][col] === 0);
			const eligibleFor4 = unsolvedCells.filter(([row, col]) => {
				const count = markedCandidateDigits(candidates[row][col]).length;
				return count >= 2 && count <= 4;
			});
			const eligibleFor3 = eligibleFor4.filter(([row, col]) => markedCandidateDigits(candidates[row][col]).length <= 3);
			this.emitSubsets(3, eligibleFor3, unsolvedCells, candidates, seenTriples, triples);
			this.emitSubsets(4, eligibleFor4, unsolvedCells, candidates, seenQuads, quads);
		}
		return {
			triples,
			quads
		};
	}
	findNakedTripleEliminations(board, candidates) {
		return this.dedupeEliminations(this.findNakedTriples(board, candidates));
	}
	findNakedQuadEliminations(board, candidates) {
		return this.dedupeEliminations(this.findNakedQuads(board, candidates));
	}
	dedupeEliminations(instances) {
		const eliminations = /* @__PURE__ */ new Map();
		for (const instance of instances) for (const elimination of instance.eliminations) eliminations.set(`${elimination.row},${elimination.col},${elimination.digit}`, elimination);
		return Array.from(eliminations.values());
	}
	findNakedSubsets(board, candidates, size) {
		const seen = /* @__PURE__ */ new Set();
		const instances = [];
		for (const unit of sudokuUnits()) {
			const unsolvedCells = unit.filter(([row, col]) => board[row][col] === 0);
			const eligibleCells = unsolvedCells.filter(([row, col]) => {
				const count = markedCandidateDigits(candidates[row][col]).length;
				return count >= 2 && count <= size;
			});
			this.emitSubsets(size, eligibleCells, unsolvedCells, candidates, seen, instances);
		}
		return instances;
	}
	/** The shared body of findNakedSubsets: every `size`-combination of
	* `eligibleCells` that collectively uses exactly `size` digits becomes an
	* instance (deduped against `seen`, appended to `out`) - factored out so
	* findNakedTriplesAndQuads can run it against a pre-computed eligible set
	* per size without repeating the per-unit scan above it. */
	emitSubsets(size, eligibleCells, unsolvedCells, candidates, seen, out) {
		for (const combo of this.combinations(eligibleCells, size)) {
			const digitSet = /* @__PURE__ */ new Set();
			for (const [row, col] of combo) for (const digit of markedCandidateDigits(candidates[row][col])) digitSet.add(digit);
			if (digitSet.size !== size) continue;
			const digits = Array.from(digitSet).sort((a, b) => a - b);
			const eliminations = [];
			for (const [row, col] of unsolvedCells) {
				if (combo.some(([cr, cc]) => cr === row && cc === col)) continue;
				for (const digit of digits) if (candidates[row][col][digit - 1]) eliminations.push({
					row,
					col,
					digit
				});
			}
			if (eliminations.length === 0) continue;
			const key = `${combo.map(([r, c]) => `${r}.${c}`).sort().join("-")}|${digits.join(",")}`;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push({
				size,
				cells: [...combo],
				digits,
				eliminations
			});
		}
	}
	combinations(items, size) {
		if (size === 0) return [[]];
		const results = [];
		const pick = (start, chosen) => {
			if (chosen.length === size) {
				results.push([...chosen]);
				return;
			}
			for (let i = start; i < items.length; i++) {
				chosen.push(items[i]);
				pick(i + 1, chosen);
				chosen.pop();
			}
		};
		pick(0, []);
		return results;
	}
};
//#endregion
//#region src/sudoku/SudokuPairFinder.ts
/**
* Naked pairs: when two cells in the same row, column, or box have the
* exact same two candidates and nothing else, one of those cells must be
* each of those two digits - which cell gets which isn't determined yet,
* but either way neither digit can be a candidate anywhere else in that
* unit, so they can be eliminated from the rest of the unit's cells.
*/
var SudokuPairFinder = class {
	findNakedPairs(board, candidates) {
		const unsolved = [];
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) if (board[row][col] === 0) unsolved.push([row, col]);
		const instances = [];
		for (let i = 0; i < unsolved.length; i++) {
			const [rowA, colA] = unsolved[i];
			const digitsA = markedCandidateDigits(candidates[rowA][colA]);
			if (digitsA.length !== 2) continue;
			for (let j = i + 1; j < unsolved.length; j++) {
				const [rowB, colB] = unsolved[j];
				const digitsB = markedCandidateDigits(candidates[rowB][colB]);
				if (digitsB.length !== 2 || digitsA[0] !== digitsB[0] || digitsA[1] !== digitsB[1]) continue;
				const peers = this.sharedPeerCells(rowA, colA, rowB, colB);
				if (peers.length === 0) continue;
				const eliminations = [];
				for (const [r, c] of peers) for (const digit of digitsA) if (candidates[r][c][digit - 1]) eliminations.push({
					row: r,
					col: c,
					digit
				});
				if (eliminations.length === 0) continue;
				instances.push({
					cells: [[rowA, colA], [rowB, colB]],
					digits: [digitsA[0], digitsA[1]],
					eliminations
				});
			}
		}
		return instances;
	}
	/** Every unsolved cell that shares a row, column, or box with both
	* (rowA, colA) and (rowB, colB) - i.e. every cell a naked pair between
	* them would affect - deduplicated (a pair can share up to two units,
	* e.g. same row and same box, without double-counting a peer in both). */
	sharedPeerCells(rowA, colA, rowB, colB) {
		const peers = /* @__PURE__ */ new Map();
		const addUnlessPair = (row, col) => {
			if (row === rowA && col === colA || row === rowB && col === colB) return;
			peers.set(`${row},${col}`, [row, col]);
		};
		if (rowA === rowB) for (let col = 0; col < 9; col++) addUnlessPair(rowA, col);
		if (colA === colB) for (let row = 0; row < 9; row++) addUnlessPair(row, colA);
		const boxRowA = Math.floor(rowA / 3);
		const boxColA = Math.floor(colA / 3);
		if (boxRowA === Math.floor(rowB / 3) && boxColA === Math.floor(colB / 3)) {
			const boxRow = boxRowA * 3;
			const boxCol = boxColA * 3;
			for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) addUnlessPair(boxRow + dr, boxCol + dc);
		}
		return Array.from(peers.values());
	}
	findNakedPairEliminations(board, candidates) {
		const eliminations = /* @__PURE__ */ new Map();
		for (const pair of this.findNakedPairs(board, candidates)) for (const elimination of pair.eliminations) eliminations.set(`${elimination.row},${elimination.col},${elimination.digit}`, elimination);
		return Array.from(eliminations.values());
	}
	/**
	* True once every unsolved cell has at least one candidate marked.
	* Naked-pair elimination assumes a complete candidate picture - a blank,
	* not-yet-marked cell would otherwise look the same as a genuinely
	* exhausted one, and eliminations computed against incomplete marks
	* wouldn't reliably hold once the rest get filled in.
	*/
	hasFullCandidates(board, candidates) {
		for (let row = 0; row < board.length; row++) for (let col = 0; col < board[row].length; col++) if (board[row][col] === 0 && !candidates[row][col].some(Boolean)) return false;
		return true;
	}
};
//#endregion
//#region src/sudoku/SudokuShortAicFinder.ts
/** Every cell a chain node stands for: a grouped node's whole group, else
* its one cell. */
function aicNodeCells(node) {
	return node.cells ?? [[node.row, node.col]];
}
/** "2r1c7", or "2(r8c3, r9c3)" for a grouped node. */
function aicNodeText(node) {
	const ref = ([row, col]) => `r${row + 1}c${col + 1}`;
	return node.cells ? `${node.digit}(${node.cells.map(ref).join(", ")})` : `${node.digit}${ref([node.row, node.col])}`;
}
/** An AIC chain written out: "2r1c7 = 2r1c3 - 2(r8c3, r9c3) = 2r9c1". */
function aicChainText(nodes) {
	return nodes.map((n, i) => `${i === 0 ? "" : i % 2 === 1 ? " = " : " - "}${aicNodeText(n)}`).join("");
}
/** Every candidate a chain touches (a grouped node contributes all of its
* cells) and its links, in the shape the grid overlay and the Dragon move
* log carry them. */
function aicChainView(aic) {
	return {
		candidates: aic.nodes.flatMap((n) => aicNodeCells(n).map(([row, col]) => ({
			row,
			col,
			digit: n.digit
		}))),
		links: aic.links.map((link) => ({
			from: {
				row: link.from.row,
				col: link.from.col,
				digit: link.from.digit
			},
			to: {
				row: link.to.row,
				col: link.to.col,
				digit: link.to.digit
			},
			kind: link.kind,
			...link.from.cells ? { fromCells: link.from.cells } : {},
			...link.to.cells ? { toCells: link.to.cells } : {}
		}))
	};
}
/** Which chain explains an elimination set best when several do (see
* pickBestPerEliminationSet): Sudoku.Coach's own order (it tries Skyscraper,
* then Two-String Kite, then Crane, then Empty Rectangle), and any named
* pattern before a plain unnamed chain. */
const PATTERN_PREFERENCE = {
	Skyscraper: 0,
	"Two-String Kite": 1,
	Crane: 2,
	"Empty Rectangle": 3
};
const UNNAMED_PREFERENCE = 4;
function classifyShortAic(instance) {
	return instance.length === 3 && instance.isSingleDigit ? "single-digit" : "general";
}
function candidateKey(row, col, digit) {
	return `${row},${col},${digit}`;
}
function sameUnit$2(a, b) {
	const [ar, ac] = a;
	const [br, bc] = b;
	if (ar === br || ac === bc) return true;
	return Math.floor(ar / 3) === Math.floor(br / 3) && Math.floor(ac / 3) === Math.floor(bc / 3);
}
function buildLinkGraphs(board, candidates) {
	const strongAdjacency = /* @__PURE__ */ new Map();
	const weakAdjacency = /* @__PURE__ */ new Map();
	const nodeByKey = /* @__PURE__ */ new Map();
	const addEdge = (map, aKey, bKey) => {
		if (!map.has(aKey)) map.set(aKey, []);
		if (!map.has(bKey)) map.set(bKey, []);
		map.get(aKey).push(bKey);
		map.get(bKey).push(aKey);
	};
	const registerNode = (row, col, digit) => {
		const key = candidateKey(row, col, digit);
		if (!nodeByKey.has(key)) nodeByKey.set(key, {
			row,
			col,
			digit
		});
		return key;
	};
	for (let digit = 1; digit <= 9; digit++) for (const unit of sudokuUnits()) {
		const withCandidate = unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1]);
		for (let i = 0; i < withCandidate.length; i++) for (let j = i + 1; j < withCandidate.length; j++) {
			const [r1, c1] = withCandidate[i];
			const [r2, c2] = withCandidate[j];
			const key1 = registerNode(r1, c1, digit);
			const key2 = registerNode(r2, c2, digit);
			addEdge(weakAdjacency, key1, key2);
			if (withCandidate.length === 2) addEdge(strongAdjacency, key1, key2);
		}
	}
	for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
		if (board[row][col] !== 0) continue;
		const digits = markedCandidateDigits(candidates[row][col]);
		for (let i = 0; i < digits.length; i++) for (let j = i + 1; j < digits.length; j++) {
			const key1 = registerNode(row, col, digits[i]);
			const key2 = registerNode(row, col, digits[j]);
			addEdge(weakAdjacency, key1, key2);
			if (digits.length === 2) addEdge(strongAdjacency, key1, key2);
		}
	}
	return {
		strongAdjacency,
		weakAdjacency,
		nodeByKey
	};
}
/** What a chain ending in candidates x and y (in that order) can eliminate -
* null if x/y don't yield anything (or are degenerate, e.g. the same cell). */
function computeEliminations(board, candidates, x, y) {
	if (x.row === y.row && x.col === y.col) return null;
	if (x.digit === y.digit) {
		const eliminations = [];
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (row === x.row && col === x.col || row === y.row && col === y.col) continue;
			if (board[row][col] !== 0 || !candidates[row][col][x.digit - 1]) continue;
			if (sameUnit$2([row, col], [x.row, x.col]) && sameUnit$2([row, col], [y.row, y.col])) eliminations.push({
				row,
				col,
				digit: x.digit
			});
		}
		if (eliminations.length === 0) return null;
		return {
			type: 1,
			eliminations
		};
	}
	if (!sameUnit$2([x.row, x.col], [y.row, y.col])) return null;
	const eliminations = [];
	if (candidates[x.row][x.col][y.digit - 1]) eliminations.push({
		row: x.row,
		col: x.col,
		digit: y.digit
	});
	if (candidates[y.row][y.col][x.digit - 1]) eliminations.push({
		row: y.row,
		col: y.col,
		digit: x.digit
	});
	if (eliminations.length === 0) return null;
	return {
		type: 2,
		eliminations
	};
}
/** Forward and reverse traversal of the same underlying chain describe the
* identical 3 links - canonicalize to whichever direction sorts first so
* the two are recognized as one finding, not two. */
function chainDedupeKey(nodes) {
	const forward = nodes.map((n) => candidateKey(n.row, n.col, n.digit)).join("-");
	const backward = [...nodes].reverse().map((n) => candidateKey(n.row, n.col, n.digit)).join("-");
	return forward < backward ? forward : backward;
}
/** A strong link is "bilocal" when its two candidates share a digit (a
* conjugate pair - the digit can go in exactly two cells of some row,
* column, or box); the other kind of strong link ("bivalue") instead
* shares a cell, with two candidate digits. Only strong links can be
* bilocal - a same-digit weak link never has the "exactly two cells"
* property (see buildLinkGraphs). */
function isBilocalStrongLink(link) {
	return link.kind === "strong" && link.from.digit === link.to.digit;
}
function bilocalStrongLinkCount(links) {
	return links.filter(isBilocalStrongLink).length;
}
/** Order-independent identity for a set of eliminations - two chains that
* eliminate the exact same candidate(s) are competing explanations for the
* same conclusion, not two distinct findings. */
function eliminationSetKey(eliminations) {
	return eliminations.map((e) => `${e.row}.${e.col}.${e.digit}`).sort().join("|");
}
function patternPreference(instance) {
	return instance.pattern ? PATTERN_PREFERENCE[instance.pattern] : UNNAMED_PREFERENCE;
}
/** When several chains reach the exact same elimination(s), keep only the
* most "elegant" explanation: the shortest chain, and among equally short
* ones, whichever leans on more bilocal (conjugate-pair) strong links
* rather than bivalue (same-cell) ones. Between two single-digit chains
* still tied after that, a named pattern wins (see PATTERN_PREFERENCE) - so
* a Skyscraper is never listed as a plain chain just because an unnamed
* chain to the same eliminations happened to be found first. That last rule
* only compares single-digit chains with each other, so it never changes
* whether an elimination set counts as single-digit or general. */
function pickBestPerEliminationSet(instances) {
	const bestBySet = /* @__PURE__ */ new Map();
	for (const instance of instances) {
		const key = eliminationSetKey(instance.eliminations);
		const current = bestBySet.get(key);
		if (!current) {
			bestBySet.set(key, instance);
			continue;
		}
		if (instance.links.length < current.links.length) bestBySet.set(key, instance);
		else if (instance.links.length === current.links.length) {
			const instanceBilocal = bilocalStrongLinkCount(instance.links);
			const currentBilocal = bilocalStrongLinkCount(current.links);
			if (instanceBilocal > currentBilocal) bestBySet.set(key, instance);
			else if (instanceBilocal === currentBilocal && classifyShortAic(instance) === "single-digit" && classifyShortAic(current) === "single-digit" && patternPreference(instance) < patternPreference(current)) bestBySet.set(key, instance);
		}
	}
	return Array.from(bestBySet.values());
}
function cellText(row, col) {
	return `r${row + 1}c${col + 1}`;
}
function boxOf(row, col) {
	return Math.floor(row / 3) * 3 + Math.floor(col / 3);
}
function buildDigitUnitCounts(board, candidates) {
	const make = () => Array.from({ length: 10 }, () => new Array(9).fill(0));
	const counts = {
		row: make(),
		column: make(),
		box: make()
	};
	for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
		if (board[row][col] !== 0) continue;
		for (let digit = 1; digit <= 9; digit++) if (candidates[row][col][digit - 1]) {
			counts.row[digit][row]++;
			counts.column[digit][col]++;
			counts.box[digit][boxOf(row, col)]++;
		}
	}
	return counts;
}
/** a and b share a unit of this kind in which `digit` has exactly these two
* cells - a conjugate pair in that particular unit (the same cells can be a
* pair in their row but not their box, or both). */
function isPairIn(counts, kind, a, b) {
	const digit = a.digit;
	if (kind === "row") return a.row === b.row && counts.row[digit][a.row] === 2;
	if (kind === "column") return a.col === b.col && counts.column[digit][a.col] === 2;
	return boxOf(a.row, a.col) === boxOf(b.row, b.col) && counts.box[digit][boxOf(a.row, a.col)] === 2;
}
function sameBox(a, b) {
	return boxOf(a.row, a.col) === boxOf(b.row, b.col);
}
function sameLine(kind, a, b) {
	return kind === "row" ? a.row === b.row : a.col === b.col;
}
function lineName(kind, cell) {
	return kind === "row" ? `row ${cell.row + 1}` : `column ${cell.col + 1}`;
}
function otherLine(kind) {
	return kind === "row" ? "column" : "row";
}
function pairText(kind, a, b) {
	return `only twice in ${kind === "box" ? `box ${boxOf(a.row, a.col) + 1}` : lineName(kind, a)} (${cellText(a.row, a.col)}, ${cellText(b.row, b.col)})`;
}
/**
* The named pattern a plain (ungrouped) length-3 single-digit chain
* A = B - C = D is, or null. Tried in Sudoku.Coach's order, first match wins:
*
* - Skyscraper: A=B and C=D are conjugate pairs in two parallel lines (both
*   rows or both columns), neither pair inside one box, and the "base" ends
*   B and C share the crossing line. (Tops A and D in one line too is really
*   an X-Wing - Sudoku.Coach's own Skyscraper code accepts it, and X-Wing,
*   the easier technique, is listed first when enabled.)
* - Two-String Kite: one pair in a row and the other in a column, neither
*   inside one box, whose ends B and C are two cells of the same box.
* - Crane: one pair in a row or column (A=B, in line S), the other a box
*   holding the digit exactly twice (C=D), joined along the line through B
*   crossing S, which has only C inside that box (so D is off it). Either
*   end of the chain may be the line end.
*/
function classifySingleDigitPattern(counts, nodes) {
	const [a, b, c, d] = nodes;
	const digit = a.digit;
	for (const kind of ["column", "row"]) {
		const cross = otherLine(kind);
		if (isPairIn(counts, kind, a, b) && isPairIn(counts, kind, c, d) && sameLine(cross, b, c) && !sameBox(a, b) && !sameBox(c, d)) return {
			pattern: "Skyscraper",
			text: `${digit} appears ${pairText(kind, a, b)} and ${pairText(kind, c, d)}, and ${cellText(b.row, b.col)} and ${cellText(c.row, c.col)} share ${lineName(cross, b)}`
		};
	}
	for (const [first, second] of [["row", "column"], ["column", "row"]]) if (isPairIn(counts, first, a, b) && isPairIn(counts, second, c, d) && sameBox(b, c) && !sameBox(a, b) && !sameBox(c, d)) return {
		pattern: "Two-String Kite",
		text: `${digit} appears ${pairText(first, a, b)} and ${pairText(second, c, d)}, and ${cellText(b.row, b.col)} and ${cellText(c.row, c.col)} share box ${boxOf(b.row, b.col) + 1}`
	};
	for (const [p, x, y, q] of [[
		a,
		b,
		c,
		d
	], [
		d,
		c,
		b,
		a
	]]) for (const kind of ["row", "column"]) {
		const cross = otherLine(kind);
		if (isPairIn(counts, kind, p, x) && isPairIn(counts, "box", y, q) && sameLine(cross, x, y) && !sameLine(cross, x, q)) return {
			pattern: "Crane",
			text: `${digit} appears ${pairText(kind, p, x)} and ${pairText("box", y, q)}, and ${cellText(x.row, x.col)} and ${cellText(y.row, y.col)} share ${lineName(cross, x)}`
		};
	}
	return null;
}
/**
* Every Empty Rectangle Intersection on the grid, for every digit and box: a
* box with 2+ candidates can have more than one (two candidates on a
* diagonal have two crossings), and a box with 2 candidates is also an
* ordinary conjugate pair. Kept as its own query because it is a useful
* building block by itself - findEmptyRectangles is just "an ERI plus a
* conjugate pair in a line crossing one of its arms".
*/
function findEmptyRectangleIntersections(board, candidates) {
	const out = [];
	for (let digit = 1; digit <= 9; digit++) for (let box = 0; box < 9; box++) {
		const top = Math.floor(box / 3) * 3;
		const left = box % 3 * 3;
		const boxCells = [];
		for (let row = top; row < top + 3; row++) for (let col = left; col < left + 3; col++) if (board[row][col] === 0 && candidates[row][col][digit - 1]) boxCells.push([row, col]);
		if (boxCells.length < 2) continue;
		for (let row = top; row < top + 3; row++) for (let col = left; col < left + 3; col++) {
			if (!boxCells.every(([r, c]) => r === row || c === col)) continue;
			const rowArm = boxCells.some(([r, c]) => r === row && c !== col);
			const colArm = boxCells.some(([r, c]) => c === col && r !== row);
			if (!rowArm || !colArm) continue;
			out.push({
				digit,
				box,
				row,
				col,
				boxCells,
				rowCells: boxCells.filter(([r]) => r === row),
				colCells: boxCells.filter(([, c]) => c === col)
			});
		}
	}
	return out;
}
function groupNode(digit, cells) {
	const [row, col] = cells[0];
	return cells.length > 1 ? {
		row,
		col,
		digit,
		cells
	} : {
		row,
		col,
		digit
	};
}
/**
* Empty Rectangle, as a grouped single-digit AIC. For an ERI in box K at
* (r, c) and a conjugate pair P = Q in a column, with P on row r outside K:
*
*   Q = P - (K's cells in row r) = (K's cells in column c, off row r)
*
* If Q isn't the digit, P is; then K's row-r cells aren't, so it must be in
* K's column-c cells. So Q or that column group is the digit, and any cell
* seeing Q and the whole group can't be - chiefly (Q's row, c), the
* classic Empty Rectangle elimination. The same with rows and columns
* swapped. Only boxes with 3+ candidates are used: with exactly 2, the
* box's groups are single cells and the same chain is an ordinary Crane or
* Two-String Kite, which the plain chain search already finds and names.
*
* The conjugate pair must be in a row or column (Sudokuwiki's definition),
* and its far end Q must not share K's rows (for a column pair) - otherwise
* the target cell would sit inside K itself, where the reasoning fails (K
* could hold the digit right there).
*
* sudokuwiki.org has since replaced Empty Rectangles with Rectangle
* Elimination; findRectangleEliminations is that method, and the two always
* find the same eliminations - see its comment.
*/
function findEmptyRectangles(board, candidates, eris = findEmptyRectangleIntersections(board, candidates), minBoxCandidates = 3) {
	const out = [];
	const has = (row, col, digit) => board[row][col] === 0 && candidates[row][col][digit - 1];
	for (const eri of eris) {
		if (eri.boxCells.length < minBoxCandidates) continue;
		const { digit, box } = eri;
		const inBox = (row, col) => boxOf(row, col) === box;
		for (const arm of ["row", "column"]) {
			const entryCells = arm === "row" ? eri.rowCells : eri.colCells;
			const exitCells = arm === "row" ? eri.colCells.filter(([r]) => r !== eri.row) : eri.rowCells.filter(([, c]) => c !== eri.col);
			for (let i = 0; i < 9; i++) {
				const [pRow, pCol] = arm === "row" ? [eri.row, i] : [i, eri.col];
				if (inBox(pRow, pCol) || !has(pRow, pCol, digit)) continue;
				let q = null;
				let count = 0;
				for (let j = 0; j < 9; j++) {
					const [r, c] = arm === "row" ? [j, pCol] : [pRow, j];
					if (has(r, c, digit)) {
						count++;
						if (r !== pRow || c !== pCol) q = [r, c];
					}
				}
				if (count !== 2 || !q) continue;
				const [qRow, qCol] = q;
				if (arm === "row" ? Math.floor(qRow / 3) === Math.floor(eri.row / 3) : Math.floor(qCol / 3) === Math.floor(eri.col / 3)) continue;
				const nodes = [
					{
						row: qRow,
						col: qCol,
						digit
					},
					{
						row: pRow,
						col: pCol,
						digit
					},
					groupNode(digit, entryCells),
					groupNode(digit, exitCells)
				];
				const chainCells = new Set(nodes.flatMap((n) => aicNodeCells(n).map(([r, c]) => r * 9 + c)));
				const eliminations = [];
				for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) if (has(row, col, digit) && !chainCells.has(row * 9 + col) && sameUnit$2([row, col], q) && exitCells.every((cell) => sameUnit$2([row, col], cell))) eliminations.push({
					row,
					col,
					digit
				});
				if (eliminations.length === 0) continue;
				const linkLine = arm === "row" ? `column ${pCol + 1}` : `row ${pRow + 1}`;
				out.push({
					nodes,
					links: [
						{
							from: nodes[0],
							to: nodes[1],
							kind: "strong"
						},
						{
							from: nodes[1],
							to: nodes[2],
							kind: "weak"
						},
						{
							from: nodes[2],
							to: nodes[3],
							kind: "strong"
						}
					],
					length: 3,
					isSingleDigit: true,
					eliminationType: 1,
					eliminations,
					pattern: "Empty Rectangle",
					patternText: `${digit} in box ${box + 1} lies only in row ${eri.row + 1} and column ${eri.col + 1} (an empty rectangle), and appears only twice in ${linkLine} (${cellText(pRow, pCol)}, ${cellText(qRow, qCol)})`
				});
			}
		}
	}
	return out;
}
/**
* Short AIC (Alternating Inference Chain): a strong link, a weak link, and
* another strong link joining four candidates X-A-B-Y in a row. Whichever
* of X or Y is false forces the other true (if X is false, the first
* strong link forces A true, the weak link then forces B false, and the
* second strong link forces Y true) - so X and Y behave exactly like a
* strong link themselves, even though no single link connects them
* directly. Two eliminations follow depending on whether X and Y are the
* same digit (Type 1: any other cell seeing both of their cells can't be
* that digit) or different digits whose cells see each other (Type 2:
* neither end's cell can hold the other end's digit).
*/
var SudokuShortAicFinder = class {
	/** `graphs` lets a caller that's about to also run Generic AIC on the same
	* board/candidates (Dynamic Dragon's Extension Rule 3 - see aicsInOrder in
	* SudokuDragonFinder) build the link graph once and pass it to both,
	* instead of it being rebuilt twice for identical input. Defaults to
	* building it here, so every other caller is unaffected. */
	findShortAics(board, candidates, graphs) {
		const { strongAdjacency, weakAdjacency, nodeByKey } = graphs ?? buildLinkGraphs(board, candidates);
		const seen = /* @__PURE__ */ new Set();
		const instances = [];
		let unitCounts;
		const emit = (keys) => {
			const nodes = keys.map((k) => nodeByKey.get(k));
			const x = nodes[0];
			const y = nodes[nodes.length - 1];
			const outcome = computeEliminations(board, candidates, x, y);
			if (!outcome) return;
			const key = chainDedupeKey(nodes);
			if (seen.has(key)) return;
			seen.add(key);
			const links = [];
			for (let i = 0; i < nodes.length - 1; i++) links.push({
				from: nodes[i],
				to: nodes[i + 1],
				kind: i % 2 === 0 ? "strong" : "weak"
			});
			const instance = {
				nodes,
				links,
				length: nodes.length - 1,
				isSingleDigit: nodes.every((n) => n.digit === nodes[0].digit),
				eliminationType: outcome.type,
				eliminations: outcome.eliminations
			};
			if (classifyShortAic(instance) === "single-digit") {
				const named = classifySingleDigitPattern(unitCounts ??= buildDigitUnitCounts(board, candidates), nodes);
				if (named) {
					instance.pattern = named.pattern;
					instance.patternText = named.text;
				}
			}
			instances.push(instance);
		};
		for (const [aKey, aStrongNeighbors] of strongAdjacency) for (const bKey of aStrongNeighbors) {
			const bWeakNeighbors = weakAdjacency.get(bKey) ?? [];
			for (const cKey of bWeakNeighbors) {
				if (cKey === aKey || cKey === bKey) continue;
				const cStrongNeighbors = strongAdjacency.get(cKey) ?? [];
				for (const dKey of cStrongNeighbors) {
					if (dKey === aKey || dKey === bKey || dKey === cKey) continue;
					emit([
						aKey,
						bKey,
						cKey,
						dKey
					]);
					const dWeakNeighbors = weakAdjacency.get(dKey) ?? [];
					for (const eKey of dWeakNeighbors) {
						if (eKey === aKey || eKey === bKey || eKey === cKey || eKey === dKey) continue;
						const eStrongNeighbors = strongAdjacency.get(eKey) ?? [];
						for (const fKey of eStrongNeighbors) {
							if (fKey === aKey || fKey === bKey || fKey === cKey || fKey === dKey || fKey === eKey) continue;
							emit([
								aKey,
								bKey,
								cKey,
								dKey,
								eKey,
								fKey
							]);
						}
					}
				}
			}
		}
		instances.push(...findEmptyRectangles(board, candidates));
		return pickBestPerEliminationSet(instances);
	}
	findShortAicEliminations(board, candidates) {
		const eliminations = /* @__PURE__ */ new Map();
		for (const instance of this.findShortAics(board, candidates)) for (const elimination of instance.eliminations) eliminations.set(`${elimination.row},${elimination.col},${elimination.digit}`, elimination);
		return Array.from(eliminations.values());
	}
};
/**
* Generic AIC: alternating inference chains too long for Short AIC. Same idea
* as SudokuShortAicFinder - strong, weak, strong, ..., strong links joining
* candidates X ... Y, so that if X is false Y is true - but with any odd number
* of links from 7 up to `maxLength`, and the same two eliminations follow
* (Type 1: a cell seeing two same-digit ends; Type 2: ends of different digits
* that see each other).
*
* Search: one breadth-first pass per starting candidate over states "reached
* by a strong link" / "reached by a weak link". Breadth-first order means each
* (start, end) pair is first met by its *shortest* chain, so a pair reachable
* in 5 links or fewer is left to Short AIC rather than reported here as a
* longer, worse chain. Only candidates that have a strong link somewhere can
* sit at a chain's ends or inside it, which is what keeps the search small.
*
* Chains that would visit the same candidate twice are dropped rather than
* repaired, matching Short AIC's "distinct candidates" rule; when several
* chains reach the same eliminations the shortest wins (ties: more conjugate
* pairs, fewer same-cell links).
*/
var SudokuGenericAicFinder = class {
	/** `graphs` lets a caller that's already run Short AIC on the same board/
	* candidates (Dynamic Dragon's Extension Rule 3 - see aicsInOrder in
	* SudokuDragonFinder) pass in that same link graph instead of having it
	* rebuilt here from scratch. Defaults to building it here, so every other
	* caller is unaffected. */
	findGenericAics(board, candidates, maxLength = 11, graphs) {
		const limit = maxLength % 2 === 0 ? maxLength - 1 : maxLength;
		if (limit <= 5) return [];
		const { strongAdjacency, weakAdjacency, nodeByKey } = graphs ?? buildLinkGraphs(board, candidates);
		const keys = Array.from(strongAdjacency.keys());
		const idOf = new Map(keys.map((key, id) => [key, id]));
		const n = keys.length;
		const strong = keys.map((key) => strongAdjacency.get(key).map((k) => idOf.get(k)));
		const weak = keys.map((key) => (weakAdjacency.get(key) ?? []).flatMap((k) => {
			const id = idOf.get(k);
			return id === void 0 ? [] : [id];
		}));
		const nodes = keys.map((key) => nodeByKey.get(key));
		const seenStrong = new Int32Array(n);
		const seenWeak = new Int32Array(n);
		const fromStrong = new Int32Array(n);
		const fromWeak = new Int32Array(n);
		let stamp = 0;
		const reportedPairs = /* @__PURE__ */ new Set();
		const instances = [];
		for (let start = 0; start < n; start++) {
			stamp++;
			seenStrong[start] = stamp;
			seenWeak[start] = stamp;
			let frontier = [];
			for (const a of strong[start]) if (seenStrong[a] !== stamp) {
				seenStrong[a] = stamp;
				fromStrong[a] = start;
				frontier.push(a);
			}
			for (let length = 1; length < limit && frontier.length > 0; length += 2) {
				const viaWeak = [];
				for (const a of frontier) for (const b of weak[a]) if (seenWeak[b] !== stamp) {
					seenWeak[b] = stamp;
					fromWeak[b] = a;
					viaWeak.push(b);
				}
				const next = [];
				for (const b of viaWeak) for (const y of strong[b]) {
					if (seenStrong[y] === stamp) continue;
					seenStrong[y] = stamp;
					fromStrong[y] = b;
					next.push(y);
					const endLength = length + 2;
					if (endLength <= 5) continue;
					const pairKey = start < y ? start * n + y : y * n + start;
					if (reportedPairs.has(pairKey)) continue;
					const path = [y];
					for (let at = y; at !== start;) {
						at = path.length % 2 === 1 ? fromStrong[at] : fromWeak[at];
						path.push(at);
					}
					path.reverse();
					if (new Set(path).size !== path.length) continue;
					const outcome = computeEliminations(board, candidates, nodes[start], nodes[y]);
					if (!outcome) continue;
					reportedPairs.add(pairKey);
					const chain = path.map((id) => nodes[id]);
					const links = [];
					for (let i = 0; i < chain.length - 1; i++) links.push({
						from: chain[i],
						to: chain[i + 1],
						kind: i % 2 === 0 ? "strong" : "weak"
					});
					instances.push({
						nodes: chain,
						links,
						length: endLength,
						isSingleDigit: chain.every((node) => node.digit === chain[0].digit),
						eliminationType: outcome.type,
						eliminations: outcome.eliminations
					});
				}
				frontier = next;
			}
		}
		return pickBestPerEliminationSet(instances);
	}
};
//#endregion
//#region src/sudoku/SudokuUniqueRectangleFinder.ts
function sameUnit$1(a, b) {
	const [ar, ac] = a;
	const [br, bc] = b;
	if (ar === br || ac === bc) return true;
	return Math.floor(ar / 3) === Math.floor(br / 3) && Math.floor(ac / 3) === Math.floor(bc / 3);
}
/** Every row/column/box unit containing *both* cells - 0 for a diagonal
* (opposite-corner) UR pair, which never share any unit; 1 for an adjacent
* pair sharing just a row or column; 2 for an adjacent pair whose shared
* row/column also happens to be their shared box. */
function sharedUnitsOf(a, b) {
	return sudokuUnits().filter((unit) => unit.some(([r, c]) => r === a[0] && c === a[1]) && unit.some(([r, c]) => r === b[0] && c === b[1]));
}
/** Whether `digit` forms a strong link (conjugate pair) between exactly
* `a` and `b` in some unit they share - i.e. within that unit, no other
* cell has `digit` marked. Checks every shared unit (a row-and-box-adjacent
* pair might be linked via either, or both). */
function hasStrongLink(board, candidates, a, b, digit) {
	if (!candidates[a[0]][a[1]][digit - 1] || !candidates[b[0]][b[1]][digit - 1]) return false;
	for (const unit of sharedUnitsOf(a, b)) if (unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1]).length === 2) return true;
	return false;
}
function cellRef$2(row, col) {
	return `r${row + 1}c${col + 1}`;
}
function cellsLabel(cells) {
	return cells.map(([r, c]) => cellRef$2(r, c)).join(", ");
}
function bitCount(mask) {
	let count = 0;
	for (let m = mask; m !== 0; m &= m - 1) count++;
	return count;
}
/** "row 6" / "column 3" / "box 5" for one of sudokuUnits()'s houses. */
function houseLabel(house) {
	const [[r0, c0]] = house;
	if (house.every(([r]) => r === r0)) return `row ${r0 + 1}`;
	if (house.every(([, c]) => c === c0)) return `column ${c0 + 1}`;
	return `box ${Math.floor(r0 / 3) * 3 + Math.floor(c0 / 3) + 1}`;
}
/** Every unsolved cell outside the rectangle that still has `digit` marked
* and sees every one of `targets` - where a digit that must land on one of
* `targets` can't go. */
function cellsSeeingAll(board, candidates, rectangle, targets, digit) {
	const out = [];
	for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
		if (board[r][c] !== 0 || !candidates[r][c][digit - 1] || rectangle.some(([rr, rc]) => rr === r && rc === c)) continue;
		if (targets.every((target) => sameUnit$1([r, c], target))) out.push([r, c]);
	}
	return out;
}
function otherDigit(pair, digit) {
	return pair[0] === digit ? pair[1] : pair[0];
}
/**
* Unique Rectangle: four cells spanning exactly two rows, two columns, and
* two boxes, all able to hold the same two candidates ("UR digits") - if
* every one of those four cells resolved to only those two digits, the
* puzzle would have (at least) two solutions, swapping the digits
* diagonally between the two rows. A well-formed Sudoku has exactly one
* solution, so that "deadly pattern" can never actually be reached - every
* type below is a different way of using that fact, plus whatever extra
* local structure is on hand (an extra candidate, a strong link), to rule
* out specific candidates without knowing the grid's actual solution.
*
* "Pure" cells hold only the two UR digits; "non-bivalue" ones hold at
* least one more candidate besides. `find()` runs every type against every
* four-cell/two-digit combination and returns whichever fire - more than
* one type can apply to the same rectangle (their bivalue-count
* requirements aren't always mutually exclusive), so more than one
* instance can come back for it.
*/
/** Simplest-first order the difficulty order treats as one tier, but a
* consumer that wants "try easiest first" (Dynamic Dragon's Extension
* Rule 3, matching how it tries every other technique) still needs a
* concrete order - Type 1 is the most recognisable shape, then the "one
* shared extra candidate" ones (2, and 5, its diagonal/three-corner
* variant), then the ones needing only local structure (4, 7a), then the
* ones chaining further (7b), then the ones needing to check every unit a
* cell touches (7c, 7d). Type 3 sits right after 4: it needs a whole naked
* subset spotted around the rectangle, but no chaining. */
const TYPE_PRIORITY = {
	"Type 1": 0,
	"Type 2": 1,
	"Type 5": 2,
	"Type 4": 3,
	"Type 3": 4,
	"Type 7a": 5,
	"Type 7b": 6,
	"Type 7c": 7,
	"Type 7d": 8
};
/** A single-type instance's `type` is a literal key into TYPE_PRIORITY
* directly; a merged instance's is "Types 7a & 7d" (see
* `mergeSameRectangle`, whose join always puts the simplest contributing
* type first), so recovering the first name and re-adding the "Type "
* prefix looks it up the same way. */
function priorityOf(type) {
	if (type in TYPE_PRIORITY) return TYPE_PRIORITY[type];
	const first = type.match(/^Types? (\S+)/)?.[1];
	if (first === void 0) return Number.MAX_SAFE_INTEGER;
	return TYPE_PRIORITY[`Type ${first}`] ?? Number.MAX_SAFE_INTEGER;
}
function cellKey$1([r, c]) {
	return `${r}.${c}`;
}
function eliminationKey(e) {
	return `${e.row}.${e.col}.${e.digit}`;
}
/** Dedupes a list of cells/eliminations by their key, keeping first-seen
* order - used when merging several instances' `reasonCells` /
* `eliminatedCandidates` / `solvedCandidates`, which commonly overlap
* (the same strong-link cell, or even the same elimination, can be part of
* more than one instance's own reasoning). */
function dedupeByKey(items, key) {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const item of items) {
		const k = key(item);
		if (!seen.has(k)) {
			seen.add(k);
			out.push(item);
		}
	}
	return out;
}
/** "a", "a and b", "a, b and c". */
function joinList(items) {
	return items.length <= 1 ? items[0] ?? "" : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
/** "Type 7a", or "Types 7a & 7d" when more than one type contributed
* (simplest first, as `reasons` always is). */
function typeLabelOf(reasons) {
	const names = Array.from(new Set(reasons.map((r) => r.type)));
	return names.length === 1 ? names[0] : `Types ${names.map((t) => t.replace(/^Type /, "")).join(" & ")}`;
}
/** Folds paths that read naturally as one clause: Type 7d paths (the same
* Hidden Rectangle deduction seen from each bivalue corner - "6r1c4 and
* 6r9c6 are each strongly linked to both of their neighbouring corners"),
* and strong-link paths of one type from the same source candidate ("6r1c4
* is strongly linked to 6r1c6 and 6r9c4"). Anything else stays its own
* clause. Before this, a rectangle with three Type 7a and two Type 7d paths
* read as five near-identical "and where ..." clauses. */
function groupReasons(reasons) {
	const groups = /* @__PURE__ */ new Map();
	reasons.forEach((reason, i) => {
		const key = reason.type === "Type 7d" ? reason.type : reason.link ? `${reason.type}|${reason.link.from}` : `#${i}`;
		const group = groups.get(key);
		if (group) group.push(reason);
		else groups.set(key, [reason]);
	});
	return Array.from(groups.values(), (group) => ({
		type: group[0].type,
		clause: groupClause(group),
		reasons: group
	}));
}
function groupClause(group) {
	if (group.length === 1) return group[0].clause;
	const froms = Array.from(new Set(group.map((r) => r.link.from))).sort();
	if (froms.length === 1) return `${froms[0]} is strongly linked to ${joinList(Array.from(new Set(group.flatMap((r) => r.link.to))))}`;
	return `${joinList(froms)} are each strongly linked to both of their neighbouring corners`;
}
/** " (7a)" after each clause when more than one type is being told, so the
* reader can tell which type each clause is. */
function typeTag(group, multiType) {
	return multiType ? ` (${group.type.replace(/^Type /, "")})` : "";
}
/** The instance's `reasonText`: "UR <types> of {a,b} at <cells>, where
* <clause>[; <clause>...]" - conclusion-free, since Dynamic Dragon appends
* its own "which eliminates ...". */
function reasonTextOf(urDigits, cells, reasons) {
	const groups = groupReasons(reasons);
	const multiType = new Set(reasons.map((r) => r.type)).size > 1;
	const clauses = groups.map((group) => `${group.clause}${typeTag(group, multiType)}`);
	return `UR ${typeLabelOf(reasons)} of {${urDigits[0]},${urDigits[1]}} at ${cellsLabel(cells)}, where ${clauses.join("; ")}`;
}
/** Builds a single-path instance: its one reason, and the reasonText from it. */
function makeInstance(fields) {
	const { clause, link, ...instance } = fields;
	const reasons = [{
		type: instance.type,
		clause,
		...link && { link },
		eliminatedCandidates: instance.eliminatedCandidates,
		solvedCandidates: instance.solvedCandidates
	}];
	return {
		...instance,
		reasons,
		reasonText: reasonTextOf(instance.urDigits, instance.cells, reasons)
	};
}
/** The Techniques panel's wording for a UR instance. Unlike `reasonText`
* this knows the grid, so it can say what the eliminations actually leave:
*  - a cell cut to one candidate is stated as a placement ("r1c4 is 6"), not
*    as the elimination that happens to get it there;
*  - an elimination of that digit from a peer of the placement is left
*    unsaid (it follows from the placement; it's still in
*    eliminatedCandidates and still applied), and so is a path left with
*    nothing else to say;
* Text only: nothing here changes what the instance eliminates or solves.
*  - each remaining clause is followed by its own conclusion, instead of
*    every clause and then every elimination as two unconnected lists.
* A merged Types 7a & 7d rectangle used to read as five "and where"
* clauses plus five eliminations; it now reads as one placement clause and
* one elimination clause. */
function explainUniqueRectangle(ur, candidates) {
	const remainingAfter = (row, col, eliminated) => markedCandidateDigits(candidates[row][col]).filter((d) => !eliminated.some((e) => e.row === row && e.col === col && e.digit === d));
	const placements = dedupeByKey([...ur.solvedCandidates, ...ur.eliminatedCandidates.flatMap(({ row, col }) => {
		const left = remainingAfter(row, col, ur.eliminatedCandidates);
		return left.length === 1 ? [{
			row,
			col,
			digit: left[0]
		}] : [];
	})], eliminationKey);
	const placementAt = (row, col) => placements.find((p) => p.row === row && p.col === col);
	const followsFromPlacement = (e) => placements.some((p) => p.digit === e.digit && !(p.row === e.row && p.col === e.col) && sameUnit$1([p.row, p.col], [e.row, e.col]));
	const itemKey = (item) => `${item.placed}|${eliminationKey(item)}`;
	const stated = /* @__PURE__ */ new Set();
	const itemsByReason = /* @__PURE__ */ new Map();
	for (const reason of ur.reasons) {
		const items = reason.solvedCandidates.map((s) => ({
			placed: true,
			...s
		}));
		for (const e of reason.eliminatedCandidates) {
			const placement = placementAt(e.row, e.col);
			if (placement) items.push(remainingAfter(e.row, e.col, reason.eliminatedCandidates).length === 1 ? {
				placed: true,
				...placement
			} : {
				placed: false,
				...e
			});
			else if (!followsFromPlacement(e)) items.push({
				placed: false,
				...e
			});
		}
		const fresh = dedupeByKey(items, itemKey).filter((item) => !stated.has(itemKey(item)));
		if (fresh.length > 0) {
			fresh.forEach((item) => stated.add(itemKey(item)));
			itemsByReason.set(reason, fresh);
		}
	}
	const told = groupReasons(Array.from(itemsByReason.keys())).map((group) => ({
		group,
		items: group.reasons.flatMap((r) => itemsByReason.get(r))
	}));
	const grouped = (items, verb) => {
		const digitsByCell = /* @__PURE__ */ new Map();
		for (const { row, col, digit } of [...items].sort((a, b) => a.row - b.row || a.col - b.col || a.digit - b.digit)) {
			const entry = digitsByCell.get(`${row}.${col}`) ?? {
				row,
				col,
				digits: []
			};
			entry.digits.push(digit);
			digitsByCell.set(`${row}.${col}`, entry);
		}
		const cellsByDigits = /* @__PURE__ */ new Map();
		for (const { row, col, digits } of digitsByCell.values()) {
			const key = joinList(digits.map(String)).replace(/ and /, " or ");
			cellsByDigits.set(key, [...cellsByDigits.get(key) ?? [], cellRef$2(row, col)]);
		}
		return Array.from(cellsByDigits, ([digits, cells]) => `${joinList(cells)} ${verb(cells.length > 1)} ${digits}`);
	};
	const conclusion = (items) => [...grouped(items.filter((i) => i.placed), (plural) => plural ? "are" : "is"), ...grouped(items.filter((i) => !i.placed), () => "cannot be")].join(", ");
	const unstated = placements.filter((p) => !stated.has(`true|${eliminationKey(p)}`));
	const leaving = unstated.length > 0 ? `, leaving ${grouped(unstated, () => "as").join(", ")}` : "";
	const toldReasons = told.flatMap(({ group }) => group.reasons);
	const typeLabel = typeLabelOf(toldReasons);
	const multiType = new Set(toldReasons.map((r) => r.type)).size > 1;
	const header = `UR ${typeLabel} of {${ur.urDigits[0]},${ur.urDigits[1]}} at ${cellsLabel(ur.cells)}`;
	return {
		typeLabel,
		text: told.length === 1 ? `${header}, where ${told[0].group.clause}, thus ${conclusion(told[0].items)}${leaving}` : `${header}: ${told.map(({ group, items }) => `${group.clause}, so ${conclusion(items)}${typeTag(group, multiType)}`).join("; ")}${leaving}`,
		placements
	};
}
var SudokuUniqueRectangleFinder = class {
	/** `mergeTypes: false` skips `mergeSameRectangle`, so every instance keeps
	* its own single type and only its own eliminations - for the How It Works
	* lessons, which teach one type at a time from positions where another
	* type often fires on the same rectangle too. Everything that applies
	* eliminations wants the default (see mergeSameRectangle for why). */
	find(board, candidates, { mergeTypes = true } = {}) {
		const instances = [];
		for (let r1 = 0; r1 < 8; r1++) for (let r2 = r1 + 1; r2 < 9; r2++) {
			const sameBoxRow = Math.floor(r1 / 3) === Math.floor(r2 / 3);
			for (let c1 = 0; c1 < 8; c1++) for (let c2 = c1 + 1; c2 < 9; c2++) {
				if (sameBoxRow === (Math.floor(c1 / 3) === Math.floor(c2 / 3))) continue;
				const cells = [
					[r1, c1],
					[r1, c2],
					[r2, c1],
					[r2, c2]
				];
				if (cells.some(([r, c]) => board[r][c] !== 0)) continue;
				for (const pair of this.commonDigitPairs(candidates, cells)) {
					const pairInstances = [];
					this.findType1(candidates, cells, pair, pairInstances);
					this.findType2Or5(board, candidates, cells, pair, pairInstances);
					this.findType3(board, candidates, cells, pair, pairInstances);
					this.findType4(board, candidates, cells, pair, pairInstances);
					this.findType7a(board, candidates, cells, pair, pairInstances);
					this.findType7b(board, candidates, cells, pair, pairInstances);
					this.findType7c(board, candidates, cells, pair, pairInstances);
					this.findType7d(board, candidates, cells, pair, pairInstances);
					instances.push(...this.suppressType7bAnd7dCoveredByType4(pairInstances));
				}
			}
		}
		const deduped = this.dedupe(instances);
		return (mergeTypes ? this.mergeSameRectangle(deduped) : deduped).sort((a, b) => priorityOf(a.type) - priorityOf(b.type));
	}
	/** Different reasoning paths (a different bivalue cell, a different
	* strong-link direction) often reach the exact same conclusion for the
	* exact same type - keeps only one representative per (type, rectangle,
	* conclusion), the first found, rather than listing the identical
	* elimination or solve several times over. */
	dedupe(instances) {
		const bestByOutcome = /* @__PURE__ */ new Map();
		for (const instance of instances) {
			const cellsKey = [...instance.cells].map(([r, c]) => `${r}.${c}`).sort().join("-");
			const conclusionKey = [...instance.eliminatedCandidates, ...instance.solvedCandidates].map((c) => `${c.row}.${c.col}.${c.digit}`).sort().join("|");
			const key = `${instance.type}|${cellsKey}|${conclusionKey}`;
			if (!bestByOutcome.has(key)) bestByOutcome.set(key, instance);
		}
		return Array.from(bestByOutcome.values());
	}
	/** Type 7b and Type 7d always independently rediscover exactly the same
	* eliminations Type 4 already proves, whenever Type 4 applies to a
	* rectangle+pair - verified with a 1500-puzzle sweep: every single
	* Type-4-bearing rectangle also had a Type 7b instance *and* a Type 7d
	* instance with identical eliminations, zero exceptions. This isn't a
	* coincidence: Type 4's "digit d is locked to the two non-bivalue cells
	* via a strong link" is itself exactly the strong link both 7b's
	* chain-of-two-links and 7d's opposite-corner check are each independently
	* built to notice, so whenever it exists they always notice it too. Once
	* Type 4 has already found an elimination, listing 7b/7d's rediscovery of
	* the *exact same conclusion* alongside it (or, after mergeSameRectangle,
	* folding all three into one "Types 4 & 7b & 7d" row) is correct but
	* needlessly roundabout - Type 4 alone is already the simplest, most
	* direct proof there is. Called per digit pair, before mergeSameRectangle
	* ever sees these instances, so a Type-4-covered rectangle never even
	* reaches the panel under any name but "Type 4". */
	suppressType7bAnd7dCoveredByType4(instances) {
		const type4Keys = new Set(instances.filter((i) => i.type === "Type 4").flatMap((i) => i.eliminatedCandidates.map(eliminationKey)));
		if (type4Keys.size === 0) return [...instances];
		return instances.filter((i) => {
			if (!i.type.startsWith("Type 7b") && !i.type.startsWith("Type 7d")) return true;
			return !i.eliminatedCandidates.every((e) => type4Keys.has(eliminationKey(e)));
		});
	}
	/** Multiple instances - even of different types - can independently prove
	* a valid elimination for the exact same rectangle and digit pair at
	* once: a bivalue cell's digit can hold a strong link via its row *and*
	* a separate one via its column, and each drives a different type's own
	* proof (this is exactly how the "2 separate Type 7b/7c rows, applying
	* either one made the other disappear" report reproduced - both linked
	* off the same bivalue cell's same digit, just in different directions).
	* Listing these as separate Techniques-panel rows is actively misleading,
	* not just noisy: applying one elimination commonly removes the very
	* candidate the OTHER row's own strong link depended on, so that row
	* silently stops applying on the next recompute - indistinguishable, to a
	* user, from "Apply also removed the other row's elimination" even though
	* only the clicked row's own candidates were touched. Every instance in a
	* group here is independently valid against the *same* starting board
	* (nothing here is only true "if you also apply the other row"), so
	* merging them into one instance and applying them together sidesteps the
	* whole problem rather than trying to explain it. Also fixes a real
	* selection bug in the group-of-one-type case (several Type 7a directions
	* on the same rectangle, say): before this merge they all shared the same
	* `id` in App.tsx (which doesn't encode *which* conclusion an instance
	* reached, only its type/cells/digits), so clicking one row lit up every
	* row sharing that id as "active" at once. */
	mergeSameRectangle(instances) {
		const groups = /* @__PURE__ */ new Map();
		for (const instance of instances) {
			const key = `${[...instance.cells].map(cellKey$1).sort().join("-")}|${instance.urDigits.join(",")}`;
			const group = groups.get(key);
			if (group) group.push(instance);
			else groups.set(key, [instance]);
		}
		const merged = [];
		for (const group of groups.values()) {
			if (group.length === 1) {
				merged.push(group[0]);
				continue;
			}
			const sorted = [...group].sort((a, b) => priorityOf(a.type) - priorityOf(b.type));
			const [first] = sorted;
			const reasons = sorted.flatMap((i) => i.reasons);
			merged.push({
				type: typeLabelOf(reasons),
				reasons,
				cells: first.cells,
				urDigits: first.urDigits,
				reasonCells: dedupeByKey(sorted.flatMap((i) => i.reasonCells), cellKey$1),
				...sorted.some((i) => i.subsetCells) && { subsetCells: dedupeByKey(sorted.flatMap((i) => i.subsetCells ?? []), cellKey$1) },
				reasonText: reasonTextOf(first.urDigits, first.cells, reasons),
				eliminatedCandidates: dedupeByKey(sorted.flatMap((i) => i.eliminatedCandidates), eliminationKey),
				solvedCandidates: dedupeByKey(sorted.flatMap((i) => i.solvedCandidates), eliminationKey)
			});
		}
		return merged;
	}
	/** Every digit pair marked in all four cells - almost always at most one
	* in practice, but a cell can have more than two candidates, so more
	* than one pair can technically qualify. */
	commonDigitPairs(candidates, cells) {
		const cellDigits = cells.map(([r, c]) => new Set(markedCandidateDigits(candidates[r][c])));
		const pairs = [];
		for (let a = 1; a <= 9; a++) for (let b = a + 1; b <= 9; b++) if (cellDigits.every((digits) => digits.has(a) && digits.has(b))) pairs.push([a, b]);
		return pairs;
	}
	/** Type 1: three cells hold only the pair; the fourth ("extra") holds it
	* plus more. If it has exactly one extra candidate, that's its solution
	* (eliminating the pair from it); with two or more, only the pair can be
	* eliminated (which of the extras is real stays undetermined).
	*/
	findType1(candidates, cells, pair, out) {
		const [a, b] = pair;
		const cellDigits = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]));
		const pureIndices = cellDigits.flatMap((digits, i) => digits.length === 2 ? [i] : []);
		if (pureIndices.length !== 3) return;
		const extraIndex = [
			0,
			1,
			2,
			3
		].find((i) => !pureIndices.includes(i));
		const extraCell = cells[extraIndex];
		const extras = cellDigits[extraIndex].filter((d) => d !== a && d !== b);
		if (extras.length === 0) return;
		const clause = `${cellRef$2(...extraCell)} alone holds more than just the pair`;
		if (extras.length === 1) out.push(makeInstance({
			type: "Type 1",
			cells,
			urDigits: pair,
			reasonCells: [extraCell],
			clause,
			eliminatedCandidates: [],
			solvedCandidates: [{
				row: extraCell[0],
				col: extraCell[1],
				digit: extras[0]
			}]
		}));
		else out.push(makeInstance({
			type: "Type 1",
			cells,
			urDigits: pair,
			reasonCells: [extraCell],
			clause,
			eliminatedCandidates: [{
				row: extraCell[0],
				col: extraCell[1],
				digit: a
			}, {
				row: extraCell[0],
				col: extraCell[1],
				digit: b
			}],
			solvedCandidates: []
		}));
	}
	/** Types 2 and 5: every non-bivalue corner holds the pair plus the *same*
	* single extra candidate Z, and nothing else. If none of them were Z, each
	* would be one of the pair and all four corners would be the deadly
	* pattern - so at least one of them is Z, and Z can't go in any cell that
	* sees all of them. Type 2 is that with two corners sharing a row or
	* column (HoDoKu's "two non diagonal cells"); Type 5 is the same logic
	* with two diagonal corners or three corners, which just leaves fewer
	* cells seeing them all. Four extra corners is never reported - no cell
	* outside the rectangle can see all four. With one extra corner this is
	* Type 1 instead, so that case is left to findType1.
	*/
	findType2Or5(board, candidates, cells, pair, out) {
		const [a, b] = pair;
		const cellDigits = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]));
		const extraIndices = cellDigits.flatMap((digits, i) => digits.length > 2 ? [i] : []);
		if (extraIndices.length !== 2 && extraIndices.length !== 3) return;
		const extrasPerCell = extraIndices.map((i) => cellDigits[i].filter((d) => d !== a && d !== b));
		const z = extrasPerCell[0][0];
		if (!extrasPerCell.every((extras) => extras.length === 1 && extras[0] === z)) return;
		const extraCells = extraIndices.map((i) => cells[i]);
		const isType2 = extraCells.length === 2 && sameUnit$1(extraCells[0], extraCells[1]);
		const eliminations = cellsSeeingAll(board, candidates, cells, extraCells, z).map(([r, c]) => ({
			row: r,
			col: c,
			digit: z
		}));
		if (eliminations.length === 0) return;
		const type = isType2 ? "Type 2" : "Type 5";
		out.push(makeInstance({
			type,
			cells,
			urDigits: pair,
			reasonCells: extraCells,
			clause: `one of ${cellsLabel(extraCells)} must be ${z}, their only extra candidate`,
			eliminatedCandidates: eliminations,
			solvedCandidates: []
		}));
	}
	/** Type 3: exactly two corners have extra candidates, and they share a row
	* or column (the other two hold only the pair). They can't both be one of
	* the pair (deadly pattern), so at least one of them is one of their extra
	* digits E - which lets the two be counted as one "virtual cell" holding
	* just E. If, in a house containing both, that virtual cell plus N other
	* cells hold only N+1 digits between them, it's a naked subset: those
	* N+1 digits are all placed within it, so they leave every other cell of
	* that house (and of any other house the whole subset also sits in - the
	* "locked" case, e.g. a row subset that's all in one box too).
	*
	* No cap on N beyond "leave at least one cell to eliminate from": a big
	* subset is still the same argument, and real positions do need one (the
	* reference example uses a 4-extra-digit virtual cell plus 4 other cells
	* of the row). Only the smallest subset per house that eliminates
	* something is reported, so the wording names as few cells as it can.
	* A single shared extra digit is Type 2 instead (N = 0), so E must have
	* at least two digits.
	*/
	findType3(board, candidates, cells, pair, out) {
		const [a, b] = pair;
		const cellDigits = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c]));
		const extraIndices = cellDigits.flatMap((digits, i) => digits.length > 2 ? [i] : []);
		if (extraIndices.length !== 2) return;
		const [x, y] = extraIndices.map((i) => cells[i]);
		if (!sameUnit$1(x, y)) return;
		let extraMask = 0;
		for (const i of extraIndices) for (const d of cellDigits[i]) if (d !== a && d !== b) extraMask |= 1 << d;
		if (bitCount(extraMask) < 2) return;
		const maskOf = ([r, c]) => markedCandidateDigits(candidates[r][c]).reduce((mask, d) => mask | 1 << d, 0);
		for (const unit of sharedUnitsOf(x, y)) {
			const others = unit.filter(([r, c]) => board[r][c] === 0 && !(r === x[0] && c === x[1]) && !(r === y[0] && c === y[1]));
			const otherMasks = others.map(maskOf);
			found: for (let size = 1; size < others.length; size++) for (let chosen = 1; chosen < 1 << others.length; chosen++) {
				if (bitCount(chosen) !== size) continue;
				let digitMask = extraMask;
				for (let i = 0; i < others.length; i++) if (chosen & 1 << i) digitMask |= otherMasks[i];
				if (bitCount(digitMask) !== size + 1) continue;
				const subsetCells = others.filter((_, i) => chosen & 1 << i);
				const allSubsetCells = [
					x,
					y,
					...subsetCells
				];
				const houses = sudokuUnits().filter((house) => allSubsetCells.every(([sr, sc]) => house.some(([r, c]) => r === sr && c === sc)));
				const eliminations = [];
				const seen = /* @__PURE__ */ new Set();
				for (const house of houses) for (const [r, c] of house) {
					if (board[r][c] !== 0 || allSubsetCells.some(([sr, sc]) => sr === r && sc === c) || seen.has(`${r}.${c}`)) continue;
					seen.add(`${r}.${c}`);
					for (let d = 1; d <= 9; d++) if (digitMask & 1 << d && candidates[r][c][d - 1]) eliminations.push({
						row: r,
						col: c,
						digit: d
					});
				}
				if (eliminations.length === 0) continue;
				const digitsLabel = (mask) => [
					1,
					2,
					3,
					4,
					5,
					6,
					7,
					8,
					9
				].filter((d) => mask & 1 << d).join(",");
				out.push(makeInstance({
					type: "Type 3",
					cells,
					urDigits: pair,
					reasonCells: [x, y],
					subsetCells,
					clause: `the extras {${digitsLabel(extraMask)}} of ${cellsLabel([x, y])} form a naked subset {${digitsLabel(digitMask)}} with ${cellsLabel(subsetCells)} in ${houses.map(houseLabel).join(" and ")}`,
					eliminatedCandidates: eliminations,
					solvedCandidates: []
				}));
				break found;
			}
		}
	}
	/** Type 4: exactly two cells are non-bivalue and see each other (share a
	* row, column, or box). If one UR digit is confined to just those two
	* cells within that shared unit (a strong link), it must be placed in
	* one of them - so the *other* UR digit can never be either cell's
	* solution (whichever of the two isn't the confined digit must be one of
	* its own extra candidates instead, not the pair's other member).
	*/
	findType4(board, candidates, cells, pair, out) {
		const [a, b] = pair;
		const nonBivalueIndices = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c])).flatMap((digits, i) => digits.length > 2 ? [i] : []);
		if (nonBivalueIndices.length !== 2) return;
		const [x, y] = nonBivalueIndices.map((i) => cells[i]);
		if (!sameUnit$1(x, y)) return;
		for (const digit of [a, b]) {
			if (!hasStrongLink(board, candidates, x, y, digit)) continue;
			const eliminated = otherDigit(pair, digit);
			const eliminations = [x, y].filter(([r, c]) => candidates[r][c][eliminated - 1]).map(([r, c]) => ({
				row: r,
				col: c,
				digit: eliminated
			}));
			if (eliminations.length === 0) continue;
			out.push(makeInstance({
				type: "Type 4",
				cells,
				urDigits: pair,
				reasonCells: [x, y],
				clause: `${digit} is locked to ${cellsLabel([x, y])}`,
				eliminatedCandidates: eliminations,
				solvedCandidates: []
			}));
		}
	}
	/** Type 7a: the two bivalue cells are opposite corners (so the two
	* non-bivalue cells are too). From each bivalue cell A, a strong link for
	* either UR digit to one of its two non-bivalue neighbours means that
	* digit must be there or nowhere else useful in that unit - either way,
	* the *other* non-bivalue neighbour can't be the other UR digit's
	* placement without reopening the deadly pattern, so eliminate it there.
	*/
	findType7a(board, candidates, cells, pair, out) {
		const bivalueIndices = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c])).flatMap((digits, i) => digits.length === 2 ? [i] : []);
		if (bivalueIndices.length !== 2) return;
		const [bi1, bi2] = bivalueIndices;
		if (sameUnit$1(cells[bi1], cells[bi2])) return;
		const nonBivalueIndices = [
			0,
			1,
			2,
			3
		].filter((i) => !bivalueIndices.includes(i));
		for (const aIndex of bivalueIndices) {
			const A = cells[aIndex];
			const neighbours = nonBivalueIndices.filter((i) => sameUnit$1(cells[i], A));
			if (neighbours.length !== 2) continue;
			for (const [ni, otherNi] of [[neighbours[0], neighbours[1]], [neighbours[1], neighbours[0]]]) {
				const N = cells[ni];
				const otherN = cells[otherNi];
				for (const digit of pair) {
					if (!hasStrongLink(board, candidates, A, N, digit)) continue;
					if (!candidates[otherN[0]][otherN[1]][digit - 1]) continue;
					const link = {
						from: `${digit}${cellRef$2(...A)}`,
						to: [`${digit}${cellRef$2(...N)}`]
					};
					out.push(makeInstance({
						type: "Type 7a",
						cells,
						urDigits: pair,
						reasonCells: [A, N],
						clause: `${link.from} is strongly linked to ${link.to[0]}`,
						link,
						eliminatedCandidates: [{
							row: otherN[0],
							col: otherN[1],
							digit
						}],
						solvedCandidates: []
					}));
				}
			}
		}
	}
	/** Type 7b: one or two bivalue cells (if two, they're adjacent - sharing
	* a row or column). Starting from a bivalue cell A, one of its digits (X)
	* strongly links to another UR cell B (forced to be the *other* bivalue
	* cell, when there is one); from B, the *other* UR digit (Y) strongly
	* links onward to a third UR cell C that sees B but isn't A. When both
	* links hold, X can't be the fourth ("remaining") cell's solution either
	* - eliminate it there.
	*/
	findType7b(board, candidates, cells, pair, out) {
		const bivalueIndices = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c])).flatMap((digits, i) => digits.length === 2 ? [i] : []);
		if (bivalueIndices.length < 1 || bivalueIndices.length > 2) return;
		const secondBivalueIndex = bivalueIndices.length === 2 ? bivalueIndices[1] : null;
		for (const aIndex of bivalueIndices) {
			const forcedBIndex = bivalueIndices.length === 2 ? aIndex === bivalueIndices[0] ? secondBivalueIndex : bivalueIndices[0] : null;
			const A = cells[aIndex];
			const aNeighbours = [
				0,
				1,
				2,
				3
			].filter((i) => i !== aIndex && sameUnit$1(cells[i], A));
			for (const X of pair) for (const bIndex of aNeighbours) {
				if (forcedBIndex !== null && bIndex !== forcedBIndex) continue;
				if (!hasStrongLink(board, candidates, A, cells[bIndex], X)) continue;
				const B = cells[bIndex];
				const Y = otherDigit(pair, X);
				const cCandidates = [
					0,
					1,
					2,
					3
				].filter((i) => i !== aIndex && i !== bIndex && sameUnit$1(cells[i], B));
				for (const cIndex of cCandidates) {
					if (!hasStrongLink(board, candidates, B, cells[cIndex], Y)) continue;
					const D = cells[[
						0,
						1,
						2,
						3
					].find((i) => i !== aIndex && i !== bIndex && i !== cIndex)];
					if (!candidates[D[0]][D[1]][X - 1]) continue;
					out.push(makeInstance({
						type: "Type 7b",
						cells,
						urDigits: pair,
						reasonCells: [
							A,
							B,
							cells[cIndex]
						],
						clause: `${X}${cellRef$2(...A)} strong links ${X}${cellRef$2(...B)} and ${Y}${cellRef$2(...B)} strong links ${Y}${cellRef$2(...cells[cIndex])}`,
						eliminatedCandidates: [{
							row: D[0],
							col: D[1],
							digit: X
						}],
						solvedCandidates: []
					}));
				}
			}
		}
	}
	/** Type 7c: exactly one bivalue cell (two would make this a Type 4
	* instead). Each of the rectangle's two rows (or two columns) carries a
	* strong link for one of the two UR digits, the two links between them
	* covering all four cells - i.e. one digit is locked to one row and the
	* other digit to the other row (or the column equivalent). The bivalue
	* cell belongs to one of those two links; its own linked digit can't be
	* the solution of its *other* neighbour (the one from the far link), so
	* eliminate it there.
	*/
	findType7c(board, candidates, cells, pair, out) {
		const bivalueIndices = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c])).flatMap((digits, i) => digits.length === 2 ? [i] : []);
		if (bivalueIndices.length !== 1) return;
		const aIndex = bivalueIndices[0];
		const A = cells[aIndex];
		for (const splits of [[[0, 1], [2, 3]], [[0, 2], [1, 3]]]) for (const [d1, d2] of [pair, [pair[1], pair[0]]]) {
			const [i1, j1] = splits[0];
			const [i2, j2] = splits[1];
			if (!hasStrongLink(board, candidates, cells[i1], cells[j1], d1)) continue;
			if (!hasStrongLink(board, candidates, cells[i2], cells[j2], d2)) continue;
			const aInFirst = i1 === aIndex || j1 === aIndex;
			if (aInFirst === (i2 === aIndex || j2 === aIndex)) continue;
			const [ownLink, ownDigit, otherLink] = aInFirst ? [
				[i1, j1],
				d1,
				[i2, j2]
			] : [
				[i2, j2],
				d2,
				[i1, j1]
			];
			const aOwnPartnerIndex = ownLink[0] === aIndex ? ownLink[1] : ownLink[0];
			const targetIndex = otherLink.find((i) => sameUnit$1(cells[i], A));
			if (targetIndex === void 0) continue;
			const target = cells[targetIndex];
			if (!candidates[target[0]][target[1]][ownDigit - 1]) continue;
			out.push(makeInstance({
				type: "Type 7c",
				cells,
				urDigits: pair,
				reasonCells: [A, cells[aOwnPartnerIndex]],
				clause: `${cellRef$2(...A)}'s ${ownDigit} is strongly linked to ${cellRef$2(...cells[aOwnPartnerIndex])}`,
				eliminatedCandidates: [{
					row: target[0],
					col: target[1],
					digit: ownDigit
				}],
				solvedCandidates: []
			}));
		}
	}
	/** Type 7d (Hidden Rectangle): one or two bivalue cells. For each one,
	* look at its opposite corner Z (which the puzzle string's own examples
	* show can itself be bivalue, when there are two, diagonally placed).
	* If one of Z's UR digits is strongly linked in *all three* of its row,
	* column, and box (each confined to the UR cells it shares that unit
	* with), that digit is confined to Z or Z's own row/column-mate no
	* matter which - so it can never be missing from Z's row or column
	* without leaving nowhere for it - meaning Z's *other* UR digit can't be
	* Z's solution, eliminate it there.
	*/
	findType7d(board, candidates, cells, pair, out) {
		const bivalueIndices = cells.map(([r, c]) => markedCandidateDigits(candidates[r][c])).flatMap((digits, i) => digits.length === 2 ? [i] : []);
		if (bivalueIndices.length < 1 || bivalueIndices.length > 2) return;
		const oppositeOf = [
			3,
			2,
			1,
			0
		];
		for (const aIndex of bivalueIndices) {
			const zIndex = oppositeOf[aIndex];
			const Z = cells[zIndex];
			const zNeighbourIndices = [
				0,
				1,
				2,
				3
			].filter((i) => i !== zIndex && sameUnit$1(cells[i], Z));
			if (zNeighbourIndices.length !== 2) continue;
			for (const digit of pair) {
				if (!zNeighbourIndices.every((i) => hasStrongLink(board, candidates, Z, cells[i], digit))) continue;
				const eliminated = otherDigit(pair, digit);
				if (!candidates[Z[0]][Z[1]][eliminated - 1]) continue;
				const link = {
					from: `${digit}${cellRef$2(...Z)}`,
					to: zNeighbourIndices.map((i) => `${digit}${cellRef$2(...cells[i])}`)
				};
				out.push(makeInstance({
					type: "Type 7d",
					cells,
					urDigits: pair,
					reasonCells: [cells[aIndex], Z],
					clause: `${link.from} is strongly linked to both ${link.to[0]} and ${link.to[1]}`,
					link,
					eliminatedCandidates: [{
						row: Z[0],
						col: Z[1],
						digit: eliminated
					}],
					solvedCandidates: []
				}));
			}
		}
	}
};
//#endregion
//#region src/sudoku/SudokuDragonFinder.ts
/** How the second Dragon's colours read in its moves - see
* DragonMove.secondDragon. */
const SECOND_DRAGON_LABELS = {
	blue: "pink",
	darkBlue: "purple",
	yellow: "lime green",
	orange: "dark green"
};
/** A label for `color` as the second Dragon's (`second`) or the first's. */
function dragonColourLabel(color, second = false) {
	return second ? SECOND_DRAGON_LABELS[color] : colorLabel(color);
}
/** The second Dragon's moves are built by the same rules as any Dragon's,
* so their descriptions name Dragon's usual colours - renamed here. */
function renameToSecondDragon(text) {
	const byLabel = {
		"light blue": "blue",
		"dark blue": "darkBlue",
		yellow: "yellow",
		orange: "orange"
	};
	return text.replace(/\b(light blue|dark blue|yellow|orange)\b/g, (label) => SECOND_DRAGON_LABELS[byLabel[label]]);
}
/** Two candidates that can't both be true: the same cell and different
* digits, or the same digit in a shared unit - a weak link. */
function cannotBothBeTrue(a, b) {
	return a.row === b.row && a.col === b.col ? a.digit !== b.digit : a.digit === b.digit && sameUnit([a.row, a.col], [b.row, b.col]);
}
/** Whether some node of one colouring and some node of the other can't both
* be true - what a Dragon link needs. */
function anyDragonLink(a, b) {
	return a.some((x) => b.some((y) => cannotBothBeTrue(x, y)));
}
function sideOf(color) {
	return color === "blue" || color === "darkBlue" ? "A" : "B";
}
function isPrimary(color) {
	return color === "blue" || color === "yellow";
}
function primaryForSide(side) {
	return side === "A" ? "blue" : "yellow";
}
function secondaryForSide(side) {
	return side === "A" ? "darkBlue" : "orange";
}
function sideOfPrimary(primary) {
	return primary === "blue" ? "A" : "B";
}
function oppositeSide(side) {
	return side === "A" ? "B" : "A";
}
function oppositePrimary(primary) {
	return primary === "blue" ? "yellow" : "blue";
}
function colorLabel(color) {
	switch (color) {
		case "blue": return "light blue";
		case "yellow": return "yellow";
		case "darkBlue": return "dark blue";
		case "orange": return "orange";
	}
}
function cellRef$1(row, col) {
	return `r${row + 1}c${col + 1}`;
}
function nodeKey(row, col, digit) {
	return `${row},${col},${digit}`;
}
function cellKey(row, col) {
	return `${row},${col}`;
}
/** Deduplicated (row, col) cells a set of candidate eliminations touched -
* used to check whether one Extension Rule 3 step's application narrowed a
* cell that a later step's basis depends on. */
function uniqueCells(eliminations) {
	const seen = /* @__PURE__ */ new Map();
	for (const { row, col } of eliminations) seen.set(cellKey(row, col), [row, col]);
	return Array.from(seen.values());
}
/** Every Rule3Technique, in the order the settings checkboxes and
* findExtensionRule3Move's own simulation loop present them. 'naked pair'
* can never be excluded (see extend()'s allowedTechniques) - it's included
* here anyway so this stays the single source of truth for "every
* technique that exists". */
const ALL_RULE3_TECHNIQUES = [
	"hidden single",
	"locked candidate",
	"naked pair",
	"naked triple",
	"naked quad",
	"hidden pair",
	"UR",
	"bivalue oddagon",
	"BUG+1",
	"avoidable rectangle",
	"x-wing",
	"short single-digit aic",
	"finned x-wing",
	"short aic",
	"swordfish",
	"finned swordfish",
	"generic aic",
	"als-xz"
];
/** The late part of findExtensionRule3Move's simulation, after every
* technique above: fish and AIC kinds interleaved in the app's difficulty
* order, each one tried in full before the next - then ALS-xz, the one
* technique ranked above Generic AIC. */
const FISH_AND_AIC_RULE3_ORDER = [
	"x-wing",
	"short single-digit aic",
	"finned x-wing",
	"short aic",
	"swordfish",
	"finned swordfish",
	"generic aic",
	"als-xz"
];
/** ALL_RULE3_TECHNIQUES minus every AIC kind, every fish, ALS-xz and Avoidable
* Rectangle (opt-in by request, though always on as a standalone technique) - the default
* allowed set for both extend()'s own fallback and the app's initial
* settings state, since the AIC kinds, fish and ALS-xz are all opt-in for
* Dynamic Dragon Colouring (a fish or ALS-xz only even exists as a technique
* once it's enabled in Settings), while Bivalue Oddagon and BUG+1 (like every other
* technique here) default to on. */
const DEFAULT_RULE3_TECHNIQUES = ALL_RULE3_TECHNIQUES.filter((t) => t !== "short aic" && t !== "short single-digit aic" && t !== "generic aic" && t !== "als-xz" && t !== "avoidable rectangle" && !ALL_FISH_TECHNIQUES.includes(t));
/** Which kind of unit a set of cells belongs to - used to say "row",
* "column", or "box" instead of the vaguer "section" wherever a
* conclusion follows from a specific unit sudokuUnits() produced. */
function classifyUnitKind(cells) {
	if (cells.every(([r]) => r === cells[0][0])) return "row";
	if (cells.every(([, c]) => c === cells[0][1])) return "column";
	return "box";
}
function sameUnit(a, b) {
	const [ar, ac] = a;
	const [br, bc] = b;
	if (ar === br || ac === bc) return true;
	return Math.floor(ar / 3) === Math.floor(br / 3) && Math.floor(ac / 3) === Math.floor(bc / 3);
}
/**
* Dragon Colouring: an extension of 3D Medusa for chains Medusa's own rules
* get stuck on. Medusa's two colors (the "primary"/"medusa" colors) become
* two *sides*, each gaining a "secondary"/"dragon" color that marks a
* candidate as true *conditional on* its side's primary color being true -
* derived the same way a hidden or naked single would be, but under that
* assumption instead of firm knowledge. Two extension rules grow this
* conditional coloring; a promotion rule upgrades a conditional color to
* unconditional once two opposite-side colors of the same candidate prove
* each other's side always holds; and Medusa's own elimination rules 1-5
* then apply again, generalized to compare *sides* (primary + its own
* secondary count as the same side) instead of exact colors.
*
* Simplification: this treats "Medusa gets stuck" as "this chain has none
* of Medusa's own rules 1-5 available" (checked by the caller before
* calling `extend`), and reasons entirely from one fixed snapshot of the
* board's candidates - it does not re-derive new conjugate pairs that
* eliminating a candidate might create along the way, the way a from-
* scratch re-solve would. That keeps the session's moves attributable to
* one consistent coloring pass rather than an open-ended solve loop.
*/
/** Safety cap on Extension Rule 3's own inner simulation loop - in
* practice a handful of applications either finds a forced cell or gets
* stuck, but naked triples/quads make each re-scan of the hypothetical
* board noticeably pricier than pairs alone, so a pathological candidate
* layout is capped here rather than risking the UI hanging on it (this
* runs live, on every board/candidate change). */
const MAX_RULE3_SIMULATION_STEPS = 200;
/** "Limit to 1 AIC per step" while collecting every move (Optimize Dynamic
* Dragons' enumeration, Autocomplete): the most AIC branches one simulation
* tries - see extensionRule3Moves. A single move (the default loop) tries
* every branch until one works. */
const MAX_RULE3_ENUMERATION_AIC_BRANCHES = 8;
/** When collecting *every* move (Optimize Dynamic Dragons), the simulation
* runs until nothing more applies instead of stopping at its first forced
* candidate - and with AICs enabled, every step that no simpler technique
* covers starts a full AIC search, by far the costliest part (a generic AIC
* search especially). So the AIC search may run only this many times per
* collecting simulation; after that, AICs count as "nothing more applies".
* The non-AIC techniques are cheap and aren't limited, so with AICs off
* (the default) this changes nothing. Measured: capping *all* steps instead
* cost as much quality with AICs off as on. */
const MAX_RULE3_ENUMERATION_AIC_SEARCHES = 4;
/** Optimize Dragons' per-phase search budget, counted in distinct colourings
* tried (each one an elimination check, and later its own extension scan).
* Past it, the phase falls back to the default alternating result, so this
* only bounds how hard it tries, never correctness. Sized for a computation
* that runs live on every board change, per stuck chain.
*
* The first phase (Medusa to first elimination - the Dragon itself) gets the
* full budget. Exhaustive mode's later phases start from an already long
* colouring whose alternating baseline is typically far deeper than any
* search can reach, so they'd mostly just burn the budget before falling
* back; they get a smaller one. */
const OPTIMIZE_MAX_SEARCH_STATES = 3e3;
const OPTIMIZE_MAX_SEARCH_STATES_LATER_PHASES = 500;
/** Optimize Dynamic Dragons' per-phase budget of fresh Extension Rule 3
* simulations (each one the whole technique battery, run until nothing more
* applies, on one side's hypothetical board). Past it, a newly reached
* colouring doesn't get its own simulation and uses the Rule 3 moves it
* inherited instead (see OptimizeState.rule3Known) - still valid, just
* possibly missing a move only its newest candidate unlocks. The search is
* breadth-first, so the budget goes to the shallowest colourings first,
* where a shorter Dragon would be. */
const OPTIMIZE_MAX_RULE3_SIMULATIONS = 20;
const OPTIMIZE_MAX_RULE3_SIMULATIONS_LATER_PHASES = 2;
/** The same, for plain Optimize Dragons' Rule 3 fallback in dynamic mode
* (one simulation, stopping at its first forced candidate, for a side with
* no plain extension) - cheaper each, so more of them. */
const OPTIMIZE_MAX_RULE3_FALLBACK_SIMULATIONS = 60;
const OPTIMIZE_MAX_RULE3_FALLBACK_SIMULATIONS_LATER_PHASES = 15;
/** Every cell index (row * 9 + col) sharing a row, column or box with each
* cell - the cell itself included, as sameUnit counts it. Fixed, so built
* once. */
const PEERS_WITH_SELF = Array.from({ length: 81 }, (_, cell) => {
	const r = Math.floor(cell / 9);
	const c = cell % 9;
	const peers = [];
	for (let other = 0; other < 81; other++) {
		const r2 = Math.floor(other / 9);
		const c2 = other % 9;
		if (r === r2 || c === c2 || Math.floor(r / 3) === Math.floor(r2 / 3) && Math.floor(c / 3) === Math.floor(c2 / 3)) peers.push(other);
	}
	return peers;
});
/** seen[(digit - 1) * 81 + row * 9 + col]: some node passing `include`, of
* that digit, is in a different cell sharing a row, column or box with this
* one - exactly what the old per-cell "sees this colour" scans (seesSide,
* Extension Rule 1's seesPrimary) asked, own cell excluded. */
function seenByNodes(nodes, include) {
	const seen = /* @__PURE__ */ new Uint8Array(729);
	for (const n of nodes) {
		if (!include(n)) continue;
		const cell = n.row * 9 + n.col;
		const base = (n.digit - 1) * 81;
		for (const peer of PEERS_WITH_SELF[cell]) if (peer !== cell) seen[base + peer] = 1;
	}
	return seen;
}
/** Whether findEliminationMoves would return anything - the same conditions
* as findMassElimination and findRule3/4/5, each only asking whether a
* match exists, answered from one table of which cells see each (side,
* digit) instead of scanning every node per candidate. Must stay exactly in
* step with those methods: a false "no" would silently drop eliminations.
* They only ever look at a node's side, never primary vs dragon colour, so
* neither does this. */
function hasAnyElimination(nodes, board, candidates) {
	const sees = /* @__PURE__ */ new Uint8Array(1458);
	const cellSides = /* @__PURE__ */ new Uint8Array(81);
	const cellNodeCount = /* @__PURE__ */ new Uint8Array(81);
	const cellFirstDigit = /* @__PURE__ */ new Uint8Array(81);
	const colored = /* @__PURE__ */ new Uint8Array(729);
	for (const n of nodes) {
		const cell = n.row * 9 + n.col;
		const side = sideOf(n.color) === "A" ? 0 : 1;
		const base = (side * 9 + n.digit - 1) * 81;
		if (cellSides[cell] & 1 << side || sees[base + cell]) return true;
		cellSides[cell] |= 1 << side;
		if (cellNodeCount[cell]++ === 0) cellFirstDigit[cell] = n.digit;
		colored[cell * 9 + n.digit - 1] = 1;
		for (const peer of PEERS_WITH_SELF[cell]) sees[base + peer] = 1;
	}
	for (let cell = 0; cell < 81; cell++) {
		const row = Math.floor(cell / 9);
		const col = cell % 9;
		if (board[row][col] !== 0) continue;
		const marks = candidates[row][col];
		const sides = cellSides[cell];
		if (sides === 0) {
			let anyDigit = false;
			let allSeeA = true;
			let allSeeB = true;
			for (let d = 0; d < 9; d++) {
				if (!marks[d]) continue;
				anyDigit = true;
				allSeeA &&= sees[d * 81 + cell] === 1;
				allSeeB &&= sees[(9 + d) * 81 + cell] === 1;
			}
			if (anyDigit && (allSeeA || allSeeB)) return true;
		}
		for (let d = 0; d < 9; d++) {
			if (!marks[d] || colored[cell * 9 + d]) continue;
			if (sees[d * 81 + cell] && sees[(9 + d) * 81 + cell]) return true;
			if (sides === 3) return true;
			if (cellNodeCount[cell] === 1 && d + 1 !== cellFirstDigit[cell]) {
				if (sees[((sides === 1 ? 1 : 0) * 9 + d) * 81 + cell]) return true;
			}
		}
	}
	return false;
}
/** How many Rule 3 finder results memoFind keeps (all finders together).
* Measured on a 41-step solve path (every AIC kind, AIC limit off, Optimize
* Dynamic on): Dynamic Dragon work took 21.3 s with no cache, 17.0 s at
* 5000 entries (~6 MB retained), 15.7 s at 20000 (~29 MB). 10000 is the
* middle of that curve, ~15 MB. */
const FINDER_MEMO_MAX_ENTRIES = 1e4;
/** The whole grid as a compact string: per cell, its digit (or 0) and its
* candidate marks as a 9-bit mask - two characters, so equal keys mean
* exactly equal grids. */
/** A givens mask as a memo key part (81 chars). */
function givensKey(givens) {
	let key = "";
	for (const row of givens) for (const given of row) key += given ? "1" : "0";
	return key;
}
function gridKey(board, candidates) {
	let key = "";
	for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
		const marks = candidates[row][col];
		let mask = 0;
		for (let d = 0; d < 9; d++) if (marks[d]) mask |= 1 << d;
		key += String.fromCharCode(48 + board[row][col], 16384 + mask);
	}
	return key;
}
/** A colouring's identity for Optimize Dragons' state dedup - which
* candidates carry which colour, independent of the order they got it. */
function colouringSignature(nodeMap) {
	const codes = new Uint16Array(nodeMap.size);
	let i = 0;
	for (const n of nodeMap.values()) codes[i++] = ((n.row * 9 + n.col) * 9 + n.digit - 1) * 4 + COLOR_CODE[n.color];
	codes.sort();
	return String.fromCharCode(...codes);
}
const COLOR_CODE = {
	blue: 0,
	yellow: 1,
	darkBlue: 2,
	orange: 3
};
var SudokuDragonFinder = class {
	/** Extension Rule 3 finder results by hypothetical grid - see memoFind. */
	finderMemo = /* @__PURE__ */ new Map();
	/** Every Rule 3 technique finder is a pure function of (board,
	* candidates), and the same hypothetical grid comes up again and again:
	* the default path, Optimize's fallback and Optimize Dynamic's every-move
	* simulation all simulate the same colourings, stepping through identical
	* grids until they first diverge, and consecutive solve-path positions
	* repeat many of them too (measured: ~45% of all finder calls on a long
	* solve path were a grid already seen). So each result is kept, keyed by
	* finder and the grid itself (gridKey - the whole grid, not a hash, so a
	* hit is always the identical input), in a bounded least-recently-used
	* map. Results are only ever read, never mutated, by the simulation and
	* the moves it builds, so sharing them is safe. */
	memoFind(finder, grid, compute) {
		const key = `${finder}|${grid}`;
		if (this.finderMemo.has(key)) {
			const hit = this.finderMemo.get(key);
			this.finderMemo.delete(key);
			this.finderMemo.set(key, hit);
			return hit;
		}
		const result = compute();
		this.finderMemo.set(key, result);
		if (this.finderMemo.size > FINDER_MEMO_MAX_ENTRIES) this.finderMemo.delete(this.finderMemo.keys().next().value);
		return result;
	}
	pairFinder = new SudokuPairFinder();
	lockedCandidateFinder = new SudokuLockedCandidateFinder();
	medusaFinder = new SudokuMedusaFinder();
	nakedSubsetFinder = new SudokuNakedSubsetFinder();
	hiddenPairFinder = new SudokuHiddenPairFinder();
	fishFinder = new SudokuFishFinder();
	shortAicFinder = new SudokuShortAicFinder();
	genericAicFinder = new SudokuGenericAicFinder();
	alsXzFinder = new SudokuAlsXzFinder();
	uniqueRectangleFinder = new SudokuUniqueRectangleFinder();
	bugPlusOneFinder = new SudokuBugPlusOneFinder();
	avoidableRectangleFinder = new SudokuAvoidableRectangleFinder();
	bivalueOddagonFinder = new SudokuBivalueOddagonFinder();
	extend(medusaChain, board, candidates, options = {}) {
		const nodeMap = /* @__PURE__ */ new Map();
		const seed = medusaChain.candidates.map((c) => ({
			row: c.row,
			col: c.col,
			digit: c.digit,
			color: c.color
		}));
		for (const n of seed) nodeMap.set(nodeKey(n.row, n.col, n.digit), n);
		return this.extendFromState(nodeMap, [this.buildMedusaMove(seed)], board, candidates, options);
	}
	/** Double Dragon Colouring's first Dragon: plain Dragon Colouring (the
	* default extend(), no options) from `medusaChain`, carried on until it
	* gets stuck - its final colouring and the moves that built it. Null when
	* plain Dragon resolves the chain instead (it isn't stuck). The colouring
	* is only ever "side true => candidate true" facts, so it stays valid after
	* the run finds nothing; extend() just discards it. */
	stuckColouring(medusaChain, board, candidates, dynamicOptions = null) {
		const nodeMap = /* @__PURE__ */ new Map();
		const seed = medusaChain.candidates.map((c) => ({
			row: c.row,
			col: c.col,
			digit: c.digit,
			color: c.color
		}));
		for (const n of seed) nodeMap.set(nodeKey(n.row, n.col, n.digit), n);
		const moves = [this.buildMedusaMove(seed)];
		if (this.extendFromState(nodeMap, moves, board, candidates, dynamicOptions ? {
			...dynamicOptions,
			dynamic: true
		} : {})) return null;
		return {
			nodes: Array.from(nodeMap.values()),
			moves
		};
	}
	/**
	* Double Dragon Colouring: a second plain Dragon, from `secondChain`, that
	* may also lean on a first, stuck Dragon (`first`, from stuckColouring on
	* another chain).
	*
	* Sides: the first Dragon's A (light blue/dark blue) and B (yellow/orange),
	* exactly one true; the second Dragon's X/X' (pink/purple and lime green/
	* dark green), exactly one true. Every node is "true if its side is true".
	* The one new step, the *Dragon link* (findDragonLinkMove): when a node of
	* side X and a node of the first Dragon's side S can't both be true (same
	* cell, or same digit in a shared unit), then X => not S => S' (the first
	* Dragon's other side), so X => every node of S' - which are coloured in
	* X's dragon colour and used from then on like any other of X's nodes. It
	* is tried after Rules 1-2 and the hidden single, per side, like Extension
	* Rule 3 in a Dynamic Dragon. Everything else is plain Dragon, so every
	* elimination rule stays sound for the same reason it always is (exactly
	* one of X/X' is true, and each implies its own nodes).
	*
	* The link's special outcomes (all sound for the same reason): X linking
	* to both of the first Dragon's sides, or implying a candidate X' has as a
	* Medusa colour, proves X false; X and X' both implying the same side S'
	* proves S' true (the first Dragon's own mass-elimination-style move).
	*
	* Returns the whole log - the first Dragon's moves, then the second's
	* (DragonMove.secondDragon, named in the second Dragon's colours) - or null
	* when nothing comes of it. `exhaustive` and `optimize` work exactly as for
	* a plain Dragon (the link is one more extension Optimize's search branches
	* on). With `dynamic` (Double Dynamic Dragon Colouring) the second Dragon
	* may also use Extension Rule 3 under those limits, and `optimizeDynamic`
	* works as for a single Dynamic Dragon. A second Dragon that never links is
	* exactly the single Dragon (plain or Dynamic) on `secondChain`, so callers
	* pass only chains that single Dragon is stuck on.
	*/
	extendDouble(first, secondChain, board, candidates, options = {}) {
		const nodeMap = /* @__PURE__ */ new Map();
		const seed = secondChain.candidates.map((c) => ({
			row: c.row,
			col: c.col,
			digit: c.digit,
			color: c.color
		}));
		for (const n of seed) nodeMap.set(nodeKey(n.row, n.col, n.digit), n);
		const pinkCount = seed.filter((n) => n.color === "blue").length;
		const greenCount = seed.length - pinkCount;
		const secondMedusa = {
			id: "second-medusa",
			kind: "medusa",
			description: `The light blue/yellow Dragon is stuck. Start a second Dragon from this 3d Medusa: ${pinkCount} candidate${pinkCount === 1 ? "" : "s"} pink, and ${greenCount} candidate${greenCount === 1 ? "" : "s"} lime green.`,
			colored: seed,
			eliminated: [],
			solved: [],
			secondDragon: true
		};
		const moves = [...first.moves, secondMedusa];
		const linked = { firstNodes: first.nodes };
		const result = this.extendFromState(nodeMap, moves, board, candidates, {
			exhaustive: options.exhaustive ?? false,
			optimize: options.optimize ?? false,
			...options.dynamic ? {
				...options.dynamic,
				dynamic: true,
				optimizeDynamic: options.optimizeDynamic ?? false
			} : {}
		}, linked);
		if (!result) return null;
		for (const move of result.moves.slice(first.moves.length)) if (move.secondDragon === void 0) {
			move.secondDragon = true;
			move.description = renameToSecondDragon(move.description);
			if (move.substeps) move.substeps = move.substeps.map((substep) => ({
				...substep,
				clause: renameToSecondDragon(substep.clause)
			}));
		}
		return result;
	}
	/** Double Dragon Colouring over a whole board: every ordered pair of
	* `chains` (callers pass only chains 3D Medusa is stuck on) plain Dragon is
	* stuck on too, as (first Dragon, second Dragon) - extendDouble for each,
	* up to `limit` results. `minBaseCandidates` applies to the first
	* Dragon's Medusa only (the user's choice: the second Medusa is often
	* tiny). A chain plain Dragon resolves is never part of a pair. */
	findDoubleDragons(chains, board, candidates, options = {}) {
		const stuck = [];
		for (const chain of chains) {
			const colouring = this.stuckColouring(chain, board, candidates, options.dynamic ?? null);
			if (colouring) stuck.push({
				chain,
				colouring
			});
		}
		const limit = options.limit ?? Infinity;
		const results = [];
		for (const second of stuck) for (const first of stuck) {
			if (first.chain.candidates.length < (options.minBaseCandidates ?? 0)) continue;
			if (first === second || !anyDragonLink(first.colouring.nodes, second.colouring.nodes)) continue;
			const result = this.extendDouble(first.colouring, second.chain, board, candidates, {
				exhaustive: options.exhaustive,
				optimize: options.optimize,
				optimizeDynamic: options.optimizeDynamic,
				dynamic: options.dynamic
			});
			if (result) {
				results.push({
					first: first.chain,
					second: second.chain,
					moves: result.moves
				});
				if (results.length >= limit) return results;
			}
		}
		return results;
	}
	/** Every Dragon log's first move: the whole seed Medusa chain coloured. */
	buildMedusaMove(seed) {
		const blueCount = seed.filter((n) => n.color === "blue").length;
		const yellowCount = seed.filter((n) => n.color === "yellow").length;
		return {
			id: "medusa",
			kind: "medusa",
			description: `Consider this 3d Medusa with: ${blueCount} candidate${blueCount === 1 ? "" : "s"} light blue, and ${yellowCount} candidate${yellowCount === 1 ? "" : "s"} yellow.`,
			colored: seed,
			eliminated: [],
			solved: []
		};
	}
	/**
	* "Autocomplete Dragon (Plain)" / "Autocomplete Dynamic Dragon": carries on
	* a Dragon Colouring the user started painting by hand, from exactly where
	* they left it - their paint is the starting point, never replaced by a
	* Dragon found from scratch. With `options.dynamic`, painted candidates may
	* also have come from Extension Rule 3 (see below), and the continuation is
	* a Dynamic Dragon under the same options the solver passes extend().
	*
	* `medusaChain` is the whole (stuck - the caller checks) Medusa their
	* Medusa colours belong to, already checked and completed (see
	* autocompleteMedusa); `userNodes` is every candidate they painted, in
	* Dragon's own four colours. The painted dragon colours are then checked
	* by replaying Dragon's own rules from the Medusa: each must be a plain
	* extension (Rule 1, Rule 2 or a hidden single - collected with the same
	* extensionRule1Moves/extensionRule2Moves/extensionHiddenSingleMoves
	* Optimize's search uses) of its side from the colours already accepted,
	* or be coloured on its side by a promotion or the Medusa growth after
	* one. They're accepted one at a time, in whatever order makes each
	* derivable, so the user's own steps come out as ordinary moves after the
	* Medusa. A painted Medusa colour outside the chain must be reached the
	* same way and end up promoted. Anything never reached, or reached on the
	* other side, is a problem, worded with Dragon's own colour names (the
	* caller renames them).
	*
	* A valid colouring is handed to extend()'s own loop (extendFromState),
	* unchanged, with `checkedMoves` saying how many leading moves were the
	* user's own (the Medusa move included). Eliminations aren't looked for
	* while checking - a user who coloured past the first one still gets it,
	* straight after their own steps.
	*
	* Known gap: acceptance is greedy, and Rule 2 skips a cell that already
	* holds a coloured candidate, so a colouring only derivable in one
	* particular order across the two sides could in principle be rejected.
	*/
	continueColouring(medusaChain, userNodes, board, candidates, options = {}) {
		const nodeMap = /* @__PURE__ */ new Map();
		const seed = medusaChain.candidates.map((c) => ({
			row: c.row,
			col: c.col,
			digit: c.digit,
			color: c.color
		}));
		for (const n of seed) nodeMap.set(nodeKey(n.row, n.col, n.digit), n);
		const moves = [this.buildMedusaMove(seed)];
		const describe = (n) => `${n.digit}${cellRef$1(n.row, n.col)}`;
		const problems = [];
		const pending = /* @__PURE__ */ new Map();
		for (const u of userNodes) {
			const key = nodeKey(u.row, u.col, u.digit);
			const inMedusa = nodeMap.get(key);
			if (!inMedusa) pending.set(key, u);
			else if (sideOf(inMedusa.color) !== sideOf(u.color)) problems.push(`${describe(u)} is coloured ${colorLabel(u.color)}, but the Medusa colours it ${colorLabel(inMedusa.color)} (the other side).`);
		}
		const resolvePending = () => {
			for (const [key, u] of pending) {
				const reached = nodeMap.get(key);
				if (!reached) continue;
				pending.delete(key);
				if (sideOf(reached.color) !== sideOf(u.color)) problems.push(`${describe(u)} is coloured ${colorLabel(u.color)}, but Dragon Colouring colours it ${colorLabel(reached.color)} (the other side).`);
			}
		};
		const rule3Techniques = new Set(options.allowedRule3Techniques ?? DEFAULT_RULE3_TECHNIQUES);
		rule3Techniques.add("naked pair");
		rule3Techniques.add("hidden single");
		let counter = 0;
		let strongLinkGraph = null;
		const record = (move) => {
			for (const n of move.colored) nodeMap.set(nodeKey(n.row, n.col, n.digit), n);
			move.id = `checked-${move.kind}-${counter++}`;
			moves.push(move);
		};
		const applyPromotion = () => {
			const promotion = this.findPromotionMove(nodeMap);
			if (!promotion) return false;
			record(promotion);
			strongLinkGraph ??= this.medusaFinder.buildStrongLinkGraph(board, candidates);
			const growth = this.findMedusaGrowthMove(nodeMap, strongLinkGraph, promotion.colored);
			if (growth) record(growth);
			return true;
		};
		while (pending.size > 0 && problems.length === 0) {
			if (applyPromotion()) {
				resolvePending();
				continue;
			}
			const matching = (found) => found.find((move) => {
				const colored = move.colored[0];
				const painted = pending.get(nodeKey(colored.row, colored.col, colored.digit));
				return painted !== void 0 && sideOf(painted.color) === sideOf(colored.color);
			}) ?? null;
			let accepted = null;
			for (const primary of ["blue", "yellow"]) {
				accepted = matching([
					...this.extensionRule1Moves(nodeMap, board, candidates, primary, Infinity),
					...this.extensionRule2Moves(nodeMap, board, candidates, primary, Infinity),
					...this.extensionHiddenSingleMoves(nodeMap, board, candidates, primary, Infinity)
				]);
				if (accepted) break;
			}
			if (!accepted && options.dynamic) for (const limit of [1, Infinity]) {
				for (const primary of ["blue", "yellow"]) {
					accepted = matching(this.extensionRule3Moves(nodeMap, board, candidates, primary, rule3Techniques, options.aicLimitPerStep ?? true, options.maxTechniquesPerStep ?? Infinity, options.givens ?? null, limit));
					if (accepted) break;
				}
				if (accepted) break;
			}
			if (!accepted) break;
			record(accepted);
			resolvePending();
		}
		if (problems.length === 0) for (const u of pending.values()) problems.push(isPrimary(u.color) ? `${describe(u)} is coloured ${colorLabel(u.color)}, but it isn't part of the Medusa, and Dragon Colouring doesn't reach it from the colours before it.` : options.dynamic ? `${describe(u)} is coloured ${colorLabel(u.color)}, but Dynamic Dragon Colouring can't reach it from the colours before it: no Extension Rule 1, Rule 2, hidden single or Extension Rule 3 (with the Dynamic Dragon techniques enabled) for the ${colorLabel(primaryForSide(sideOf(u.color)))} side colours it.` : `${describe(u)} is coloured ${colorLabel(u.color)}, but plain Dragon Colouring can't reach it from the colours before it: no Extension Rule 1, Rule 2 or hidden single for the ${colorLabel(primaryForSide(sideOf(u.color)))} side colours it.`);
		const unpromoted = () => userNodes.filter((u) => {
			const reached = nodeMap.get(nodeKey(u.row, u.col, u.digit));
			return isPrimary(u.color) && reached !== void 0 && !isPrimary(reached.color);
		});
		if (problems.length === 0 && unpromoted().length > 0) {
			while (applyPromotion());
			for (const u of unpromoted()) problems.push(`${describe(u)} is coloured ${colorLabel(u.color)}, but Dragon Colouring only reaches it as ${colorLabel(secondaryForSide(sideOf(u.color)))} - nothing promotes it to ${colorLabel(u.color)}.`);
		}
		if (problems.length > 0) return {
			kind: "invalid",
			problems
		};
		return {
			kind: "checked",
			checkedMoves: moves.length,
			result: this.extendFromState(nodeMap, moves, board, candidates, options)
		};
	}
	/** extend()'s whole run, from a colouring already in `nodeMap` whose moves
	* so far are `moves` (both taken over and added to). extend() starts it
	* from a bare Medusa chain; continueColouring from a colouring the user
	* painted by hand, once it has been checked. `linked` (Double Dragon
	* only, never with `optimize`/`dynamic`) adds the Dragon link - see
	* extendDouble. */
	extendFromState(nodeMap, moves, board, candidates, options, linked = null) {
		const exhaustive = options.exhaustive ?? false;
		let workingCandidates = candidates;
		let continuing = false;
		let lastEliminationEnd = 0;
		let strongLinkGraph = null;
		const allowedRule3Techniques = new Set(options.allowedRule3Techniques ?? DEFAULT_RULE3_TECHNIQUES);
		allowedRule3Techniques.add("naked pair");
		allowedRule3Techniques.add("hidden single");
		const aicLimitPerStep = options.aicLimitPerStep ?? true;
		const maxTechniquesPerStep = options.maxTechniquesPerStep ?? Infinity;
		const givens = options.givens ?? null;
		if (options.optimize) return this.extendOptimized(nodeMap, moves, board, candidates, options.dynamic ?? false, exhaustive, allowedRule3Techniques, aicLimitPerStep, maxTechniquesPerStep, givens, options.optimizeDynamic ?? false, linked);
		let candidatesVersion = 0;
		const sideNothing = {
			A: null,
			B: null
		};
		const findExtensionForSide = (primary) => {
			const side = sideOfPrimary(primary);
			let sideNodes = 0;
			for (const n of nodeMap.values()) if (sideOf(n.color) === side) sideNodes++;
			const known = sideNothing[side];
			if (known && known.sideNodes === sideNodes && known.version === candidatesVersion) return null;
			const found = this.findExtensionRule1Move(nodeMap, board, workingCandidates, primary) ?? this.findExtensionRule2Move(nodeMap, board, workingCandidates, primary) ?? this.findExtensionHiddenSingleMove(nodeMap, board, workingCandidates, primary) ?? (linked ? this.findDragonLinkMove(nodeMap, linked, primary, workingCandidates) : null) ?? (options.dynamic ? this.findExtensionRule3Move(nodeMap, board, workingCandidates, primary, allowedRule3Techniques, aicLimitPerStep, maxTechniquesPerStep, givens) : null);
			sideNothing[side] = found ? null : {
				sideNodes,
				version: candidatesVersion
			};
			return found;
		};
		let counter = 0;
		let turnPrimary = "blue";
		const applyPromotion = () => {
			const promotionMove = this.findPromotionMove(nodeMap);
			if (!promotionMove) return false;
			for (const n of promotionMove.colored) nodeMap.set(nodeKey(n.row, n.col, n.digit), n);
			promotionMove.id = `promotion-${counter++}`;
			moves.push(promotionMove);
			strongLinkGraph ??= this.medusaFinder.buildStrongLinkGraph(board, workingCandidates);
			const growthMove = this.findMedusaGrowthMove(nodeMap, strongLinkGraph, promotionMove.colored);
			if (growthMove) {
				for (const n of growthMove.colored) nodeMap.set(nodeKey(n.row, n.col, n.digit), n);
				growthMove.id = `medusa-growth-${counter++}`;
				moves.push(growthMove);
			}
			return true;
		};
		for (;;) {
			if (continuing && applyPromotion()) continue;
			const eliminationMoves = this.findEliminationMoves(Array.from(nodeMap.values()), board, workingCandidates);
			const isMassElimination = eliminationMoves.length === 1 && eliminationMoves[0].kind === "mass-elimination";
			if (eliminationMoves.length > 0 && (!exhaustive || isMassElimination)) {
				moves.push(...eliminationMoves);
				return { moves };
			}
			const linkConclusion = linked && eliminationMoves.length === 0 ? this.findDragonLinkConclusion(nodeMap, linked) : null;
			if (linkConclusion) {
				moves.push(linkConclusion);
				return { moves };
			}
			if (continuing || eliminationMoves.length === 0) {
				const solutionMove = this.findColouringSolutionMove(nodeMap, board);
				if (solutionMove) {
					moves.push(solutionMove);
					return { moves };
				}
			}
			if (continuing) {
				if (!Array.from(nodeMap.values()).some((n) => !isPrimary(n.color))) return { moves: moves.slice(0, lastEliminationEnd) };
			}
			if (eliminationMoves.length > 0) {
				moves.push(...eliminationMoves);
				lastEliminationEnd = moves.length;
				if (workingCandidates === candidates) workingCandidates = cloneCandidates(candidates);
				for (const move of eliminationMoves) for (const { row, col, digit } of move.eliminated) workingCandidates[row][col][digit - 1] = false;
				strongLinkGraph = null;
				candidatesVersion++;
				continuing = true;
				continue;
			}
			if (!continuing && applyPromotion()) continue;
			let move = findExtensionForSide(turnPrimary);
			let extendedPrimary = turnPrimary;
			if (!move) {
				extendedPrimary = oppositePrimary(turnPrimary);
				move = findExtensionForSide(extendedPrimary);
			}
			if (!move) return continuing ? { moves: moves.slice(0, lastEliminationEnd) } : null;
			for (const n of move.colored) nodeMap.set(nodeKey(n.row, n.col, n.digit), n);
			move.id = `${move.kind}-${counter++}`;
			moves.push(move);
			if (move.kind === "extension-rule1" || move.kind === "extension-rule2" || move.kind === "extension-hidden-single" || move.kind === "extension-rule3") turnPrimary = oppositePrimary(extendedPrimary);
		}
	}
	/** extend() with Optimize Dragons on. The default loop above is a single
	* path: the two sides take turns, each taking the first extension its
	* rules find. Here each *phase* - the colouring from the medusa (or, in
	* exhaustive mode, from the last applied elimination) up to the next
	* elimination - is instead a search over which candidate (of either side)
	* gets coloured at each point, to reach an elimination with as few
	* extension moves as possible.
	* Promotions and medusa growth aren't extensions (they're forced, and
	* applied exactly where the default loop applies them), so they're free.
	*
	* Per phase:
	*  1. Run the default alternating strategy from the phase's start state
	*     (the "baseline"). If it finds nothing, the phase finds nothing -
	*     exactly as with Optimize off - so this setting never changes
	*     *whether* a chain resolves. That matters beyond tidiness: the
	*     plain-vs-Dynamic split (App's computeStuckDynamicDragonExtensions)
	*     and the puzzle generator both decide from a non-optimized call.
	*  2. Breadth-first search over every extension either side could take
	*     next (allExtensions: every Rule 1, Rule 2 and hidden-single hit,
	*     not just the first), strictly shallower than the baseline (so it
	*     can only ever improve on it), deduplicating states by their exact
	*     colouring - orders that colour the same candidates reach the same
	*     state. The first state at the shallowest depth that reaches an
	*     elimination wins (side A before B, then each rule's scan order, so
	*     ties are deterministic).
	*  3. If the search exceeds OPTIMIZE_MAX_SEARCH_STATES colourings, it
	*     gives up and the baseline stands.
	*
	* Branching on the first hit only (what this first did) missed short
	* Dragons whenever one side had nothing to extend: the side choice was
	* then forced, so the search was the default path. E.g. a chain whose
	* light blue needed 3 extensions (the last a hidden single) for a Rule 5
	* elimination was reported as a 22-extension mass elimination, because
	* the fixed scan order kept picking other Rule 1/2 hits first.
	*
	* Rule 3 (Dynamic) is still only a fallback for a side with no plain
	* extension, and only its first find - see allExtensions. */
	extendOptimized(seedNodeMap, seedMoves, board, candidates, dynamic, exhaustive, allowedRule3Techniques, aicLimitPerStep, maxTechniquesPerStep, givens, optimizeDynamic, linked) {
		let workingCandidates = candidates;
		let strongLinkGraph = null;
		let continuing = false;
		let lastEliminationEnd = 0;
		let turnPrimary = "blue";
		const cloneState = (state) => ({
			nodeMap: new Map(state.nodeMap),
			moves: state.moves.slice(),
			counter: state.counter,
			rule3Known: { ...state.rule3Known }
		});
		let fallbackRule3SimulationsLeft = OPTIMIZE_MAX_RULE3_FALLBACK_SIMULATIONS;
		let everyRule3SimulationsLeft = OPTIMIZE_MAX_RULE3_SIMULATIONS;
		const findExtension = (state, primary) => this.findExtensionRule1Move(state.nodeMap, board, workingCandidates, primary) ?? this.findExtensionRule2Move(state.nodeMap, board, workingCandidates, primary) ?? this.findExtensionHiddenSingleMove(state.nodeMap, board, workingCandidates, primary) ?? (linked ? this.findDragonLinkMove(state.nodeMap, linked, primary, workingCandidates) : null) ?? (dynamic ? this.findExtensionRule3Move(state.nodeMap, board, workingCandidates, primary, allowedRule3Techniques, aicLimitPerStep, maxTechniquesPerStep, givens) : null);
		const applyExtension = (state, move) => {
			for (const n of move.colored) state.nodeMap.set(nodeKey(n.row, n.col, n.digit), n);
			state.moves.push({
				...move,
				id: `${move.kind}-${state.counter++}`
			});
		};
		const applyPromotion = (state) => {
			const promotionMove = this.findPromotionMove(state.nodeMap);
			if (!promotionMove) return false;
			for (const n of promotionMove.colored) state.nodeMap.set(nodeKey(n.row, n.col, n.digit), n);
			promotionMove.id = `promotion-${state.counter++}`;
			state.moves.push(promotionMove);
			strongLinkGraph ??= this.medusaFinder.buildStrongLinkGraph(board, workingCandidates);
			const growthMove = this.findMedusaGrowthMove(state.nodeMap, strongLinkGraph, promotionMove.colored);
			if (growthMove) {
				for (const n of growthMove.colored) state.nodeMap.set(nodeKey(n.row, n.col, n.digit), n);
				growthMove.id = `medusa-growth-${state.counter++}`;
				state.moves.push(growthMove);
			}
			return true;
		};
		const settle = (state) => {
			for (;;) {
				if (continuing && applyPromotion(state)) continue;
				const eliminationMoves = this.findEliminationMoves(Array.from(state.nodeMap.values()), board, workingCandidates);
				const isMassElimination = eliminationMoves.length === 1 && eliminationMoves[0].kind === "mass-elimination";
				if (eliminationMoves.length > 0 && (!exhaustive || isMassElimination)) return {
					kind: "final",
					moves: eliminationMoves
				};
				const linkConclusion = linked && eliminationMoves.length === 0 ? this.findDragonLinkConclusion(state.nodeMap, linked) : null;
				if (linkConclusion) return {
					kind: "final",
					moves: [linkConclusion]
				};
				if (continuing || eliminationMoves.length === 0) {
					const solutionMove = this.findColouringSolutionMove(state.nodeMap, board);
					if (solutionMove) return {
						kind: "solution",
						move: solutionMove
					};
				}
				if (continuing) {
					if (!Array.from(state.nodeMap.values()).some((n) => !isPrimary(n.color))) return { kind: "dead-end" };
				}
				if (eliminationMoves.length > 0) return {
					kind: "elimination",
					moves: eliminationMoves
				};
				if (!continuing && applyPromotion(state)) continue;
				return { kind: "extend" };
			}
		};
		const runBaseline = (state) => {
			let turn = turnPrimary;
			let extensions = 0;
			const sideNothing = {
				A: null,
				B: null
			};
			const extensionForSide = (primary) => {
				const side = sideOfPrimary(primary);
				let sideNodes = 0;
				for (const n of state.nodeMap.values()) if (sideOf(n.color) === side) sideNodes++;
				if (sideNothing[side] === sideNodes) return null;
				const found = findExtension(state, primary);
				sideNothing[side] = found ? null : sideNodes;
				return found;
			};
			for (;;) {
				let move = extensionForSide(turn);
				let extended = turn;
				if (!move) {
					extended = oppositePrimary(turn);
					move = extensionForSide(extended);
				}
				if (!move) return null;
				applyExtension(state, move);
				extensions++;
				turn = oppositePrimary(extended);
				const outcome = settle(state);
				if (outcome.kind === "dead-end") return null;
				if (outcome.kind !== "extend") return {
					state,
					outcome,
					turn,
					extensions
				};
			}
		};
		let sideExtensionCache = /* @__PURE__ */ new Map();
		const usableIn = (state, move) => {
			const [n] = move.colored;
			if (state.nodeMap.has(nodeKey(n.row, n.col, n.digit))) return false;
			return move.kind !== "extension-rule2" || !markedCandidateDigits(workingCandidates[n.row][n.col]).some((d) => state.nodeMap.has(nodeKey(n.row, n.col, d)));
		};
		const allExtensions = (state, primary, everyRule3) => {
			const side = sideOfPrimary(primary);
			const own = new Map(Array.from(state.nodeMap).filter(([, n]) => sideOf(n.color) === side));
			const cacheKey = `${side}|${colouringSignature(own)}`;
			let cached = sideExtensionCache.get(cacheKey);
			if (!cached) {
				const plain = [];
				const found = /* @__PURE__ */ new Set();
				for (const move of [
					...this.extensionRule1Moves(own, board, workingCandidates, primary, Infinity),
					...this.extensionRule2Moves(own, board, workingCandidates, primary, Infinity),
					...this.extensionHiddenSingleMoves(own, board, workingCandidates, primary, Infinity)
				]) {
					const [n] = move.colored;
					const key = nodeKey(n.row, n.col, n.digit);
					if (!found.has(key)) {
						found.add(key);
						plain.push(move);
					}
				}
				cached = {
					plain,
					rule3: void 0
				};
				sideExtensionCache.set(cacheKey, cached);
			}
			const moves = cached.plain.filter((move) => usableIn(state, move));
			const linkMove = linked ? this.findDragonLinkMove(state.nodeMap, linked, primary, workingCandidates) : null;
			if (linkMove) moves.push(linkMove);
			if (!dynamic || !everyRule3 && moves.length > 0) return moves;
			let fresh;
			if (everyRule3) {
				if (cached.rule3All === void 0 && everyRule3SimulationsLeft > 0) {
					everyRule3SimulationsLeft--;
					cached.rule3All = this.extensionRule3Moves(own, board, workingCandidates, primary, allowedRule3Techniques, aicLimitPerStep, maxTechniquesPerStep, givens, Infinity);
				}
				fresh = cached.rule3All;
			} else {
				if (cached.rule3 === void 0 && fallbackRule3SimulationsLeft > 0) {
					fallbackRule3SimulationsLeft--;
					cached.rule3 = this.findExtensionRule3Move(own, board, workingCandidates, primary, allowedRule3Techniques, aicLimitPerStep, maxTechniquesPerStep, givens);
				}
				fresh = cached.rule3 === void 0 ? void 0 : cached.rule3 ? [cached.rule3] : [];
			}
			const pool = /* @__PURE__ */ new Map();
			for (const move of [...fresh ?? [], ...state.rule3Known[side]]) {
				const [n] = move.colored;
				const key = nodeKey(n.row, n.col, n.digit);
				if (!pool.has(key)) pool.set(key, move);
			}
			state.rule3Known = {
				...state.rule3Known,
				[side]: Array.from(pool.values())
			};
			const plainKeys = new Set(moves.map((m) => nodeKey(m.colored[0].row, m.colored[0].col, m.colored[0].digit)));
			for (const [key, move] of pool) if (!plainKeys.has(key) && usableIn(state, move)) {
				moves.push(move);
				if (!everyRule3) break;
			}
			return moves;
		};
		const searchFewerExtensions = (start, maxDepth, everyRule3) => {
			const sides = [turnPrimary, oppositePrimary(turnPrimary)];
			const seen = /* @__PURE__ */ new Set([colouringSignature(start.nodeMap)]);
			let frontier = [start];
			let statesTried = 0;
			for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
				const next = [];
				for (const state of frontier) for (const primary of sides) for (const move of allExtensions(state, primary, everyRule3)) {
					const child = cloneState(state);
					applyExtension(child, move);
					const signature = colouringSignature(child.nodeMap);
					if (seen.has(signature)) continue;
					seen.add(signature);
					if (++statesTried > (continuing ? OPTIMIZE_MAX_SEARCH_STATES_LATER_PHASES : OPTIMIZE_MAX_SEARCH_STATES)) return null;
					const outcome = settle(child);
					if (outcome.kind === "extend") next.push(child);
					else if (outcome.kind !== "dead-end") return {
						state: child,
						outcome,
						turn: oppositePrimary(primary),
						extensions: depth
					};
				}
				frontier = next;
			}
			return null;
		};
		const runPhase = (start) => {
			const outcome = settle(start);
			if (outcome.kind !== "extend") return {
				state: start,
				outcome,
				turn: turnPrimary,
				extensions: 0
			};
			const baseline = runBaseline(cloneState(start));
			if (!baseline) return null;
			let best = baseline.extensions > 1 && searchFewerExtensions(start, baseline.extensions - 1, false) || baseline;
			if (dynamic && optimizeDynamic && best.extensions > 1) best = searchFewerExtensions(start, best.extensions - 1, true) ?? best;
			return best;
		};
		let state = {
			nodeMap: seedNodeMap,
			moves: seedMoves,
			counter: 0,
			rule3Known: {
				A: [],
				B: []
			}
		};
		for (;;) {
			const phase = runPhase(state);
			if (!phase) return continuing ? { moves: state.moves.slice(0, lastEliminationEnd) } : null;
			state = phase.state;
			turnPrimary = phase.turn;
			const { outcome } = phase;
			if (outcome.kind === "final") {
				state.moves.push(...outcome.moves);
				return { moves: state.moves };
			}
			if (outcome.kind === "solution") {
				state.moves.push(outcome.move);
				return { moves: state.moves };
			}
			if (outcome.kind !== "elimination") return { moves: state.moves.slice(0, lastEliminationEnd) };
			state.moves.push(...outcome.moves);
			lastEliminationEnd = state.moves.length;
			if (workingCandidates === candidates) workingCandidates = cloneCandidates(candidates);
			for (const move of outcome.moves) for (const { row, col, digit } of move.eliminated) workingCandidates[row][col][digit - 1] = false;
			strongLinkGraph = null;
			sideExtensionCache = /* @__PURE__ */ new Map();
			state.rule3Known = {
				A: [],
				B: []
			};
			fallbackRule3SimulationsLeft = OPTIMIZE_MAX_RULE3_FALLBACK_SIMULATIONS_LATER_PHASES;
			everyRule3SimulationsLeft = OPTIMIZE_MAX_RULE3_SIMULATIONS_LATER_PHASES;
			continuing = true;
		}
	}
	/** After a promotion, checks whether either newly-primary candidate has
	* strong links (conjugate pairs, bivalue cells) reaching cells the
	* original Medusa chain never coloured - see growChainFrom. Returns null
	* if nothing new turns up, so a promotion that doesn't unlock further
	* strong-link colouring doesn't add an empty, pointless step. */
	findMedusaGrowthMove(nodeMap, graph, promoted) {
		const known = new Set(Array.from(nodeMap.keys()));
		const added = [];
		let hasBivalueCellLink = false;
		for (const node of promoted) {
			const startColor = node.color;
			const result = this.medusaFinder.growChainFromGraph(graph, node, startColor, known);
			for (const candidate of result.added) {
				const key = nodeKey(candidate.row, candidate.col, candidate.digit);
				if (known.has(key)) continue;
				known.add(key);
				added.push(candidate);
			}
			hasBivalueCellLink ||= result.hasBivalueCellLink;
		}
		if (added.length === 0) return null;
		const blueCount = added.filter((n) => n.color === "blue").length;
		const yellowCount = added.filter((n) => n.color === "yellow").length;
		const parts = [];
		if (blueCount > 0) parts.push(`${blueCount} candidate${blueCount === 1 ? "" : "s"} light blue`);
		if (yellowCount > 0) parts.push(`${yellowCount} yellow`);
		return {
			id: "",
			kind: "medusa-growth",
			description: `Medusa extension(s) using promoted Colour(s): ${added.map((candidate) => `${candidate.digit}r${candidate.row + 1}c${candidate.col + 1}`).join(", ")}.`,
			colored: added,
			eliminated: [],
			solved: []
		};
	}
	/** Extension Rule 1: assuming a medusa color is true, if exactly one
	* candidate of a digit in some section survives (doesn't see that color
	* elsewhere), it must be the placement under that assumption. Looks at
	* one side only - the caller alternates which side's turn it is, so
	* both sides get extended evenly instead of one running ahead of the
	* other. */
	findExtensionRule1Move(nodeMap, board, candidates, primary) {
		return this.extensionRule1Moves(nodeMap, board, candidates, primary, 1)[0] ?? null;
	}
	/** Every Extension Rule 1 move for this side, in scan order, stopping at
	* `limit` - 1 for the default loop (its first hit, exactly as before),
	* Infinity for Optimize Dragons' search, which branches on each of them.
	* A candidate forced through more than one unit is listed once. */
	extensionRule1Moves(nodeMap, board, candidates, primary, limit) {
		const moves = [];
		const found = /* @__PURE__ */ new Set();
		const side = sideOfPrimary(primary);
		const seesPrimary = seenByNodes(nodeMap.values(), (n) => n.color === primary);
		for (const unit of sudokuUnits()) for (let digit = 1; digit <= 9; digit++) {
			let withDigit = 0;
			let notSeeingCount = 0;
			let r = -1;
			let c = -1;
			for (const [ur, uc] of unit) {
				if (board[ur][uc] !== 0 || !candidates[ur][uc][digit - 1]) continue;
				withDigit++;
				if (!seesPrimary[(digit - 1) * 81 + ur * 9 + uc]) {
					notSeeingCount++;
					r = ur;
					c = uc;
				}
			}
			if (withDigit < 2 || notSeeingCount !== 1) continue;
			const key = nodeKey(r, c, digit);
			if (nodeMap.has(key) || found.has(key)) continue;
			found.add(key);
			const secondary = secondaryForSide(side);
			moves.push({
				id: "",
				kind: "extension-rule1",
				description: `Assuming ${colorLabel(primary)} is true: ${cellRef$1(r, c)} would be the only remaining ${digit} in its ${classifyUnitKind(unit)}, so colour it ${colorLabel(secondary)}.`,
				colored: [{
					row: r,
					col: c,
					digit,
					color: secondary
				}],
				eliminated: [],
				solved: []
			});
			if (moves.length >= limit) return moves;
		}
		return moves;
	}
	/** Places this side's own already-coloured cells onto a copy of the
	* board (as if that side's assumption had already been solved out) and
	* eliminates their peers accordingly - the hypothetical starting point
	* both the plain hidden-single check and Extension Rule 3's fuller
	* simulation reason from. Returns null if this side has nothing coloured
	* yet to place. */
	buildHypotheticalBoard(nodeMap, board, candidates, side) {
		const sideNodes = Array.from(nodeMap.values()).filter((n) => sideOf(n.color) === side);
		if (sideNodes.length === 0) return null;
		const hypBoard = cloneBoard(board);
		const hypCandidates = cloneCandidates(candidates);
		for (const n of sideNodes) {
			hypBoard[n.row][n.col] = n.digit;
			hypCandidates[n.row][n.col] = Array(9).fill(false);
		}
		for (const n of sideNodes) SudokuRules.eliminatePeerCandidates(hypCandidates, hypBoard, n.row, n.col, n.digit);
		return {
			hypBoard,
			hypCandidates
		};
	}
	/** A hidden single is ordinary Sudoku logic, not a "dynamic" technique -
	* unlike locked candidates, naked pairs/triples/quads, and Unique
	* Rectangles (which only make sense once a side's assumption has been
	* propagated through other techniques), a hidden single follows directly
	* from placing this side's own already-coloured cells and eliminating
	* their peers, with nothing else needed. So it's checked here, as part
	* of plain Dragon Colouring's normal extension - alongside Rules 1 and
	* 2 - rather than gated behind `dynamic`. A chain that only ever needs
	* this (and Rules 1-2) is exactly as "plain" as one that never uses it
	* at all. */
	findExtensionHiddenSingleMove(nodeMap, board, candidates, primary) {
		return this.extensionHiddenSingleMoves(nodeMap, board, candidates, primary, 1)[0] ?? null;
	}
	/** Every hidden-single extension for this side, in scan order, up to
	* `limit` - see extensionRule1Moves. */
	extensionHiddenSingleMoves(nodeMap, board, candidates, primary, limit) {
		const side = sideOfPrimary(primary);
		const secondary = secondaryForSide(side);
		const hypothetical = this.buildHypotheticalBoard(nodeMap, board, candidates, side);
		if (!hypothetical) return [];
		return this.findNewlyHiddenSingleCells(hypothetical.hypBoard, hypothetical.hypCandidates, nodeMap, limit).map((hiddenSingle) => ({
			id: "",
			kind: "extension-hidden-single",
			description: `Assuming ${colorLabel(primary)} is true, then we have ${this.hiddenSingleClause(secondary, hiddenSingle)}.`,
			colored: [{
				row: hiddenSingle.row,
				col: hiddenSingle.col,
				digit: hiddenSingle.digit,
				color: secondary
			}],
			eliminated: [],
			solved: []
		}));
	}
	/** Extension Rule 2: assuming a medusa color (or its dragon color) is
	* true, if exactly one candidate survives in an otherwise-uncolored cell,
	* it must be that cell's placement under the assumption. Looks at one
	* side only, same reason as Extension Rule 1 above. */
	findExtensionRule2Move(nodeMap, board, candidates, primary) {
		return this.extensionRule2Moves(nodeMap, board, candidates, primary, 1)[0] ?? null;
	}
	/** Every Extension Rule 2 move for this side, in scan order, up to
	* `limit` - see extensionRule1Moves. */
	extensionRule2Moves(nodeMap, board, candidates, primary, limit) {
		const moves = [];
		const side = sideOfPrimary(primary);
		const seesSide = seenByNodes(nodeMap.values(), (n) => sideOf(n.color) === side);
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0) continue;
			const digits = markedCandidateDigits(candidates[row][col]);
			if (digits.length === 0 || digits.some((d) => nodeMap.has(nodeKey(row, col, d)))) continue;
			const survivors = digits.filter((d) => !seesSide[(d - 1) * 81 + row * 9 + col]);
			if (survivors.length !== 1) continue;
			const digit = survivors[0];
			const secondary = secondaryForSide(side);
			moves.push({
				id: "",
				kind: "extension-rule2",
				description: `Assuming ${colorLabel(primary)} is true eliminates every other candidate from ${cellRef$1(row, col)}, leaving only ${digit} - colour it ${colorLabel(secondary)}.`,
				colored: [{
					row,
					col,
					digit,
					color: secondary
				}],
				eliminated: [],
				solved: []
			});
			if (moves.length >= limit) return moves;
		}
		return moves;
	}
	/** Extension Rule 3 (Dynamic Dragon Colouring only): Rules 1-2, and the
	* plain hidden-single check, only ever find something directly visible
	* from placing this side's own coloured cells and eliminating their
	* peers once. This rule reaches further: it keeps that same hypothetical
	* board going and, on every iteration, checked in this order (easiest
	* first) - looks for a *newly* available hidden single, then tries
	* locked candidates, naked pairs, naked triples, naked quads, and Unique
	* Rectangle Type 1 - this app's other implemented non-colouring
	* techniques - against that hypothetical board, one application at a
	* time, until one of them either directly forces a cell (a hidden
	* single, or a Type 1 Unique Rectangle with a single extra candidate) or
	* narrows some cell down to its last candidate. That one becomes this
	* call's move.
	*
	* The hidden-single check here exists only to catch one that *only*
	* becomes available after some genuinely dynamic technique (locked
	* candidate, naked pair/triple/quad, UR) narrows things first - the
	* caller (`extend`) already tried a plain hidden single, with nothing
	* else propagated, before ever calling this method, so finding one again
	* here always means some antecedent made it possible. Checking it first
	* on every iteration still matters: a more complex technique can
	* independently reach the very same conclusion (e.g. a naked quad's own
	* elimination can happen to leave a cell down to its last candidate,
	* when a hidden single already justified colouring that same candidate
	* more simply) - without checking the simplest technique first, the more
	* roundabout explanation would win the race and get reported instead.
	* Either way, a resulting "hidden single" is never itself credited as
	* the reason this chain needed Dynamic Dragon Colouring - see the
	* dynamicTechniques field.
	*
	* Sometimes the technique that actually does the forcing only applies
	* because an *earlier* application (of a different technique) narrowed
	* one of its own basis cells first (e.g. a naked quad frees up a cell
	* just enough for a naked triple to then apply there) - so rather than
	* silently presupposing that earlier step, its own "we have a ..." is
	* folded into the SAME move's description, chained with "which reveals".
	* Only technique applications the final one actually depended on (traced
	* backward through which cells each application touched, transitively)
	* are included - an application that happened along the way but never
	* affected any cell the final technique's basis or dependencies rest on
	* is exactly as irrelevant to this conclusion as one that never ran at
	* all, so it's left out. A chain that never reaches a forcing conclusion
	* is discarded entirely (returns null), the same as if nothing had been
	* found. */
	findExtensionRule3Move(nodeMap, board, candidates, primary, allowedTechniques, aicLimitPerStep, maxTechniquesPerStep, givens) {
		return this.extensionRule3Moves(nodeMap, board, candidates, primary, allowedTechniques, aicLimitPerStep, maxTechniquesPerStep, givens, 1)[0] ?? null;
	}
	/** Every Extension Rule 3 move for this side, up to `limit`. With
	* `limit` 1 this is exactly findExtensionRule3Move's old behaviour: the
	* simulation stops at the first candidate it forces. Otherwise
	* (Optimize Dynamic Dragons) it records that candidate and keeps
	* simulating - the forced candidate is left unplaced, and skipped by the
	* "newly forced" checks from then on - so every candidate the simulation
	* reaches becomes its own move, each explained by only the steps it
	* depended on (buildRule3CombinedMove prunes the rest). The AIC limit
	* covers the whole simulation, so no move ever leans on more than it.
	* `maxTechniquesPerStep` instead caps each move's own (pruned) chain -
	* see emit. */
	extensionRule3Moves(nodeMap, board, candidates, primary, allowedTechniques, aicLimitPerStep, maxTechniquesPerStep, givens, limit) {
		const moves = [];
		const emitted = new Map(nodeMap);
		let known = new Map(emitted);
		/** Records a move; true once `limit` is reached (stop simulating).
		* Never one for a candidate that's already coloured, by either side -
		* the same rule every other extension path follows. The direct-solve
		* branches (UR Type 1, BUG+1, Oddagon Type 1) used to return such a move
		* anyway, recolouring the other side's dragon node (e.g. orange ->
		* dark blue): that side silently lost a candidate it implied, and the
		* per-side "found nothing" memo, which assumes a side's nodes only grow,
		* could go stale. Now they're skipped and the simulation carries on.
		*
		* A move leaning on more than `maxTechniquesPerStep` techniques is
		* dropped the same way. Its technique count is its dynamicTechniques -
		* the relevant antecedents plus the final technique, hidden singles
		* excluded - not every application the simulation made on the way: a
		* step that never touched what this conclusion rests on isn't "used" by
		* it (and the substep player would never show it). The simulation
		* carries on, since a later candidate may rest on a shorter chain. The
		* dropped candidate still goes into `known` - the forced-cell scans
		* would otherwise find it again forever - and it can't come back
		* cheaper: steps only accumulate, so its relevant chain only grows.
		* (A direct solve - UR Type 1, BUG+1, Oddagon Type 1 - reaching that
		* same candidate by a shorter route is lost; rare enough to accept.) */
		const emit = (move) => {
			const [n] = move.colored;
			const key = nodeKey(n.row, n.col, n.digit);
			if (known.has(key) || emitted.has(key)) return false;
			known.set(key, n);
			if ((move.dynamicTechniques?.length ?? 0) > maxTechniquesPerStep) return false;
			emitted.set(key, n);
			moves.push(move);
			return moves.length >= limit;
		};
		const side = sideOfPrimary(primary);
		const secondary = secondaryForSide(side);
		const hypothetical = this.buildHypotheticalBoard(nodeMap, board, candidates, side);
		if (!hypothetical) return moves;
		const { hypBoard } = hypothetical;
		let branchesTried = 0;
		let aicSearchesLeft = limit === 1 ? Infinity : MAX_RULE3_ENUMERATION_AIC_SEARCHES;
		/** 'branch' mode at an AIC tier: every AIC of the tier (one per
		* elimination set, in the finder's order) in its own branch from this
		* state. True once `limit` moves are found. An AIC whose eliminations a
		* failed branch here already made is skipped - the simulation only ever
		* gets further with more eliminations. */
		const branchOnAicTier = (hypCandidates, steps, tierSteps) => {
			const failed = [];
			for (const aicStep of tierSteps) {
				const eliminationKeys = aicStep.eliminatedCandidates.map((e) => nodeKey(e.row, e.col, e.digit));
				if (failed.some((set) => eliminationKeys.every((key) => set.has(key)))) continue;
				if (limit !== 1 && branchesTried >= MAX_RULE3_ENUMERATION_AIC_BRANCHES) return false;
				branchesTried++;
				const found = moves.length;
				const branchCandidates = cloneCandidates(hypCandidates);
				for (const { row, col, digit } of aicStep.eliminatedCandidates) branchCandidates[row][col][digit - 1] = false;
				const branchSteps = [...steps];
				const mainKnown = known;
				known = new Map(emitted);
				if (this.emitForcedCells(hypBoard, branchCandidates, known, (forced) => emit(this.buildRule3CombinedMove(primary, branchSteps, aicStep, {
					...forced,
					color: secondary
				}, { kind: "single candidate" })))) return true;
				branchSteps.push(aicStep);
				if (run(branchCandidates, branchSteps, "none")) return true;
				known = mainKnown;
				if (moves.length === found) failed.push(new Set(eliminationKeys));
			}
			return false;
		};
		/** One simulation from `hypCandidates` (mutated), recording applied
		* techniques in `steps` (mutated): true once `limit` moves are found
		* (stop), false when nothing more applies. */
		const run = (hypCandidates, steps, aicMode) => {
			for (let step = 0; step < MAX_RULE3_SIMULATION_STEPS; step++) {
				let appliedSomething = false;
				const grid = gridKey(hypBoard, hypCandidates);
				if (allowedTechniques.has("hidden single")) for (const hiddenSingle of this.findNewlyHiddenSingleCells(hypBoard, hypCandidates, known, limit - moves.length)) {
					const move = this.buildRule3CombinedMove(primary, steps, {
						technique: "hidden single",
						basisCells: [[hiddenSingle.row, hiddenSingle.col]],
						affectedCells: [],
						eliminatedCandidates: [],
						clause: "",
						summaryName: ""
					}, {
						row: hiddenSingle.row,
						col: hiddenSingle.col,
						digit: hiddenSingle.digit,
						color: secondary
					}, {
						kind: "hidden single",
						unitKind: hiddenSingle.unitKind
					}, hiddenSingle.unit);
					if (emit(move)) return true;
				}
				if (allowedTechniques.has("locked candidate")) for (const locked of this.memoFind("locked", grid, () => this.lockedCandidateFinder.findInstances(hypBoard, hypCandidates))) {
					if (locked.eliminations.length === 0) continue;
					for (const { row, col, digit } of locked.eliminations) hypCandidates[row][col][digit - 1] = false;
					const chainStep = {
						technique: "locked candidate",
						basisCells: locked.basisCells,
						affectedCells: uniqueCells(locked.eliminations),
						eliminatedCandidates: locked.eliminations,
						clause: this.lockedCandidateClause(locked),
						summaryName: `a Locked Candidate (${locked.type === "pointing" ? "Pointing" : "Claiming"})`
					};
					if (this.emitForcedCells(hypBoard, hypCandidates, known, (forced) => emit(this.buildRule3CombinedMove(primary, steps, chainStep, {
						...forced,
						color: secondary
					}, { kind: "single candidate" })))) return true;
					steps.push(chainStep);
					appliedSomething = true;
					break;
				}
				if (appliedSomething) continue;
				for (const pair of this.memoFind("pair", grid, () => this.pairFinder.findNakedPairs(hypBoard, hypCandidates))) {
					if (pair.eliminations.length === 0) continue;
					for (const { row, col, digit } of pair.eliminations) hypCandidates[row][col][digit - 1] = false;
					const chainStep = {
						technique: "naked pair",
						basisCells: pair.cells,
						affectedCells: uniqueCells(pair.eliminations),
						eliminatedCandidates: pair.eliminations,
						clause: this.nakedPairClause(pair),
						summaryName: "a naked pair"
					};
					if (this.emitForcedCells(hypBoard, hypCandidates, known, (forced) => emit(this.buildRule3CombinedMove(primary, steps, chainStep, {
						...forced,
						color: secondary
					}, { kind: "single candidate" })))) return true;
					steps.push(chainStep);
					appliedSomething = true;
					break;
				}
				if (appliedSomething) continue;
				const needsTriple = allowedTechniques.has("naked triple");
				const needsQuad = allowedTechniques.has("naked quad");
				const { triples, quads } = needsTriple || needsQuad ? this.memoFind("subset", grid, () => this.nakedSubsetFinder.findNakedTriplesAndQuads(hypBoard, hypCandidates)) : {
					triples: [],
					quads: []
				};
				for (const [technique, subsets] of [["naked triple", needsTriple ? triples : []], ["naked quad", needsQuad ? quads : []]]) {
					for (const subset of subsets) {
						if (subset.eliminations.length === 0) continue;
						for (const { row, col, digit } of subset.eliminations) hypCandidates[row][col][digit - 1] = false;
						const chainStep = {
							technique,
							basisCells: subset.cells,
							affectedCells: uniqueCells(subset.eliminations),
							eliminatedCandidates: subset.eliminations,
							clause: this.nakedSubsetClause(subset),
							summaryName: technique === "naked triple" ? "a naked triple" : "a naked quad"
						};
						if (this.emitForcedCells(hypBoard, hypCandidates, known, (forced) => emit(this.buildRule3CombinedMove(primary, steps, chainStep, {
							...forced,
							color: secondary
						}, { kind: "single candidate" })))) return true;
						steps.push(chainStep);
						appliedSomething = true;
						break;
					}
					if (appliedSomething) break;
				}
				if (appliedSomething) continue;
				if (allowedTechniques.has("hidden pair")) for (const pair of this.memoFind("hiddenPair", grid, () => this.hiddenPairFinder.findHiddenPairs(hypBoard, hypCandidates))) {
					if (pair.eliminations.length === 0) continue;
					for (const { row, col, digit } of pair.eliminations) hypCandidates[row][col][digit - 1] = false;
					const chainStep = {
						technique: "hidden pair",
						basisCells: pair.cells,
						affectedCells: uniqueCells(pair.eliminations),
						eliminatedCandidates: pair.eliminations,
						clause: this.hiddenPairClause(pair),
						summaryName: "a hidden pair"
					};
					if (this.emitForcedCells(hypBoard, hypCandidates, known, (forced) => emit(this.buildRule3CombinedMove(primary, steps, chainStep, {
						...forced,
						color: secondary
					}, { kind: "single candidate" })))) return true;
					steps.push(chainStep);
					appliedSomething = true;
					break;
				}
				if (appliedSomething) continue;
				if (allowedTechniques.has("UR")) for (const ur of this.memoFind("ur", grid, () => this.uniqueRectangleFinder.find(hypBoard, hypCandidates))) {
					const summaryName = `a Unique Rectangle (${ur.type})`;
					if (ur.solvedCandidates.length > 0) {
						const move = this.buildRule3CombinedMove(primary, steps, {
							technique: "UR",
							basisCells: ur.cells,
							affectedCells: [],
							eliminatedCandidates: [],
							clause: ur.reasonText,
							summaryName
						}, {
							...ur.solvedCandidates[0],
							color: secondary
						}, { kind: "direct" });
						if (emit(move)) return true;
						continue;
					}
					if (ur.eliminatedCandidates.length > 0) {
						for (const { row, col, digit } of ur.eliminatedCandidates) hypCandidates[row][col][digit - 1] = false;
						const chainStep = {
							technique: "UR",
							basisCells: [...ur.cells, ...ur.subsetCells ?? []],
							affectedCells: uniqueCells(ur.eliminatedCandidates),
							eliminatedCandidates: ur.eliminatedCandidates,
							clause: this.uniqueRectangleClause(ur),
							summaryName
						};
						if (this.emitForcedCells(hypBoard, hypCandidates, known, (forced) => emit(this.buildRule3CombinedMove(primary, steps, chainStep, {
							...forced,
							color: secondary
						}, { kind: "single candidate" })))) return true;
						steps.push(chainStep);
						appliedSomething = true;
						break;
					}
				}
				if (appliedSomething) continue;
				if (allowedTechniques.has("BUG+1")) {
					const bugPlusOne = this.memoFind("bug", grid, () => this.bugPlusOneFinder.find(hypBoard, hypCandidates));
					if (bugPlusOne) {
						const move = this.buildRule3CombinedMove(primary, steps, {
							technique: "BUG+1",
							basisCells: [bugPlusOne.cell],
							affectedCells: [],
							eliminatedCandidates: [],
							clause: this.bugPlusOneClause(bugPlusOne),
							summaryName: "a BUG+1"
						}, {
							row: bugPlusOne.cell[0],
							col: bugPlusOne.cell[1],
							digit: bugPlusOne.solvedDigit,
							color: secondary
						}, { kind: "direct" });
						if (emit(move)) return true;
					}
				}
				if (allowedTechniques.has("avoidable rectangle") && givens) for (const ar of this.memoFind(`ar|${givensKey(givens)}`, grid, () => this.avoidableRectangleFinder.find(hypBoard, hypCandidates, givens))) {
					for (const { row, col, digit } of ar.eliminations) hypCandidates[row][col][digit - 1] = false;
					const chainStep = {
						technique: "avoidable rectangle",
						basisCells: ar.cells,
						affectedCells: uniqueCells(ar.eliminations),
						eliminatedCandidates: ar.eliminations,
						clause: this.avoidableRectangleClause(ar),
						summaryName: `an Avoidable Rectangle (Type ${ar.type})`
					};
					if (this.emitForcedCells(hypBoard, hypCandidates, known, (forced) => emit(this.buildRule3CombinedMove(primary, steps, chainStep, {
						...forced,
						color: secondary
					}, { kind: "single candidate" })))) return true;
					steps.push(chainStep);
					appliedSomething = true;
					break;
				}
				if (appliedSomething) continue;
				if (allowedTechniques.has("bivalue oddagon")) for (const oddagon of this.memoFind("oddagon", grid, () => this.bivalueOddagonFinder.find(hypBoard, hypCandidates))) {
					const summaryName = `a Bivalue Oddagon (Type ${oddagon.type})`;
					if (oddagon.solvedCell) {
						const move = this.buildRule3CombinedMove(primary, steps, {
							technique: "bivalue oddagon",
							basisCells: oddagon.cells,
							affectedCells: [],
							eliminatedCandidates: [],
							clause: this.bivalueOddagonSolveClause(oddagon),
							summaryName
						}, {
							row: oddagon.solvedCell[0],
							col: oddagon.solvedCell[1],
							digit: oddagon.guardianDigit,
							color: secondary
						}, { kind: "direct" });
						if (emit(move)) return true;
						continue;
					}
					if (oddagon.eliminations.length > 0) {
						for (const { row, col, digit } of oddagon.eliminations) hypCandidates[row][col][digit - 1] = false;
						const chainStep = {
							technique: "bivalue oddagon",
							basisCells: oddagon.cells,
							affectedCells: uniqueCells(oddagon.eliminations),
							eliminatedCandidates: oddagon.eliminations,
							clause: this.bivalueOddagonEliminationClause(oddagon),
							summaryName
						};
						if (this.emitForcedCells(hypBoard, hypCandidates, known, (forced) => emit(this.buildRule3CombinedMove(primary, steps, chainStep, {
							...forced,
							color: secondary
						}, { kind: "single candidate" })))) return true;
						steps.push(chainStep);
						appliedSomething = true;
						break;
					}
				}
				if (appliedSomething) continue;
				let sharedGraph;
				const graph = () => sharedGraph ??= buildLinkGraphs(hypBoard, hypCandidates);
				let aicSearchAllowed;
				for (const technique of FISH_AND_AIC_RULE3_ORDER) {
					let chainStep;
					if (technique === "short single-digit aic" || technique === "short aic" || technique === "generic aic") {
						aicSearchAllowed ??= aicMode !== "none" && aicSearchesLeft-- > 0;
						if (!aicSearchAllowed || !allowedTechniques.has(technique)) continue;
						const tierAics = (technique === "generic aic" ? this.memoFind("genericAic", grid, () => this.genericAicFinder.findGenericAics(hypBoard, hypCandidates, void 0, graph())) : this.memoFind("shortAic", grid, () => this.shortAicFinder.findShortAics(hypBoard, hypCandidates, graph())).filter((candidate) => classifyShortAic(candidate) === "single-digit" === (technique === "short single-digit aic"))).filter((candidate) => candidate.eliminations.length > 0);
						const toStep = (aic) => ({
							technique,
							basisCells: aic.nodes.flatMap((n) => aicNodeCells(n)),
							affectedCells: uniqueCells(aic.eliminations),
							eliminatedCandidates: aic.eliminations,
							clause: this.aicClause(aic, technique),
							summaryName: this.aicSummaryName(aic, technique),
							aic
						});
						if (aicMode === "branch") {
							const seen = /* @__PURE__ */ new Set();
							const tierSteps = tierAics.filter((aic) => {
								const key = aic.eliminations.map((e) => nodeKey(e.row, e.col, e.digit)).sort().join("|");
								return !seen.has(key) && seen.add(key) !== void 0;
							}).map(toStep);
							if (branchOnAicTier(hypCandidates, steps, tierSteps)) return true;
							continue;
						}
						const aic = tierAics[0];
						if (!aic) continue;
						chainStep = toStep(aic);
					} else if (technique === "als-xz") {
						if (!allowedTechniques.has(technique)) continue;
						const als = this.memoFind("alsXz", grid, () => this.alsXzFinder.find(hypBoard, hypCandidates)[0] ?? null);
						if (!als) continue;
						chainStep = {
							technique,
							basisCells: [...als.alsA.cells, ...als.alsB.cells],
							affectedCells: uniqueCells(als.eliminations),
							eliminatedCandidates: als.eliminations,
							clause: this.alsXzClause(als),
							summaryName: "an ALS-xz"
						};
					} else {
						if (!allowedTechniques.has(technique)) continue;
						const fish = this.memoFind("fish", grid, () => this.fishFinder.find(hypBoard, hypCandidates)).find((candidate) => candidate.technique === technique);
						if (!fish) continue;
						chainStep = {
							technique,
							basisCells: fish.cells,
							affectedCells: uniqueCells(fish.eliminations),
							eliminatedCandidates: fish.eliminations,
							clause: this.fishClause(fish),
							summaryName: `a ${FISH_TECHNIQUE_NAMES[technique]}`
						};
					}
					for (const { row, col, digit } of chainStep.eliminatedCandidates) hypCandidates[row][col][digit - 1] = false;
					if (this.emitForcedCells(hypBoard, hypCandidates, known, (forced) => emit(this.buildRule3CombinedMove(primary, steps, chainStep, {
						...forced,
						color: secondary
					}, { kind: "single candidate" })))) return true;
					steps.push(chainStep);
					appliedSomething = true;
					break;
				}
				if (appliedSomething) continue;
				return false;
			}
			return false;
		};
		run(hypothetical.hypCandidates, [], aicLimitPerStep ? "branch" : "all");
		return moves;
	}
	/** After a Rule 3 step: hands every uncoloured, not-yet-reported cell the
	* step left with a single candidate to `record` (just the first when
	* only one move is wanted - `record` returns true to stop), returning
	* whether `record` asked to stop. */
	emitForcedCells(hypBoard, hypCandidates, known, record) {
		for (let forced = this.findNewlySingleCandidateCell(hypBoard, hypCandidates, known); forced;) {
			if (record(forced)) return true;
			forced = this.findNewlySingleCandidateCell(hypBoard, hypCandidates, known);
		}
		return false;
	}
	/** Walks `steps` (in the order they were applied) backward from the
	* final technique's own basis cells, keeping only the ones that actually
	* narrowed a cell the final technique - or an already-kept earlier step -
	* depends on. Growing the dependency set as it walks backward is what
	* catches transitive chains (an antecedent's antecedent). The result
	* keeps the original chronological order, since that's the order the
	* reasoning actually happened in. */
	selectRelevantChainSteps(steps, finalBasisCells) {
		const dependsOn = new Set(finalBasisCells.map(([r, c]) => cellKey(r, c)));
		const relevant = [];
		for (let i = steps.length - 1; i >= 0; i--) {
			const step = steps[i];
			if (!step.affectedCells.some(([r, c]) => dependsOn.has(cellKey(r, c)))) continue;
			relevant.unshift(step);
			for (const [r, c] of step.basisCells) dependsOn.add(cellKey(r, c));
		}
		return relevant;
	}
	/** `final` is the technique that forced `colored`, in the same shape an
	* antecedent is recorded in. `dependencyCells` is what dependency-
	* tracking checks prior steps against - defaults to `final.basisCells`,
	* but a hidden single's real dependency is its whole unit (see
	* findNewlyHiddenSingleCells), not just the one cell it resolves, so that
	* case passes the unit's 9 cells here instead while still highlighting
	* only the resolved cell. */
	buildRule3CombinedMove(primary, steps, final, colored, conclusion, dependencyCells = final.basisCells) {
		const antecedents = this.selectRelevantChainSteps(steps, dependencyCells);
		const techniqueSteps = [...antecedents, final].filter((s) => s.technique !== "hidden single");
		const toAicChain = (aic) => ({
			...aicChainView(aic),
			...aic.pattern ? { pattern: aic.pattern } : {}
		});
		const aicInstances = techniqueSteps.map((s) => s.aic).filter((aic) => !!aic);
		const aicChains = aicInstances.length > 0 ? aicInstances.map((aic) => ({
			...aicChainView(aic),
			hypotheticalEliminations: aic.eliminations.map((e) => ({
				row: e.row,
				col: e.col,
				digit: e.digit
			}))
		})) : void 0;
		const extensionClause = this.rule3ExtensionClause(colored, conclusion);
		const substeps = [...techniqueSteps.map((s) => ({
			technique: s.technique,
			clause: s.clause,
			basisCells: s.basisCells,
			eliminatedCandidates: s.eliminatedCandidates,
			aic: s.aic ? toAicChain(s.aic) : void 0
		})), {
			technique: "dragon colour extension",
			clause: extensionClause,
			basisCells: [[colored.row, colored.col]],
			eliminatedCandidates: []
		}];
		const techniquesText = techniqueSteps.length > 0 ? `, then we have ${techniqueSteps.map((s) => s.summaryName).join(", which reveals ")}` : "";
		return {
			id: "",
			kind: "extension-rule3",
			dynamicTechniques: techniqueSteps.map((s) => s.technique),
			dynamicTechniqueCells: [...antecedents.flatMap((s) => s.basisCells), ...final.basisCells],
			description: `Assuming ${colorLabel(primary)} is true${techniquesText}. ${extensionClause}.`,
			colored: [colored],
			eliminated: [],
			solved: [],
			aicChains,
			substeps
		};
	}
	/** The closing "As a result, ..." substep of every Extension Rule 3 move:
	* the colouring itself, kept apart from the technique that forced it so
	* the substep player shows the technique's own work first and the new
	* dragon colour after it. */
	rule3ExtensionClause(colored, conclusion) {
		const cell = cellRef$1(colored.row, colored.col);
		const colouring = `so colour ${colored.digit}${cell} ${colorLabel(colored.color)}`;
		switch (conclusion.kind) {
			case "single candidate": return `As a result, ${cell} will only have 1 option (${colored.digit}), ${colouring}`;
			case "hidden single": return `As a result, ${cell} is the only place left for ${colored.digit} in its ${conclusion.unitKind}, ${colouring}`;
			case "direct": return `As a result, ${cell} must be ${colored.digit}, ${colouring}`;
		}
	}
	/** Any uncoloured cell the hypothetical simulation has narrowed to
	* exactly one remaining candidate - the thing both Extension Rule 3's
	* naked-pair and elimination-only-Unique-Rectangle branches are looking
	* for after applying their own step. */
	findNewlySingleCandidateCell(hypBoard, hypCandidates, nodeMap) {
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (hypBoard[row][col] !== 0) continue;
			const digits = markedCandidateDigits(hypCandidates[row][col]);
			if (digits.length !== 1) continue;
			const digit = digits[0];
			if (nodeMap.has(nodeKey(row, col, digit))) continue;
			return {
				row,
				col,
				digit
			};
		}
		return null;
	}
	/** A hidden single anywhere in the hypothetical simulation - a digit
	* that's a candidate in only one cell of some row, column, or box, even
	* though that cell may still show other candidates too. Checked before
	* any elimination-only technique on every iteration, since it needs
	* nothing beyond the current candidate marks to be a valid, standalone
	* conclusion - simulating a more complex technique to reach a cell a
	* hidden single already resolves would misrepresent the reasoning.
	*
	* Every such hidden single, in scan order, up to `limit` - see
	* extensionRule1Moves. A candidate that's a hidden single in more than one
	* unit is listed once, with the first unit found. */
	findNewlyHiddenSingleCells(hypBoard, hypCandidates, nodeMap, limit) {
		const finds = [];
		const found = /* @__PURE__ */ new Set();
		for (const unit of sudokuUnits()) for (let digit = 1; digit <= 9; digit++) {
			let count = 0;
			let row = -1;
			let col = -1;
			for (const [r, c] of unit) if (hypBoard[r][c] === 0 && hypCandidates[r][c][digit - 1]) {
				if (++count > 1) break;
				row = r;
				col = c;
			}
			if (count !== 1) continue;
			const key = nodeKey(row, col, digit);
			if (nodeMap.has(key) || found.has(key)) continue;
			found.add(key);
			finds.push({
				row,
				col,
				digit,
				unitKind: classifyUnitKind(unit),
				unit
			});
			if (finds.length >= limit) return finds;
		}
		return finds;
	}
	lockedCandidateClause(instance) {
		const typeLabel = instance.type === "pointing" ? "Pointing" : "Claiming";
		const basisLabel = instance.basisCells.map(([r, c]) => cellRef$1(r, c)).join(", ");
		const eliminationsLabel = this.formatCandidateGroups(instance.eliminations);
		return `a Locked Candidate (${typeLabel}) for ${instance.digit} in {${basisLabel}}, which eliminates ${eliminationsLabel}`;
	}
	nakedPairClause(pair) {
		const [a, b] = pair.digits;
		return `a naked pair of {${a},${b}} in {${pair.cells.map(([r, c]) => cellRef$1(r, c)).join(", ")}}, which eliminates ${this.formatCandidateGroups(pair.eliminations)}`;
	}
	nakedSubsetClause(subset) {
		const sizeWord = subset.size === 3 ? "triple" : "quad";
		const cellsLabel = subset.cells.map(([r, c]) => cellRef$1(r, c)).join(", ");
		return `a naked ${sizeWord} of {${subset.digits.join(",")}} in {${cellsLabel}}, which eliminates ${this.formatCandidateGroups(subset.eliminations)}`;
	}
	hiddenPairClause(pair) {
		const [a, b] = pair.digits;
		return `a hidden pair of {${a},${b}} in {${pair.cells.map(([r, c]) => cellRef$1(r, c)).join(", ")}}, which eliminates ${this.formatCandidateGroups(pair.eliminations)}`;
	}
	fishClause(fish) {
		const eliminationsLabel = this.formatCandidateGroups(fish.eliminations);
		return `a ${FISH_TECHNIQUE_NAMES[fish.technique]} (${fish.reasonText}), which eliminates ${eliminationsLabel}`;
	}
	alsXzClause(als) {
		const eliminationsLabel = this.formatCandidateGroups(als.eliminations);
		return `an ALS-xz (${als.reasonText}), which eliminates ${eliminationsLabel}`;
	}
	uniqueRectangleClause(ur) {
		const eliminationsLabel = this.formatCandidateGroups(ur.eliminatedCandidates);
		return `${ur.reasonText}, which eliminates ${eliminationsLabel}`;
	}
	bugPlusOneClause(bug) {
		const [row, col] = bug.cell;
		return `a BUG+1 at ${cellRef$1(row, col)} (candidates {${bug.candidates.join(",")}}), where ${bug.solvedDigit} appears three times in its ${bug.unitKind}`;
	}
	avoidableRectangleClause(ar) {
		return `an Avoidable Rectangle (Type ${ar.type}) of {${ar.digits.join(",")}} at ${ar.cells.map(([r, c]) => cellRef$1(r, c)).join(", ")}, ${ar.reasonText}, which eliminates ${this.formatCandidateGroups(ar.eliminations)}`;
	}
	bivalueOddagonClauseIntro(oddagon) {
		const [a, b] = oddagon.loopDigits;
		const cellsLabel = oddagon.cells.map(([r, c]) => cellRef$1(r, c)).join(", ");
		return `a ${oddagon.cells.length}-cell Bivalue Oddagon of {${a},${b}} at ${cellsLabel}`;
	}
	bivalueOddagonSolveClause(oddagon) {
		const [row, col] = oddagon.solvedCell;
		return `${this.bivalueOddagonClauseIntro(oddagon)}, whose only guardian is ${oddagon.guardianDigit}${cellRef$1(row, col)}`;
	}
	bivalueOddagonEliminationClause(oddagon) {
		const eliminationsLabel = this.formatCandidateGroups(oddagon.eliminations);
		return `${this.bivalueOddagonClauseIntro(oddagon)}, which eliminates ${eliminationsLabel}`;
	}
	aicLabel(technique) {
		return technique === "short single-digit aic" ? "short single-digit AIC" : technique === "generic aic" ? "generic AIC" : "short AIC";
	}
	/** "a short AIC (Type 2)", or for a named single-digit pattern just its
	* name ("a Skyscraper", "an Empty Rectangle") - those are always Type 1. */
	aicSummaryName(aic, technique) {
		if (aic.pattern) return `${aic.pattern === "Empty Rectangle" ? "an" : "a"} ${aic.pattern}`;
		return `a ${this.aicLabel(technique)} (Type ${aic.eliminationType})`;
	}
	aicClause(aic, technique) {
		const eliminationsLabel = this.formatCandidateGroups(aic.eliminations);
		return `${this.aicSummaryName(aic, technique)} of ${aicChainText(aic.nodes)}, which eliminates ${eliminationsLabel}`;
	}
	/** The plain (always-on) hidden-single extension's whole explanation -
	* see findExtensionHiddenSingleMove. Extension Rule 3's own hidden
	* single is worded by rule3ExtensionClause instead. */
	hiddenSingleClause(secondary, cell) {
		return `a hidden single at ${cellRef$1(cell.row, cell.col)}, since ${cell.digit} has nowhere else to go in its ${cell.unitKind}, so colour it ${colorLabel(secondary)}`;
	}
	/** Formats a set of candidate eliminations as compact "digitscellref"
	* groups (e.g. "23r1c7"), one per affected cell, matching how a
	* solving guide would write it. */
	formatCandidateGroups(eliminations) {
		const byCell = /* @__PURE__ */ new Map();
		for (const { row, col, digit } of eliminations) {
			const key = cellKey(row, col);
			const digits = byCell.get(key) ?? [];
			digits.push(digit);
			byCell.set(key, digits);
		}
		return Array.from(byCell.entries()).map(([key, digits]) => {
			const [row, col] = key.split(",").map(Number);
			return `${[...digits].sort((x, y) => x - y).join("")}${cellRef$1(row, col)}`;
		}).join(", ");
	}
	/** Which of the first Dragon's sides each second-Dragon node of side
	* `side` can't be true together with (a weak link: same cell and different
	* digits, or same digit in a shared unit) - the first such pair per first
	* side. X linked to S means X => not S => S'. */
	dragonLinks(nodeMap, linked, side) {
		const links = {
			A: null,
			B: null
		};
		for (const own of nodeMap.values()) {
			if (sideOf(own.color) !== side) continue;
			for (const theirs of linked.firstNodes) {
				const firstSide = sideOf(theirs.color);
				if (!links[firstSide] && cannotBothBeTrue(own, theirs)) links[firstSide] = {
					own,
					theirs
				};
			}
			if (links.A && links.B) break;
		}
		return links;
	}
	linkClause({ own, theirs }) {
		const ref = (n) => `${n.digit}${cellRef$1(n.row, n.col)}`;
		return `${ref(own)} (${SECOND_DRAGON_LABELS[own.color]}) and ${ref(theirs)} (${colorLabel(theirs.color)}) can't both be true`;
	}
	/** "X is linked to S, so X implies S'", worded for a move description. */
	linkReasoning(link, primary) {
		const xName = SECOND_DRAGON_LABELS[primary];
		const falseSide = sideOf(link.theirs.color);
		const falseName = colorLabel(primaryForSide(falseSide));
		const impliedName = colorLabel(primaryForSide(oppositeSide(falseSide)));
		return `${this.linkClause(link)}: if ${falseName} is true, ${link.theirs.digit}${cellRef$1(link.theirs.row, link.theirs.col)} is true, so ${xName} is false. So if ${xName} is true, ${falseName} is false and ${impliedName} is true`;
	}
	/** Double Dragon Colouring's Dragon link, as an extension of the second
	* Dragon's side of `primary` (X) - see extendDouble. When X is linked to
	* exactly one of the first Dragon's sides, S, it implies every node of S':
	* those not coloured yet (by either of the second Dragon's sides) and still
	* candidates are coloured X's dragon colour. Null when there's no link, when
	* X is linked to both sides (findDragonLinkConclusion's case), or when
	* nothing is left to colour. A pure function of the colouring, like every
	* other extension rule, so it works unchanged in Optimize's search. */
	findDragonLinkMove(nodeMap, linked, primary, candidates) {
		const side = sideOfPrimary(primary);
		const links = this.dragonLinks(nodeMap, linked, side);
		if (!links.A === !links.B) return null;
		const link = links.A ?? links.B;
		const impliedSide = oppositeSide(sideOf(link.theirs.color));
		const secondary = secondaryForSide(side);
		const colored = [];
		for (const n of linked.firstNodes) if (sideOf(n.color) === impliedSide && candidates[n.row][n.col][n.digit - 1] && !nodeMap.has(nodeKey(n.row, n.col, n.digit))) colored.push({
			row: n.row,
			col: n.col,
			digit: n.digit,
			color: secondary
		});
		if (colored.length === 0) return null;
		const impliedNames = `${colorLabel(primaryForSide(impliedSide))}/${colorLabel(secondaryForSide(impliedSide))}`;
		return {
			id: "",
			kind: "dragon-link",
			description: `${this.linkReasoning(link, primary)} - and so is every ${impliedNames} coloured candidate: thus, we can colour ${colored.length === 1 ? "it" : "them"} ${SECOND_DRAGON_LABELS[secondary]} as well, while keeping the original ${impliedNames} (${colored.map((n) => `${n.digit}${cellRef$1(n.row, n.col)}`).join(", ")}).`,
			colored,
			eliminated: [],
			solved: [],
			secondDragon: true
		};
	}
	/** What Dragon links settle outright, checked alongside the elimination
	* rules (a pure function of the colouring, like them):
	*  - a second-Dragon side X linked to both of the first Dragon's sides
	*    would make both false - X is false;
	*  - X linked to S (so X => S') while a node of S' is a Medusa colour of
	*    the other side X' - X would imply X', so X is false;
	*  - both X and X' linked to the same S - S' is true either way (a move
	*    about the first Dragon's own colours, `secondDragon: false`).
	* Each is a mass-elimination move; null when none applies. */
	findDragonLinkConclusion(nodeMap, linked) {
		const links = {
			A: this.dragonLinks(nodeMap, linked, "A"),
			B: this.dragonLinks(nodeMap, linked, "B")
		};
		const nodes = Array.from(nodeMap.values());
		for (const side of ["A", "B"]) {
			const primary = primaryForSide(side);
			const xName = SECOND_DRAGON_LABELS[primary];
			const { A: linkA, B: linkB } = links[side];
			if (linkA && linkB) return {
				...this.buildMassMove(nodes, side, `${this.linkClause(linkA)}, and ${this.linkClause(linkB)}. So if ${xName} were true, light blue and yellow would both be false - but one of them is true, so ${xName} is false.`),
				secondDragon: true
			};
			const link = linkA ?? linkB;
			if (!link) continue;
			const impliedSide = oppositeSide(sideOf(link.theirs.color));
			const clash = linked.firstNodes.find((n) => {
				const existing = sideOf(n.color) === impliedSide ? nodeMap.get(nodeKey(n.row, n.col, n.digit)) : void 0;
				return existing !== void 0 && sideOf(existing.color) !== side && isPrimary(existing.color);
			});
			if (clash) {
				const clashName = SECOND_DRAGON_LABELS[primaryForSide(oppositeSide(side))];
				return {
					...this.buildMassMove(nodes, side, `${this.linkReasoning(link, primary)}, which includes ${clash.digit}${cellRef$1(clash.row, clash.col)} - coloured ${clashName}. So ${xName} would make ${clashName} true as well, and ${xName} is false.`),
					secondDragon: true
				};
			}
			const otherLink = links[oppositeSide(side)][sideOf(link.theirs.color)];
			if (otherLink) {
				const impliedName = colorLabel(primaryForSide(impliedSide));
				const otherName = SECOND_DRAGON_LABELS[primaryForSide(oppositeSide(side))];
				return {
					...this.buildMassMove([...linked.firstNodes], sideOf(link.theirs.color), `${this.linkReasoning(link, primary)}. Likewise ${this.linkClause(otherLink)}, so ${otherName} implies ${impliedName} too - ${impliedName} is true whichever of pink and lime green is.`),
					secondDragon: false
				};
			}
		}
		return null;
	}
	/** Promotion: an opposite-side pair of the same candidate seeing each
	* other, or an opposite-side pair sharing a cell, each prove the other's
	* side always holds exactly when their own does - so both can drop the
	* "conditional on" and become their side's medusa color outright. */
	findPromotionMove(nodeMap) {
		const nodes = Array.from(nodeMap.values());
		for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
			const a = nodes[i];
			const b = nodes[j];
			if (a.digit !== b.digit || sideOf(a.color) === sideOf(b.color)) continue;
			if (isPrimary(a.color) && isPrimary(b.color)) continue;
			if (!sameUnit([a.row, a.col], [b.row, b.col])) continue;
			return this.buildPromotionMove(a, b);
		}
		const byCell = /* @__PURE__ */ new Map();
		for (const n of nodes) {
			const k = cellKey(n.row, n.col);
			const list = byCell.get(k) ?? [];
			list.push(n);
			byCell.set(k, list);
		}
		for (const cellNodes of byCell.values()) for (let i = 0; i < cellNodes.length; i++) for (let j = i + 1; j < cellNodes.length; j++) {
			const a = cellNodes[i];
			const b = cellNodes[j];
			if (sideOf(a.color) === sideOf(b.color) || isPrimary(a.color) && isPrimary(b.color)) continue;
			return this.buildPromotionMove(a, b);
		}
		return null;
	}
	buildPromotionMove(a, b) {
		const colored = [];
		if (!isPrimary(a.color)) colored.push({
			...a,
			color: primaryForSide(sideOf(a.color))
		});
		if (!isPrimary(b.color)) colored.push({
			...b,
			color: primaryForSide(sideOf(b.color))
		});
		return {
			id: "",
			kind: "promotion",
			description: `${a.digit}${cellRef$1(a.row, a.col)} and ${b.digit}${cellRef$1(b.row, b.col)} are coloured in ${colorLabel(a.color)} and ${colorLabel(b.color)}. Promote both colours to their primary Medusa colour (if not already Medusa).`,
			colored,
			eliminated: [],
			solved: []
		};
	}
	/** Checked whenever no elimination is pending (not only in exhaustive
	* mode - see extend's loop): if one side's nodes (primary or dragon) between
	* them cover every empty cell, assuming that side true fills the whole
	* grid. Callers must already have ruled out a mass elimination (which
	* would show that side contradicting itself), so what's left is a
	* conflict-free full grid - and a valid puzzle has just one solution, so
	* it's the solution. The same reliance on uniqueness as Unique Rectangle
	* Type 1. Returns null if neither side, or both sides, cover the grid
	* (two conflict-free full grids would mean two solutions, so there's no
	* telling which is meant). */
	findColouringSolutionMove(nodeMap, board) {
		const sidesByCell = /* @__PURE__ */ new Map();
		for (const n of nodeMap.values()) {
			const key = cellKey(n.row, n.col);
			const sides = sidesByCell.get(key) ?? /* @__PURE__ */ new Set();
			sides.add(sideOf(n.color));
			sidesByCell.set(key, sides);
		}
		const covers = {
			A: true,
			B: true
		};
		let emptyCells = 0;
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0) continue;
			emptyCells++;
			const sides = sidesByCell.get(cellKey(row, col));
			covers.A &&= sides?.has("A") ?? false;
			covers.B &&= sides?.has("B") ?? false;
			if (!covers.A && !covers.B) return null;
		}
		if (emptyCells === 0 || covers.A === covers.B) return null;
		const side = covers.A ? "A" : "B";
		return {
			id: "",
			kind: "solution",
			description: `Every empty cell is coloured ${colorLabel(primaryForSide(side))} (or its dragon colour), so that colouring is the solution.`,
			colored: [],
			provenTrueColor: primaryForSide(side),
			eliminated: [],
			solved: Array.from(nodeMap.values()).filter((n) => sideOf(n.color) === side).map((n) => ({
				row: n.row,
				col: n.col,
				digit: n.digit
			}))
		};
	}
	findEliminationMoves(nodes, board, candidates) {
		if (!hasAnyElimination(nodes, board, candidates)) return [];
		const mass = this.findMassElimination(nodes, board, candidates);
		if (mass) return [mass];
		const rule4 = this.findRule4(nodes, candidates);
		const eliminatedKeys = new Set(rule4.flatMap((m) => m.eliminated.map((e) => nodeKey(e.row, e.col, e.digit))));
		const firstOnly = (moves) => moves.filter((m) => {
			const [e] = m.eliminated;
			const key = nodeKey(e.row, e.col, e.digit);
			if (eliminatedKeys.has(key)) return false;
			eliminatedKeys.add(key);
			return true;
		});
		const rule3 = firstOnly(this.findRule3(nodes, board, candidates));
		const rule5 = firstOnly(this.findRule5(nodes, candidates));
		return [
			...rule3,
			...rule4,
			...rule5
		];
	}
	findMassElimination(nodes, board, candidates) {
		const byCell = /* @__PURE__ */ new Map();
		for (const n of nodes) {
			const k = cellKey(n.row, n.col);
			const list = byCell.get(k) ?? [];
			list.push(n);
			byCell.set(k, list);
		}
		for (const cellNodes of byCell.values()) for (let i = 0; i < cellNodes.length; i++) for (let j = i + 1; j < cellNodes.length; j++) {
			const a = cellNodes[i];
			const b = cellNodes[j];
			if (sideOf(a.color) === sideOf(b.color)) return this.buildMassMove(nodes, sideOf(a.color), `In ${cellRef$1(a.row, a.col)}, ${a.digit} (${colorLabel(a.color)}) and ${b.digit} (${colorLabel(b.color)}) are colours belonging to the same Medusa color, so that Medusa color is false.`);
		}
		for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
			const a = nodes[i];
			const b = nodes[j];
			if (a.digit !== b.digit || sideOf(a.color) !== sideOf(b.color)) continue;
			if (!sameUnit([a.row, a.col], [b.row, b.col])) continue;
			return this.buildMassMove(nodes, sideOf(a.color), `${a.digit} in ${cellRef$1(a.row, a.col)} (${colorLabel(a.color)}) and ${cellRef$1(b.row, b.col)} (${colorLabel(b.color)}) are colours belonging to the same Medusa color, so that Medusa color is false.`);
		}
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0 || byCell.has(cellKey(row, col))) continue;
			const digits = markedCandidateDigits(candidates[row][col]);
			if (digits.length === 0) continue;
			for (const side of ["A", "B"]) if (digits.every((digit) => nodes.some((n) => sideOf(n.color) === side && n.digit === digit && sameUnit([row, col], [n.row, n.col])))) return this.buildMassMove(nodes, side, `${cellRef$1(row, col)} has no coloured candidates, but ${digits.join(", ")} all see the ${colorLabel(primaryForSide(side))} side, so that side is false.`, [row, col]);
		}
		return null;
	}
	/** A dragon (secondary) color only records "if this side is true, this
	* candidate is true" - one direction. Proving a side false says nothing
	* about its still-conditional dragon candidates (denying the antecedent),
	* so only that side's *primary* nodes - including ones promotion has
	* already turned into primary colors - can be eliminated here. Proving a
	* side true is the sound direction (modus ponens) for both its primary
	* and dragon nodes, so the true side's dragon candidates can be solved. */
	buildMassMove(nodes, falseSide, description, emptiedCell) {
		const trueSide = oppositeSide(falseSide);
		return {
			id: "",
			kind: "mass-elimination",
			description,
			colored: [],
			provenTrueColor: primaryForSide(trueSide),
			eliminated: nodes.filter((n) => sideOf(n.color) === falseSide && isPrimary(n.color)).map((n) => ({
				row: n.row,
				col: n.col,
				digit: n.digit
			})),
			solved: nodes.filter((n) => sideOf(n.color) === trueSide).map((n) => ({
				row: n.row,
				col: n.col,
				digit: n.digit
			})),
			emptiedCell
		};
	}
	/** Rule 3: a candidate outside the chain that sees the same digit colored
	* on both sides - eliminated whichever side turns out true. */
	findRule3(nodes, board, candidates) {
		const coloredKeys = new Set(nodes.map((n) => nodeKey(n.row, n.col, n.digit)));
		const results = [];
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0) continue;
			for (const digit of markedCandidateDigits(candidates[row][col])) {
				if (coloredKeys.has(nodeKey(row, col, digit))) continue;
				const seesA = nodes.find((n) => sideOf(n.color) === "A" && n.digit === digit && sameUnit([row, col], [n.row, n.col]));
				const seesB = nodes.find((n) => sideOf(n.color) === "B" && n.digit === digit && sameUnit([row, col], [n.row, n.col]));
				if (seesA && seesB) results.push({
					id: "",
					kind: "rule3",
					description: `${cellRef$1(row, col)} cannot be ${digit} - it sees ${digit}'s coloured with opposite colours (${cellRef$1(seesA.row, seesA.col)} ${colorLabel(seesA.color)}, ${cellRef$1(seesB.row, seesB.col)} ${colorLabel(seesB.color)}).`,
					colored: [],
					eliminated: [{
						row,
						col,
						digit
					}],
					solved: []
				});
			}
		}
		return results;
	}
	/** Rule 4: a cell with a colored candidate on each side - every other
	* candidate in that cell is eliminated. */
	findRule4(nodes, candidates) {
		const byCell = /* @__PURE__ */ new Map();
		for (const n of nodes) {
			const k = cellKey(n.row, n.col);
			const list = byCell.get(k) ?? [];
			list.push(n);
			byCell.set(k, list);
		}
		const results = [];
		for (const [key, cellNodes] of byCell) {
			const hasA = cellNodes.some((n) => sideOf(n.color) === "A");
			const hasB = cellNodes.some((n) => sideOf(n.color) === "B");
			if (!hasA || !hasB) continue;
			const [row, col] = key.split(",").map(Number);
			const coloredDigits = new Set(cellNodes.map((n) => n.digit));
			const eliminatedDigits = markedCandidateDigits(candidates[row][col]).filter((d) => !coloredDigits.has(d));
			if (eliminatedDigits.length === 0) continue;
			results.push({
				id: "",
				kind: "rule4",
				description: `${cellRef$1(row, col)} has candidates coloured with opposite colours, so the uncoloured candidate${eliminatedDigits.length === 1 ? "" : "s"} (${eliminatedDigits.join(", ")}) can be eliminated.`,
				colored: [],
				eliminated: eliminatedDigits.map((digit) => ({
					row,
					col,
					digit
				})),
				solved: []
			});
		}
		return results;
	}
	/** Rule 5: a cell with exactly one colored candidate - its other
	* candidates are eliminated if they see the same digit colored on the
	* opposite side elsewhere. */
	findRule5(nodes, candidates) {
		const byCell = /* @__PURE__ */ new Map();
		for (const n of nodes) {
			const k = cellKey(n.row, n.col);
			const list = byCell.get(k) ?? [];
			list.push(n);
			byCell.set(k, list);
		}
		const results = [];
		for (const [key, cellNodes] of byCell) {
			if (cellNodes.length !== 1) continue;
			const [row, col] = key.split(",").map(Number);
			const colored = cellNodes[0];
			const otherSide = oppositeSide(sideOf(colored.color));
			for (const digit of markedCandidateDigits(candidates[row][col])) {
				if (digit === colored.digit) continue;
				const opponent = nodes.find((n) => sideOf(n.color) === otherSide && n.digit === digit && !(n.row === row && n.col === col) && sameUnit([row, col], [n.row, n.col]));
				if (opponent) results.push({
					id: "",
					kind: "rule5",
					description: `${cellRef$1(row, col)} is not ${digit} - its cell has a candidate coloured ${colorLabel(colored.color)}, and it sees an oppositely coloured ${digit} (${colorLabel(opponent.color)}) at ${cellRef$1(opponent.row, opponent.col)}.`,
					colored: [],
					eliminated: [{
						row,
						col,
						digit
					}],
					solved: []
				});
			}
		}
		return results;
	}
};
//#endregion
//#region src/sudoku/dragonReplay.ts
/** Every candidate's colour as of `moves[0..stepIndex]` - a promotion move
* overwrites an earlier colour for the same candidate rather than adding a
* second one, so each candidate shows only its latest colour at that step.
* Eliminated/solved candidates just accumulate.
*
* Shared by the Techniques panel's Dragon stepper (App.tsx) and the How It
* Works tutorial, so both replay a move log identically.
*
* `includeCurrentMove` (default true, what every caller but the live
* substep player wants) controls whether the move *at* `stepIndex` itself
* counts, or only the moves before it. A Dynamic Dragon Colouring step's
* own "substep" player (see App.tsx's DragonStepper) reveals that one
* move's chained reasoning one technique at a time; until it reaches the
* last technique, the move's own conclusion (the cell it colours) hasn't
* been "revealed" yet, so this withholds it from the fold. */
function foldDragonMoves(moves, stepIndex, includeCurrentMove = true) {
	const colorByKey = /* @__PURE__ */ new Map();
	const secondColorByKey = /* @__PURE__ */ new Map();
	const eliminatedCandidates = [];
	const solvedCandidates = [];
	const lastIndex = Math.min(stepIndex, moves.length - 1) - (includeCurrentMove ? 0 : 1);
	for (let i = 0; i <= lastIndex; i++) {
		const move = moves[i];
		for (const n of move.colored) (move.secondDragon ? secondColorByKey : colorByKey).set(`${n.row},${n.col},${n.digit}`, n);
		eliminatedCandidates.push(...move.eliminated);
		solvedCandidates.push(...move.solved);
	}
	const blueCandidates = [];
	const yellowCandidates = [];
	const darkBlueCandidates = [];
	const orangeCandidates = [];
	const pinkCandidates = [];
	const purpleCandidates = [];
	const limeGreenCandidates = [];
	const darkGreenCandidates = [];
	for (const n of secondColorByKey.values()) {
		const ref = {
			row: n.row,
			col: n.col,
			digit: n.digit
		};
		if (n.color === "blue") pinkCandidates.push(ref);
		else if (n.color === "darkBlue") purpleCandidates.push(ref);
		else if (n.color === "yellow") limeGreenCandidates.push(ref);
		else darkGreenCandidates.push(ref);
	}
	for (const n of colorByKey.values()) {
		const ref = {
			row: n.row,
			col: n.col,
			digit: n.digit
		};
		if (n.color === "blue") blueCandidates.push(ref);
		else if (n.color === "yellow") yellowCandidates.push(ref);
		else if (n.color === "darkBlue") darkBlueCandidates.push(ref);
		else orangeCandidates.push(ref);
	}
	return {
		blueCandidates,
		yellowCandidates,
		darkBlueCandidates,
		orangeCandidates,
		pinkCandidates,
		purpleCandidates,
		limeGreenCandidates,
		darkGreenCandidates,
		eliminatedCandidates,
		solvedCandidates
	};
}
//#endregion
//#region src/sudoku/SudokuDragonTargetFinder.ts
/** Every pencil mark that disappears when a technique's solves and
* eliminations are all applied - including the peers a solved cell wipes and
* that cell's own other candidates, but not the solved digit itself (that
* mark becomes the cell's value). */
function listEffectiveEliminations(board, candidates, effect) {
	const nextBoard = cloneBoard(board);
	const after = cloneCandidates(candidates);
	const solvedDigitByCell = /* @__PURE__ */ new Map();
	for (const { row, col, digit } of effect.solvedCandidates) {
		nextBoard[row][col] = digit;
		after[row][col] = Array(9).fill(false);
		SudokuRules.eliminatePeerCandidates(after, nextBoard, row, col, digit);
		solvedDigitByCell.set(`${row},${col}`, digit);
	}
	for (const { row, col, digit } of effect.eliminatedCandidates) after[row][col][digit - 1] = false;
	const removed = [];
	for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
		if (board[row][col] !== 0) continue;
		const solvedDigit = solvedDigitByCell.get(`${row},${col}`);
		for (let digit = 1; digit <= 9; digit++) if (candidates[row][col][digit - 1] && !after[row][col][digit - 1] && digit !== solvedDigit) removed.push({
			row,
			col,
			digit
		});
	}
	return removed;
}
//#endregion
//#region src/sudoku/SudokuSingleFinder.ts
/**
* Finds cells whose solution is forced by the currently marked candidates -
* it reasons only about those marks, not the underlying Sudoku rules, so it
* finds nothing where candidates haven't been filled in (see Autofill all).
*/
var SudokuSingleFinder = class {
	/** A naked single: a cell with exactly one candidate marked. */
	findNakedSingles(board, candidates) {
		const found = [];
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0) continue;
			const marked = markedCandidateDigits(candidates[row][col]);
			if (marked.length === 1) found.push({
				row,
				col,
				digit: marked[0]
			});
		}
		return found;
	}
	/**
	* A hidden single: a digit that's a candidate in only one cell of some
	* row, column, or box, even though that cell has other candidates too.
	*/
	findHiddenSingles(board, candidates) {
		const found = [];
		for (const unit of sudokuUnits()) for (let digit = 1; digit <= 9; digit++) {
			const withCandidate = unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1]);
			if (withCandidate.length === 1) {
				const [row, col] = withCandidate[0];
				found.push({
					row,
					col,
					digit
				});
			}
		}
		return found;
	}
	/**
	* Naked singles plus hidden singles, deduplicated by cell. If the two
	* techniques ever propose different digits for the same cell, the marked
	* candidates are inconsistent; the first assignment found wins rather
	* than guessing which is right.
	*/
	findNakedAndHiddenSingles(board, candidates) {
		const assignments = /* @__PURE__ */ new Map();
		const add = (assignment) => {
			const key = `${assignment.row},${assignment.col}`;
			if (!assignments.has(key)) assignments.set(key, assignment);
		};
		this.findNakedSingles(board, candidates).forEach(add);
		this.findHiddenSingles(board, candidates).forEach(add);
		return Array.from(assignments.values());
	}
};
//#endregion
//#region src/techniqueEngine.ts
/**
* The technique engine: every finder wired into one flat, simplest-first
* TechniqueInstance list (buildTechniqueInstances), and the Solve Path search
* built on it (buildSolvePath). Pure logic, no React or DOM - kept out of
* App.tsx so solvePath.worker.ts can run the (up to many seconds) search off
* the main thread.
*/
const singleFinder = new SudokuSingleFinder();
const lockedCandidateFinder = new SudokuLockedCandidateFinder();
const pairFinder = new SudokuPairFinder();
const nakedSubsetFinder = new SudokuNakedSubsetFinder();
const hiddenPairFinder = new SudokuHiddenPairFinder();
const fishFinder = new SudokuFishFinder();
const shortAicFinder = new SudokuShortAicFinder();
const genericAicFinder = new SudokuGenericAicFinder();
const alsXzFinder = new SudokuAlsXzFinder();
const uniqueRectangleFinder = new SudokuUniqueRectangleFinder();
const bugPlusOneFinder = new SudokuBugPlusOneFinder();
const avoidableRectangleFinder = new SudokuAvoidableRectangleFinder();
const bivalueOddagonFinder = new SudokuBivalueOddagonFinder();
const colorFinder = new SudokuColorFinder();
const medusaFinder = new SudokuMedusaFinder();
const dragonFinder = new SudokuDragonFinder();
const DIGITS = [
	1,
	2,
	3,
	4,
	5,
	6,
	7,
	8,
	9
];
const FISH_RANKS = {
	"x-wing": 8,
	"finned x-wing": 10,
	swordfish: 12,
	"finned swordfish": 13
};
function cellRef(row, col) {
	return `r${row + 1}c${col + 1}`;
}
/** Dragon Colouring only applies once Medusa's own rules 1-5 find nothing
* for a chain ("colour the medusa until it gets stuck"); this finds every
* such stuck chain and extends each one, skipping chains where nothing
* actionable comes out of the extension. Shared by the Techniques panel and
* the Dragon colouring auto-solve buttons so the two can't drift apart. */
function computeStuckDragonExtensions(board, candidates, filter = "any", minBaseCandidates = 0, exhaustive = true, optimize = false) {
	const results = [];
	for (const chain of medusaFinder.findChains(board, candidates)) {
		if (filter === "bivalue-seeded" && !chain.hasBivalueCellLink) continue;
		if (chain.candidates.length < minBaseCandidates) continue;
		if (!(medusaFinder.findMassElimination(chain, board, candidates) === null && medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 && medusaFinder.findRule4Eliminations(chain, candidates).length === 0 && medusaFinder.findRule5Eliminations(chain, candidates).length === 0)) continue;
		const result = dragonFinder.extend(chain, board, candidates, {
			exhaustive,
			optimize
		});
		if (!result) continue;
		const chainKey = chain.candidates.map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`).sort().join("-");
		results.push({
			chainKey,
			moves: result.moves,
			hasBivalueCellLink: chain.hasBivalueCellLink
		});
	}
	return results;
}
/** Dynamic Dragon Colouring: the same stuck-chain search as plain Dragon
* Colouring, but only surfacing chains where the *dynamic* extension
* (Extension Rule 3 - naked pairs and Unique Rectangle (any type) propagated
* through a side's assumption) was actually necessary. A chain plain
* Dragon Colouring can already resolve is left to that technique instead,
* so the two never both claim the same chain. */
function computeStuckDynamicDragonExtensions(board, candidates, filter = "any", minBaseCandidates = 0, allowedRule3Techniques = new Set(DEFAULT_RULE3_TECHNIQUES), aicLimitPerStep = true, exhaustive = true, optimize = false, optimizeDynamic = false, maxTechniquesPerStep = Infinity, givens = null) {
	const results = [];
	for (const chain of medusaFinder.findChains(board, candidates)) {
		if (filter === "bivalue-seeded" && !chain.hasBivalueCellLink) continue;
		if (chain.candidates.length < minBaseCandidates) continue;
		if (!(medusaFinder.findMassElimination(chain, board, candidates) === null && medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 && medusaFinder.findRule4Eliminations(chain, candidates).length === 0 && medusaFinder.findRule5Eliminations(chain, candidates).length === 0)) continue;
		if (dragonFinder.extend(chain, board, candidates)) continue;
		const result = dragonFinder.extend(chain, board, candidates, {
			dynamic: true,
			allowedRule3Techniques,
			aicLimitPerStep,
			maxTechniquesPerStep,
			givens,
			exhaustive,
			optimize: optimize || optimizeDynamic,
			optimizeDynamic
		});
		if (!result) continue;
		const chainKey = chain.candidates.map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`).sort().join("-");
		results.push({
			chainKey,
			moves: result.moves,
			hasBivalueCellLink: chain.hasBivalueCellLink
		});
	}
	return results;
}
/** Double Dragon Colouring (SudokuDragonFinder.findDoubleDragons) on every
* pair of stuck chains. Pairs whose results make exactly the same
* eliminations and placements are listed once, keeping the shortest log. */
function computeDoubleDragonExtensions(board, candidates, minBaseCandidates = 0, exhaustive = true, optimize = false) {
	const chains = medusaFinder.findChains(board, candidates).filter((chain) => medusaFinder.findMassElimination(chain, board, candidates) === null && medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 && medusaFinder.findRule4Eliminations(chain, candidates).length === 0 && medusaFinder.findRule5Eliminations(chain, candidates).length === 0);
	const chainKey = (chain) => chain.candidates.map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`).sort().join("-");
	const byEffect = /* @__PURE__ */ new Map();
	for (const { first, second, moves } of dragonFinder.findDoubleDragons(chains, board, candidates, {
		exhaustive,
		optimize,
		minBaseCandidates
	})) {
		const effect = [...moves.flatMap((m) => m.eliminated.map((e) => `x${e.row}${e.col}${e.digit}`)), ...moves.flatMap((m) => m.solved.map((e) => `s${e.row}${e.col}${e.digit}`))].sort().join(",");
		const existing = byEffect.get(effect);
		if (!existing || moves.length < existing.moves.length) byEffect.set(effect, {
			chainKey: `${chainKey(first)}~${chainKey(second)}`,
			moves
		});
	}
	return Array.from(byEffect.values());
}
/** Double Dynamic Dragon Colouring: Double Dragon Colouring where the Dragons
* may use Extension Rule 3 (findDoubleDragons with Dynamic limits - so both
* chains are ones single Dynamic Dragon is stuck on). A result counts only
* when at least one of its Dragons really is Dynamic (some step of either is
* an Extension Rule 3 move); without one it would be a plain Double Dragon.
* A pair plain Double Dragon resolves is left to that technique while it is
* enabled, the way a chain plain Dragon resolves is never also listed as
* Dynamic. `minBaseCandidates` applies to the first Dragon's Medusa. Same
* effect-deduplication as computeDoubleDragonExtensions. */
function computeDoubleDynamicDragonExtensions(board, candidates, minBaseCandidates = 0, allowedRule3Techniques = new Set(DEFAULT_RULE3_TECHNIQUES), aicLimitPerStep = true, maxTechniquesPerStep = Infinity, exhaustive = true, optimize = false, optimizeDynamic = false, doublePlainEnabled = false, givens = null) {
	const chains = medusaFinder.findChains(board, candidates).filter((chain) => medusaFinder.findMassElimination(chain, board, candidates) === null && medusaFinder.findRule3Eliminations(chain, board, candidates).length === 0 && medusaFinder.findRule4Eliminations(chain, candidates).length === 0 && medusaFinder.findRule5Eliminations(chain, candidates).length === 0);
	const chainKey = (chain) => chain.candidates.map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`).sort().join("-");
	const plainPairs = new Set(doublePlainEnabled ? dragonFinder.findDoubleDragons(chains, board, candidates, { minBaseCandidates }).map(({ first, second }) => `${chainKey(first)}~${chainKey(second)}`) : []);
	const byEffect = /* @__PURE__ */ new Map();
	for (const { first, second, moves } of dragonFinder.findDoubleDragons(chains, board, candidates, {
		exhaustive,
		optimize: optimize || optimizeDynamic,
		optimizeDynamic,
		minBaseCandidates,
		dynamic: {
			allowedRule3Techniques,
			aicLimitPerStep,
			maxTechniquesPerStep,
			givens
		}
	})) {
		const key = `${chainKey(first)}~${chainKey(second)}`;
		if (plainPairs.has(key) || !moves.some((move) => move.kind === "extension-rule3")) continue;
		const effect = [...moves.flatMap((m) => m.eliminated.map((e) => `x${e.row}${e.col}${e.digit}`)), ...moves.flatMap((m) => m.solved.map((e) => `s${e.row}${e.col}${e.digit}`))].sort().join(",");
		const existing = byEffect.get(effect);
		if (!existing || moves.length < existing.moves.length) byEffect.set(effect, {
			chainKey: key,
			moves
		});
	}
	return Array.from(byEffect.values());
}
/** A Techniques-panel row for one AIC chain (any kind): the chain written out
* as `digit cell = digit cell - ...`, what it proves, and the chain's links
* for the purple/curved-line drawing on the grid. */
function buildAicInstance(aic, idPrefix, name) {
	const x = aic.nodes[0];
	const y = aic.nodes[aic.nodes.length - 1];
	const eliminationText = aic.eliminations.map((e) => `${cellRef(e.row, e.col)} cannot be ${e.digit}`).join(", ");
	const techniqueRank = idPrefix === "short-single-digit-aic" ? 9 : idPrefix === "short-aic" ? 11 : 15;
	const endText = (n) => n.cells ? `${n.digit} in (${n.cells.map(([r, c]) => cellRef(r, c)).join(", ")})` : aicNodeText(n);
	const view = aicChainView(aic);
	return {
		id: `${idPrefix}-${aic.eliminationType}-${view.candidates.map((n) => `${n.row}.${n.col}.${n.digit}`).join("-")}`,
		name,
		notation: `${aic.patternText ? `${aic.patternText}. ` : ""}${aicChainText(aic.nodes)} states that either ${endText(x)} or ${endText(y)} must be true, so ${eliminationText}.`,
		usedCells: [],
		usedCandidates: [],
		eliminatedCandidates: aic.eliminations,
		solvedCandidates: [],
		aicCandidates: view.candidates,
		aicLinks: view.links,
		...aic.pattern ? {
			aicPattern: aic.pattern,
			aicPatternText: aic.patternText
		} : {},
		techniqueRank
	};
}
/** What a 3D Medusa chain proves, as the Techniques panel's row for it: its
* mass elimination (rules 1-2, if any) plus every rule 3/4/5 elimination not
* already covered by it, or null when the chain proves nothing. Shared by
* buildTechniqueInstances and the "Autocomplete Colours" tab (which builds
* the chain from the user's own painting instead of findChains), so both
* describe a chain identically. `colorNames` only changes the wording - the
* tab names the user's own paint colours ("light blue") instead of the
* chain's internal blue/yellow sides. */
function buildMedusaChainInstance(chain, board, candidates, colorNames = {
	blue: "blue",
	yellow: "yellow"
}) {
	const chainKey = chain.candidates.map((c) => `${c.row}.${c.col}.${c.digit}.${c.color[0]}`).sort().join("-");
	const blueCandidates = chain.candidates.filter((c) => c.color === "blue").map((c) => ({
		row: c.row,
		col: c.col,
		digit: c.digit
	}));
	const yellowCandidates = chain.candidates.filter((c) => c.color === "yellow").map((c) => ({
		row: c.row,
		col: c.col,
		digit: c.digit
	}));
	const rules = /* @__PURE__ */ new Set();
	const clauses = [];
	const usedCandidates = [];
	const eliminatedByKey = /* @__PURE__ */ new Map();
	const solvedCandidates = [];
	const medusaHighlightCells = [];
	const eliminate = (row, col, digit) => {
		eliminatedByKey.set(`${row}.${col}.${digit}`, {
			row,
			col,
			digit
		});
	};
	const mass = medusaFinder.findMassElimination(chain, board, candidates);
	const coveredByMass = mass ? medusaMassCoverage(mass, candidates) : null;
	const coveredByMassDeduction = (row, col, digit) => coveredByMass?.has(`${row}.${col}.${digit}`) ?? false;
	if (mass) {
		if (mass.conflict.kind === "cell") {
			rules.add(1);
			clauses.push(`In ${cellRef(mass.conflict.row, mass.conflict.col)}, ${mass.conflict.digitA} and ${mass.conflict.digitB} are both ${colorNames[mass.conflict.color]}, so ${colorNames[mass.conflict.color]} is false and ${colorNames[mass.trueColor]} is true.`);
			medusaHighlightCells.push([mass.conflict.row, mass.conflict.col]);
		} else if (mass.conflict.kind === "unit") {
			rules.add(1);
			clauses.push(`${mass.conflict.digit} in ${cellRef(...mass.conflict.a)}, ${cellRef(...mass.conflict.b)} are both ${colorNames[mass.conflict.color]}, so ${colorNames[mass.conflict.color]} is false and ${colorNames[mass.trueColor]} is true.`);
			medusaHighlightCells.push(mass.conflict.a, mass.conflict.b);
		} else {
			rules.add(2);
			clauses.push(`${cellRef(mass.conflict.row, mass.conflict.col)} has no coloured candidates, but ${mass.conflict.digits.join(", ")} all see ${colorNames[mass.conflict.color]}, so ${colorNames[mass.conflict.color]} is false and ${colorNames[mass.trueColor]} is true.`);
			medusaHighlightCells.push([mass.conflict.row, mass.conflict.col]);
		}
		for (const c of mass.eliminatedCandidates) eliminate(c.row, c.col, c.digit);
		solvedCandidates.push(...mass.solvedCells.map((c) => ({
			row: c.row,
			col: c.col,
			digit: c.digit
		})));
	}
	for (const r3 of medusaFinder.findRule3Eliminations(chain, board, candidates)) {
		if (coveredByMassDeduction(r3.row, r3.col, r3.digit)) continue;
		rules.add(3);
		clauses.push(`${cellRef(r3.row, r3.col)} cannot be ${r3.digit} (it sees both colours: ${cellRef(...r3.blueSeen)}, ${cellRef(...r3.yellowSeen)}).`);
		eliminate(r3.row, r3.col, r3.digit);
		medusaHighlightCells.push([r3.row, r3.col]);
	}
	for (const r4 of medusaFinder.findRule4Eliminations(chain, candidates)) {
		if (r4.eliminatedDigits.every((digit) => coveredByMassDeduction(r4.row, r4.col, digit))) continue;
		rules.add(4);
		const sortedDigits = [...r4.eliminatedDigits].sort((a, b) => a - b);
		const value = sortedDigits.length === 1 ? `${sortedDigits[0]}` : `[${sortedDigits.join(",")}]`;
		clauses.push(`${cellRef(r4.row, r4.col)} is not ${value} (it holds both colours).`);
		usedCandidates.push(...r4.coloredCandidates.map((c) => ({
			row: c.row,
			col: c.col,
			digit: c.digit
		})));
		for (const digit of r4.eliminatedDigits) eliminate(r4.row, r4.col, digit);
		medusaHighlightCells.push([r4.row, r4.col]);
	}
	for (const r5 of medusaFinder.findRule5Eliminations(chain, candidates)) {
		if (coveredByMassDeduction(r5.row, r5.col, r5.eliminatedDigit)) continue;
		rules.add(5);
		const opponentColor = colorNames[r5.coloredColor === "blue" ? "yellow" : "blue"];
		clauses.push(`${cellRef(r5.row, r5.col)} is not ${r5.eliminatedDigit} (it sees opposite colour ${opponentColor} at ${cellRef(...r5.opponent)}).`);
		usedCandidates.push({
			row: r5.row,
			col: r5.col,
			digit: r5.coloredDigit
		});
		eliminate(r5.row, r5.col, r5.eliminatedDigit);
		medusaHighlightCells.push([r5.row, r5.col]);
	}
	if (rules.size === 0) return null;
	const ruleList = [...rules].sort((a, b) => a - b);
	return {
		instance: {
			id: `medusa-${chainKey}`,
			name: `3D Medusa ${ruleList.length === 1 ? "Rule" : "Rules"} ${ruleList.join(",")}`,
			notation: clauses.join(" "),
			usedCells: [],
			usedCandidates,
			eliminatedCandidates: [...eliminatedByKey.values()],
			solvedCandidates,
			blueCandidates,
			yellowCandidates,
			medusaHighlightCells,
			techniqueRank: 14
		},
		hasMassElimination: mass !== null
	};
}
/** Builds the live list of technique instances the current board/candidates
* support - recomputed from scratch whenever either changes, so it always
* reflects exactly what's happening on the grid right now.
* When a new technique is added to the app, add its instances here too, so
* the Techniques panel stays a complete list of everything implemented. */
/** Every candidate a 3D Medusa mass elimination (rules 1-2) removes once
* it's applied, as "row.col.digit" keys: the false colour's candidates, plus
* what placing each true-colour digit knocks out - the other candidates in
* its cell and that digit in every peer. The finder only reports the first
* part; the second is what lets the Techniques panel drop rule 3-5
* findings from the same chain that the placements already make redundant. */
function medusaMassCoverage(mass, candidates) {
	const covered = new Set(mass.eliminatedCandidates.map((c) => `${c.row}.${c.col}.${c.digit}`));
	for (const placed of mass.solvedCells) for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
		const sameCell = row === placed.row && col === placed.col;
		const peer = !sameCell && (row === placed.row || col === placed.col || Math.floor(row / 3) === Math.floor(placed.row / 3) && Math.floor(col / 3) === Math.floor(placed.col / 3));
		for (let digit = 1; digit <= 9; digit++) if (candidates[row][col][digit - 1] && (sameCell && digit !== placed.digit || peer && digit === placed.digit)) covered.add(`${row}.${col}.${digit}`);
	}
	return covered;
}
function buildTechniqueInstances(board, candidates, minBaseMedusaCandidates = 0, allowedRule3Techniques = new Set(DEFAULT_RULE3_TECHNIQUES), shortAicEnabled = true, shortSingleDigitAicEnabled = true, aicLimitPerDragonStep = true, exhaustiveDragon = true, genericAicEnabled = false, optimizeDragons = false, optimizeDynamicDragons = false, dynamicDragonEnabled = true, enabledFish = /* @__PURE__ */ new Set(), alsXzEnabled = false, maxTechniquesPerDragonStep = Infinity, doubleDragonEnabled = false, doubleDynamicDragonEnabled = false, givens = null) {
	const instances = [];
	for (const { row, col, digit } of singleFinder.findNakedSingles(board, candidates)) instances.push({
		id: `naked-single-${row}-${col}`,
		name: "Naked Single",
		notation: `${cellRef(row, col)} is ${digit}`,
		usedCells: [[row, col]],
		usedCandidates: [],
		eliminatedCandidates: [],
		solvedCandidates: [{
			row,
			col,
			digit
		}],
		techniqueRank: 0
	});
	const seenHiddenSingles = /* @__PURE__ */ new Set();
	for (const { row, col, digit } of singleFinder.findHiddenSingles(board, candidates)) {
		const key = `${row},${col},${digit}`;
		if (seenHiddenSingles.has(key)) continue;
		seenHiddenSingles.add(key);
		instances.push({
			id: `hidden-single-${row}-${col}-${digit}`,
			name: "Hidden Single",
			notation: `${cellRef(row, col)} is ${digit}`,
			usedCells: [[row, col]],
			usedCandidates: [],
			eliminatedCandidates: [],
			solvedCandidates: [{
				row,
				col,
				digit
			}],
			techniqueRank: 0
		});
	}
	for (const locked of lockedCandidateFinder.findInstances(board, candidates)) {
		const typeLabel = locked.type === "pointing" ? "Pointing" : "Claiming";
		const cellsLabel = [...locked.eliminations].sort((a, b) => a.row - b.row || a.col - b.col).map((e) => cellRef(e.row, e.col)).join(", ");
		instances.push({
			id: `locked-candidate-${locked.type}-${locked.digit}-${locked.basisCells.map(([row, col]) => `${row}.${col}`).join("-")}`,
			name: `Locked Candidate (${typeLabel})`,
			notation: `Locked Candidate (${typeLabel}) - ${cellsLabel} cannot be a ${locked.digit}.`,
			usedCells: locked.basisCells,
			usedCandidates: locked.basisCells.map(([row, col]) => ({
				row,
				col,
				digit: locked.digit
			})),
			eliminatedCandidates: locked.eliminations,
			solvedCandidates: [],
			techniqueRank: 1
		});
	}
	for (const pair of pairFinder.findNakedPairs(board, candidates)) {
		const [[rowA, colA], [rowB, colB]] = pair.cells;
		const [digitA, digitB] = pair.digits;
		const byCell = /* @__PURE__ */ new Map();
		for (const elimination of pair.eliminations) {
			const key = `${elimination.row},${elimination.col}`;
			const entry = byCell.get(key) ?? {
				row: elimination.row,
				col: elimination.col,
				digits: []
			};
			entry.digits.push(elimination.digit);
			byCell.set(key, entry);
		}
		const results = Array.from(byCell.values()).sort((a, b) => a.row - b.row || a.col - b.col).map(({ row, col, digits }) => {
			const sorted = [...digits].sort((a, b) => a - b);
			const value = sorted.length === 1 ? `${sorted[0]}` : `[${sorted.join(",")}]`;
			return `${cellRef(row, col)} is not ${value}`;
		});
		instances.push({
			id: `naked-pair-${rowA}-${colA}-${rowB}-${colB}`,
			name: "Naked Pair",
			notation: `${cellRef(rowA, colA)}, ${cellRef(rowB, colB)} => ${results.join(", ")}`,
			usedCells: [[rowA, colA], [rowB, colB]],
			usedCandidates: [
				{
					row: rowA,
					col: colA,
					digit: digitA
				},
				{
					row: rowA,
					col: colA,
					digit: digitB
				},
				{
					row: rowB,
					col: colB,
					digit: digitA
				},
				{
					row: rowB,
					col: colB,
					digit: digitB
				}
			],
			eliminatedCandidates: pair.eliminations,
			solvedCandidates: [],
			techniqueRank: 2
		});
	}
	for (const size of [3, 4]) {
		const label = size === 3 ? "Naked Triple" : "Naked Quad";
		const idPrefix = size === 3 ? "naked-triple" : "naked-quad";
		const finderResults = size === 3 ? nakedSubsetFinder.findNakedTriples(board, candidates) : nakedSubsetFinder.findNakedQuads(board, candidates);
		for (const subset of finderResults) {
			const byCell = /* @__PURE__ */ new Map();
			for (const elimination of subset.eliminations) {
				const key = `${elimination.row},${elimination.col}`;
				const entry = byCell.get(key) ?? {
					row: elimination.row,
					col: elimination.col,
					digits: []
				};
				entry.digits.push(elimination.digit);
				byCell.set(key, entry);
			}
			const results = Array.from(byCell.values()).sort((a, b) => a.row - b.row || a.col - b.col).map(({ row, col, digits }) => {
				const sorted = [...digits].sort((a, b) => a - b);
				const value = sorted.length === 1 ? `${sorted[0]}` : `[${sorted.join(",")}]`;
				return `${cellRef(row, col)} is not ${value}`;
			});
			const cellsLabel = subset.cells.map(([row, col]) => cellRef(row, col)).join(", ");
			instances.push({
				id: `${idPrefix}-${subset.cells.map(([row, col]) => `${row}.${col}`).join("-")}`,
				name: label,
				notation: `${cellsLabel} => ${results.join(", ")}`,
				usedCells: subset.cells,
				usedCandidates: subset.cells.flatMap(([row, col]) => subset.digits.filter((digit) => candidates[row][col][digit - 1]).map((digit) => ({
					row,
					col,
					digit
				}))),
				eliminatedCandidates: subset.eliminations,
				solvedCandidates: [],
				techniqueRank: 2
			});
		}
	}
	for (const pair of hiddenPairFinder.findHiddenPairs(board, candidates)) {
		const [[rowA, colA], [rowB, colB]] = pair.cells;
		const [digitA, digitB] = pair.digits;
		const byCell = /* @__PURE__ */ new Map();
		for (const elimination of pair.eliminations) {
			const key = `${elimination.row},${elimination.col}`;
			const entry = byCell.get(key) ?? {
				row: elimination.row,
				col: elimination.col,
				digits: []
			};
			entry.digits.push(elimination.digit);
			byCell.set(key, entry);
		}
		const results = Array.from(byCell.values()).sort((a, b) => a.row - b.row || a.col - b.col).map(({ row, col, digits }) => {
			const sorted = [...digits].sort((a, b) => a - b);
			const value = sorted.length === 1 ? `${sorted[0]}` : `[${sorted.join(",")}]`;
			return `${cellRef(row, col)} is not ${value}`;
		});
		instances.push({
			id: `hidden-pair-${rowA}-${colA}-${rowB}-${colB}-${digitA}-${digitB}`,
			name: "Hidden Pair",
			notation: `${cellRef(rowA, colA)}, ${cellRef(rowB, colB)} hide ${digitA},${digitB} => ${results.join(", ")}`,
			usedCells: [[rowA, colA], [rowB, colB]],
			usedCandidates: [
				{
					row: rowA,
					col: colA,
					digit: digitA
				},
				{
					row: rowA,
					col: colA,
					digit: digitB
				},
				{
					row: rowB,
					col: colB,
					digit: digitA
				},
				{
					row: rowB,
					col: colB,
					digit: digitB
				}
			],
			eliminatedCandidates: pair.eliminations,
			solvedCandidates: [],
			techniqueRank: 2
		});
	}
	for (const ur of uniqueRectangleFinder.find(board, candidates)) {
		const explanation = explainUniqueRectangle(ur, candidates);
		const idSuffix = ur.cells.map(([row, col]) => `${row}.${col}`).join("-");
		instances.push({
			id: `ur-${ur.type.replace(/\s+/g, "").toLowerCase()}-${idSuffix}-${ur.urDigits.join(",")}`,
			name: `Unique Rectangle (${explanation.typeLabel === "Type 7d" ? "Type 7d, Hidden Rectangle" : explanation.typeLabel})`,
			notation: explanation.text,
			usedCells: [...ur.cells, ...ur.subsetCells ?? []],
			usedCandidates: [...ur.cells.flatMap(([row, col]) => ur.urDigits.map((digit) => ({
				row,
				col,
				digit
			}))), ...(ur.subsetCells ?? []).flatMap(([row, col]) => markedCandidateDigits(candidates[row][col]).map((digit) => ({
				row,
				col,
				digit
			})))],
			eliminatedCandidates: ur.eliminatedCandidates,
			solvedCandidates: ur.solvedCandidates,
			medusaHighlightCells: [...ur.reasonCells],
			techniqueRank: 3
		});
	}
	const bugPlusOne = bugPlusOneFinder.find(board, candidates);
	if (bugPlusOne) {
		const [row, col] = bugPlusOne.cell;
		const candidatesLabel = bugPlusOne.candidates.join(",");
		instances.push({
			id: `bug-plus-one-${row}.${col}`,
			name: "BUG+1",
			notation: `${cellRef(row, col)} (candidates ${candidatesLabel}) is the only cell with more than two candidates; ${bugPlusOne.solvedDigit} appears 3 times in its ${bugPlusOne.unitKind}, so ${cellRef(row, col)} is ${bugPlusOne.solvedDigit}`,
			usedCells: [...bugPlusOne.unit],
			usedCandidates: bugPlusOne.unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][bugPlusOne.solvedDigit - 1]).map(([r, c]) => ({
				row: r,
				col: c,
				digit: bugPlusOne.solvedDigit
			})),
			eliminatedCandidates: [],
			solvedCandidates: [{
				row,
				col,
				digit: bugPlusOne.solvedDigit
			}],
			techniqueRank: 4
		});
	}
	const avoidableRectangleEffects = /* @__PURE__ */ new Set();
	for (const ar of avoidableRectangleFinder.find(board, candidates, givens)) {
		const effectKey = ar.eliminations.map((e) => `${e.row},${e.col},${e.digit}`).join(";");
		if (avoidableRectangleEffects.has(effectKey)) continue;
		avoidableRectangleEffects.add(effectKey);
		const unsolvedCells = ar.cells.filter(([r, c]) => board[r][c] === 0);
		instances.push({
			id: `avoidable-rectangle-${ar.type}-${ar.cells.map(([r, c]) => `${r}.${c}`).join("-")}-${effectKey}`,
			name: `Avoidable Rectangle (Type ${ar.type})`,
			notation: `Avoidable Rectangle Type ${ar.type} of {${ar.digits.join(",")}} at ${ar.cells.map(([r, c]) => cellRef(r, c)).join(", ")}, ${ar.reasonText}, thus ${ar.eliminations.map((e) => `${cellRef(e.row, e.col)} cannot be ${e.digit}`).join(", ")}`,
			usedCells: [...ar.cells],
			usedCandidates: ar.type === 2 ? unsolvedCells.flatMap(([r, c]) => markedCandidateDigits(candidates[r][c]).map((digit) => ({
				row: r,
				col: c,
				digit
			}))) : [],
			eliminatedCandidates: ar.eliminations,
			solvedCandidates: [],
			techniqueRank: 5
		});
	}
	for (const oddagon of bivalueOddagonFinder.find(board, candidates)) {
		const [a, b] = oddagon.loopDigits;
		const cellsLabel = oddagon.cells.map(([row, col]) => cellRef(row, col)).join(", ");
		const guardianCellsLabel = oddagon.guardianCells.map(([row, col]) => cellRef(row, col)).join(", ");
		const guardianKeys = new Set(oddagon.guardianCells.map(([row, col]) => `${row},${col}`));
		const usedCandidates = oddagon.cells.flatMap(([row, col]) => {
			return (guardianKeys.has(`${row},${col}`) ? [
				a,
				b,
				oddagon.guardianDigit
			] : [a, b]).map((digit) => ({
				row,
				col,
				digit
			}));
		});
		const idSuffix = oddagon.cells.map(([row, col]) => `${row}.${col}`).join("-");
		if (oddagon.type === 1) {
			const [row, col] = oddagon.solvedCell;
			instances.push({
				id: `bivalue-oddagon-1-${idSuffix}`,
				name: "Bivalue Oddagon (Type 1)",
				notation: `${oddagon.cells.length}-cell bivalue oddagon of {${a},${b}} at ${cellsLabel} => ${cellRef(row, col)} is ${oddagon.guardianDigit}`,
				usedCells: oddagon.cells,
				usedCandidates,
				eliminatedCandidates: [],
				solvedCandidates: [{
					row,
					col,
					digit: oddagon.guardianDigit
				}],
				techniqueRank: 6
			});
		} else {
			const eliminationText = oddagon.eliminations.map((e) => `${cellRef(e.row, e.col)} cannot be ${e.digit}`).join(", ");
			instances.push({
				id: `bivalue-oddagon-2-${idSuffix}`,
				name: "Bivalue Oddagon (Type 2)",
				notation: `${oddagon.cells.length}-cell bivalue oddagon of {${a},${b}} at ${cellsLabel}, guardians ${guardianCellsLabel} holding ${oddagon.guardianDigit} => ${eliminationText}`,
				usedCells: oddagon.cells,
				usedCandidates,
				eliminatedCandidates: oddagon.eliminations,
				solvedCandidates: [],
				techniqueRank: 6
			});
		}
	}
	const rule1Instances = [];
	const rule2Instances = [];
	for (const digit of DIGITS) for (const chain of colorFinder.findChains(board, candidates, digit)) {
		const chainKey = chain.cells.map((c) => `${c.row}.${c.col}.${c.color[0]}`).sort().join("-");
		const usedCells = chain.cells.map((c) => [c.row, c.col]);
		const blueCandidates = chain.cells.filter((c) => c.color === "blue").map((c) => ({
			row: c.row,
			col: c.col,
			digit
		}));
		const yellowCandidates = chain.cells.filter((c) => c.color === "yellow").map((c) => ({
			row: c.row,
			col: c.col,
			digit
		}));
		const rule1 = colorFinder.findRule1(chain);
		if (rule1) {
			const sortedSolved = [...rule1.solvedCells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
			rule1Instances.push({
				id: `simple-color-rule1-${digit}-${chainKey}`,
				name: `Simple Colouring Rule 1 (${digit})`,
				notation: `Light ${rule1.falseColor} is false, so light ${rule1.trueColor} is true: ${sortedSolved.map(([row, col]) => cellRef(row, col)).join(", ")} ${sortedSolved.length === 1 ? "is" : "are"} ${digit}.`,
				usedCells,
				usedCandidates: [],
				eliminatedCandidates: [],
				solvedCandidates: sortedSolved.map(([row, col]) => ({
					row,
					col,
					digit
				})),
				blueCandidates,
				yellowCandidates,
				techniqueRank: 7
			});
		}
		const rule2 = colorFinder.findRule2(chain, board, candidates);
		if (rule2) {
			const sortedEliminated = [...rule2.eliminatedCells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
			rule2Instances.push({
				id: `simple-color-rule2-${digit}-${chainKey}`,
				name: `Simple Colouring Rule 2 (${digit})`,
				notation: `${sortedEliminated.map(([row, col]) => cellRef(row, col)).join(", ")} cannot be ${digit}.`,
				usedCells,
				usedCandidates: [],
				eliminatedCandidates: rule2.eliminatedCells.map(([row, col]) => ({
					row,
					col,
					digit
				})),
				solvedCandidates: [],
				blueCandidates,
				yellowCandidates,
				techniqueRank: 7
			});
		}
	}
	instances.push(...rule1Instances, ...rule2Instances);
	const middleTier = [];
	if (enabledFish.size > 0) {
		for (const fish of fishFinder.find(board, candidates)) if (enabledFish.has(fish.technique)) middleTier.push(buildFishInstance(fish));
	}
	if (shortAicEnabled || shortSingleDigitAicEnabled) for (const aic of shortAicFinder.findShortAics(board, candidates)) {
		const isSingleDigit = classifyShortAic(aic) === "single-digit";
		if (isSingleDigit ? !shortSingleDigitAicEnabled : !shortAicEnabled) continue;
		middleTier.push(buildAicInstance(aic, isSingleDigit ? "short-single-digit-aic" : "short-aic", isSingleDigit ? aic.pattern ?? "Short Single-Digit AIC" : `Short AIC (Type ${aic.eliminationType})`));
	}
	middleTier.sort((a, b) => a.techniqueRank - b.techniqueRank);
	pushUnlessCoveredByEasier(instances, middleTier);
	const massMedusaInstances = [];
	const otherMedusaInstances = [];
	for (const chain of medusaFinder.findChains(board, candidates)) {
		const built = buildMedusaChainInstance(chain, board, candidates);
		if (built) (built.hasMassElimination ? massMedusaInstances : otherMedusaInstances).push(built.instance);
	}
	instances.push(...massMedusaInstances, ...otherMedusaInstances);
	if (genericAicEnabled) pushUnlessCoveredByEasier(instances, genericAicFinder.findGenericAics(board, candidates).map((aic) => buildAicInstance(aic, "generic-aic", `Generic AIC (Type ${aic.eliminationType}; ${aic.length} links)`)));
	if (alsXzEnabled) pushUnlessCoveredByEasier(instances, alsXzFinder.find(board, candidates).map(buildAlsXzInstance));
	const dragonExtensions = computeStuckDragonExtensions(board, candidates, "any", minBaseMedusaCandidates, exhaustiveDragon, optimizeDragons);
	dragonExtensions.sort((a, b) => a.moves.length - b.moves.length);
	for (const { chainKey, moves } of dragonExtensions) instances.push(buildDragonInstance(board, candidates, "dragon", "Dragon Colouring", chainKey, moves));
	if (doubleDragonEnabled) {
		const doubleDragonExtensions = computeDoubleDragonExtensions(board, candidates, minBaseMedusaCandidates, exhaustiveDragon, optimizeDragons);
		doubleDragonExtensions.sort((a, b) => a.moves.length - b.moves.length);
		for (const { chainKey, moves } of doubleDragonExtensions) instances.push(buildDragonInstance(board, candidates, "double-dragon", "Double Dragon Colouring", chainKey, moves));
	}
	const dynamicDragonExtensions = !dynamicDragonEnabled ? [] : computeStuckDynamicDragonExtensions(board, candidates, "any", minBaseMedusaCandidates, allowedRule3Techniques, aicLimitPerDragonStep, exhaustiveDragon, optimizeDragons, optimizeDynamicDragons, maxTechniquesPerDragonStep, givens);
	dynamicDragonExtensions.sort((a, b) => a.moves.length - b.moves.length);
	for (const { chainKey, moves } of dynamicDragonExtensions) instances.push(buildDragonInstance(board, candidates, "dynamic-dragon", dynamicDragonLabel(moves), chainKey, moves));
	if (dynamicDragonEnabled && doubleDynamicDragonEnabled) {
		const doubleDynamicExtensions = computeDoubleDynamicDragonExtensions(board, candidates, minBaseMedusaCandidates, allowedRule3Techniques, aicLimitPerDragonStep, maxTechniquesPerDragonStep, exhaustiveDragon, optimizeDragons, optimizeDynamicDragons, doubleDragonEnabled, givens);
		doubleDynamicExtensions.sort((a, b) => a.moves.length - b.moves.length);
		for (const { chainKey, moves } of doubleDynamicExtensions) instances.push(buildDragonInstance(board, candidates, "double-dynamic-dragon", `Double ${dynamicDragonLabel(moves)}`, chainKey, moves));
	}
	return instances;
}
/** Appends `candidates` (sorted by techniqueRank) to `instances`, except any
* whose eliminations rows of a strictly lower rank - everything already in
* `instances`, plus lower tiers of `candidates` itself - already make in
* full. Only elimination-only rows can be hidden this way; one that solves a
* cell is always kept. */
function pushUnlessCoveredByEasier(instances, candidates) {
	const keyOf = (e) => `${e.row},${e.col},${e.digit}`;
	const covered = new Set(instances.flatMap((instance) => instance.eliminatedCandidates.map(keyOf)));
	let tierRank = -1;
	let tierKeys = [];
	for (const candidate of candidates) {
		if (candidate.techniqueRank !== tierRank) {
			tierKeys.forEach((key) => covered.add(key));
			tierKeys = [];
			tierRank = candidate.techniqueRank;
		}
		if (candidate.solvedCandidates.length === 0 && candidate.eliminatedCandidates.every((e) => covered.has(keyOf(e)))) continue;
		instances.push(candidate);
		tierKeys.push(...candidate.eliminatedCandidates.map(keyOf));
	}
}
/** A Techniques-panel row for one fish. */
function buildFishInstance(fish) {
	const eliminatedLabel = fish.eliminations.map((e) => cellRef(e.row, e.col)).join(", ");
	return {
		id: `fish-${fish.technique.replace(/s+/g, "-")}-${fish.digit}-${fish.lineKind}-${fish.lines.join("")}-${fish.crossLines.join("")}`,
		name: FISH_TECHNIQUE_NAMES[fish.technique],
		notation: `${fish.reasonText}, thus ${eliminatedLabel} cannot be ${fish.digit}`,
		usedCells: [...fish.cells],
		usedCandidates: fish.cells.map(([row, col]) => ({
			row,
			col,
			digit: fish.digit
		})),
		eliminatedCandidates: fish.eliminations,
		solvedCandidates: [],
		medusaHighlightCells: fish.fins.length > 0 ? [...fish.fins] : void 0,
		techniqueRank: FISH_RANKS[fish.technique]
	};
}
/** A Techniques-panel row for one ALS-xz. Both ALS' cells are outlined as the
* basis, ALS B's also get the distinct border (so an overlap cell has both);
* the RCC's candidates are blue and the Z digits' yellow. */
function buildAlsXzInstance(als) {
	const alsCells = [...als.alsA.cells, ...als.alsB.cells];
	const candidatesOf = (digits) => alsCells.flatMap(([row, col]) => digits.map((digit) => ({
		row,
		col,
		digit
	})));
	const eliminationText = als.zDigits.map((z) => {
		return `${als.eliminations.filter((e) => e.digit === z).map((e) => cellRef(e.row, e.col)).join(", ")} cannot be ${z}`;
	}).join(", ");
	const cellsKey = (cells) => cells.map(([row, col]) => `${row}${col}`).join(".");
	return {
		id: `als-xz-${cellsKey(als.alsA.cells)}-${cellsKey(als.alsB.cells)}-${als.rcc}`,
		name: "ALS-xz",
		notation: `${als.reasonText}, thus ${eliminationText}.`,
		usedCells: alsCells,
		usedCandidates: [],
		eliminatedCandidates: als.eliminations,
		solvedCandidates: [],
		blueCandidates: candidatesOf([als.rcc]),
		yellowCandidates: candidatesOf(als.zDigits),
		medusaHighlightCells: [...als.alsB.cells],
		techniqueRank: 16
	};
}
function buildDragonInstance(board, candidates, idPrefix, name, chainKey, moves) {
	const lastMove = moves[moves.length - 1];
	const provenTrueLabel = lastMove.provenTrueColor ? dragonColourLabel(lastMove.provenTrueColor, lastMove.secondDragon) : "";
	const summaryText = lastMove.kind === "mass-elimination" && lastMove.provenTrueColor ? (() => {
		const fact = `${provenTrueLabel} is true`;
		const eliminatedCount = countEffectiveEliminations(board, candidates, foldDragonMoves(moves, moves.length - 1));
		return eliminatedCount > 0 ? `${fact}; eliminates ${eliminatedCount} candidate${eliminatedCount === 1 ? "" : "s"}` : fact;
	})() : lastMove.kind === "solution" && lastMove.provenTrueColor ? `${provenTrueLabel} covers every empty cell, solving the puzzle` : (() => {
		const eliminated = moves.flatMap((m) => m.eliminated);
		const solvedCount = moves.reduce((n, m) => n + m.solved.length, 0);
		const summary = [];
		if (solvedCount > 0) summary.push(`solves ${solvedCount} cell${solvedCount === 1 ? "" : "s"}`);
		if (eliminated.length === 1) summary.push(`eliminates ${eliminated[0].digit}${cellRef(eliminated[0].row, eliminated[0].col)}`);
		else if (eliminated.length > 1) summary.push(`eliminates ${eliminated.length} candidates`);
		return summary.join(", ");
	})();
	return {
		id: `${idPrefix}-${chainKey}`,
		name,
		notation: `${moves.length} steps - ${summaryText}.`,
		usedCells: [],
		usedCandidates: [],
		eliminatedCandidates: moves.flatMap((m) => m.eliminated),
		solvedCandidates: moves.flatMap((m) => m.solved),
		moves,
		techniqueRank: idPrefix === "dragon" ? 17 : idPrefix === "double-dragon" ? 18 : idPrefix === "double-dynamic-dragon" ? 20 : 19
	};
}
/** "Dynamic Dragon Colouring (naked pair, UR)" - named after whichever
* non-colouring technique(s) its Extension Rule 3 steps actually leaned on,
* so "Dynamic Dragon Colouring" alone never has to be taken on faith. Fixed
* order regardless of which happened to fire first. */
function dynamicDragonLabel(moves) {
	const techniquesUsed = new Set(moves.flatMap((m) => m.dynamicTechniques ?? []));
	const orderedTechniques = [
		"locked candidate",
		"naked pair",
		"naked triple",
		"naked quad",
		"hidden pair",
		"UR",
		"BUG+1",
		"avoidable rectangle",
		"bivalue oddagon",
		"x-wing",
		"short single-digit aic",
		"finned x-wing",
		"short aic",
		"swordfish",
		"finned swordfish",
		"generic aic",
		"als-xz"
	].filter((t) => techniquesUsed.has(t));
	const singleDigitLabels = [...new Set(moves.flatMap((m) => (m.substeps ?? []).filter((s) => s.technique === "short single-digit aic").map((s) => s.aic?.pattern?.toLowerCase() ?? "short single-digit aic")))];
	const labels = orderedTechniques.flatMap((t) => t === "short single-digit aic" && singleDigitLabels.length > 0 ? singleDigitLabels : [t]);
	return labels.length > 0 ? `Dynamic Dragon Colouring (${labels.join(", ")})` : "Dynamic Dragon Colouring";
}
/** The full effect of a technique instance, including - for a Dragon
* Colouring or Dynamic Dragon Colouring instance - its entire move chain
* folded to the end, not just whichever step a user happens to be
* viewing. Used by the Solve Path search and by jumping straight to a
* solve-path step, where a Dragon instance always counts as one complete
* step regardless of how many internal moves it took. */
function fullTechniqueEffect(instance) {
	if (instance.moves && instance.moves.length > 0) {
		const fold = foldDragonMoves(instance.moves, instance.moves.length - 1);
		return {
			eliminatedCandidates: fold.eliminatedCandidates,
			solvedCandidates: fold.solvedCandidates
		};
	}
	return {
		eliminatedCandidates: instance.eliminatedCandidates,
		solvedCandidates: instance.solvedCandidates
	};
}
/** How many pencil marks a technique's full effect removes from the grid:
* every candidate that is marked before and gone after applying it,
* counting peers wiped by a solve and the other digits of a solved cell,
* but not the solved digit itself (that mark becomes the cell's value, it
* isn't eliminated). Each mark counts once however many times the effect
* lists it. */
function countEffectiveEliminations(board, candidates, effect) {
	return listEffectiveEliminations(board, candidates, effect).length;
}
/** How many Dragon Colouring steps an instance takes to apply - 0 for every
* non-Dragon technique, so comparing this between two instances is a no-op
* unless both are Dragon/Dynamic Dragon. */
function dragonStepCount(instance) {
	return instance.moves?.length ?? 0;
}
/** Solve Path search, "Easy Solve" setting: picks whichever applicable
* technique is simplest (lowest techniqueRank) right now, ignoring how much
* progress it makes - unlike the default (pickGreedyInstance), a Naked
* Single that only fills one cell is always preferred here over a Dragon
* Colouring chain that would solve half the grid, since a human working
* through the puzzle by hand would reach for the single first regardless of
* payoff. Ties - usually several instances of the exact same technique -
* are broken by fewest Dragon Colouring steps (a shorter chain is a simpler
* one; always a tie, at 0, between two non-Dragon instances) and then by
* most candidates eliminated, the only differentiator left once technique
* and chain length no longer distinguish two instances. */
function pickEasiestInstance(instances) {
	let best = null;
	let bestSteps = Infinity;
	let bestEliminated = -1;
	for (const instance of instances) {
		const rank = instance.techniqueRank;
		const steps = dragonStepCount(instance);
		if (!best || rank < best.techniqueRank || rank === best.techniqueRank && steps < bestSteps) {
			best = instance;
			bestSteps = steps;
			bestEliminated = fullTechniqueEffect(instance).eliminatedCandidates.length;
			continue;
		}
		if (rank === best.techniqueRank && steps === bestSteps) {
			const eliminated = fullTechniqueEffect(instance).eliminatedCandidates.length;
			if (eliminated > bestEliminated) {
				best = instance;
				bestSteps = steps;
				bestEliminated = eliminated;
			}
		}
	}
	return best;
}
//#endregion
//#region dragon-research/avoidable-rectangle/type2-lessons.ts
const max = Number(process.argv[2] ?? 5);
const parse = (line) => Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(line[r * 9 + c]) || 0));
const autofill = (board) => board.map((row, r) => row.map((v, c) => Array.from({ length: 9 }, (_, d) => v === 0 && SudokuRules.isSafe(board, r, c, d + 1))));
const lines = ["top1465.txt", "all-hard.txt"].flatMap((f) => fs.readFileSync(`dragon-research/data/${f}`, "utf8").trim().split(/\s+/).filter((l) => l.length === 81));
let found = 0;
for (const line of lines) {
	if (found >= max) break;
	const puzzle = parse(line);
	const givens = puzzle.map((row) => row.map((v) => v !== 0));
	const board = puzzle.map((row) => [...row]);
	const cands = autofill(board);
	for (let step = 0; step < 250 && found < max; step++) {
		const instances = buildTechniqueInstances(board, cands, 0, void 0, true, true, true, false, false, false, false, false, void 0, false, Infinity, false, false, givens);
		if (instances.length === 0) break;
		const type2 = avoidableRectangleFinder.find(board, cands, givens).filter((ar) => ar.type === 2);
		const minOther = Math.min(...instances.filter((i) => !i.id.startsWith("avoidable-rectangle-")).map((i) => i.techniqueRank));
		if (type2.length > 0 && minOther > 5) {
			const fresh = autofill(board);
			const removed = [];
			for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) for (let d = 0; d < 9; d++) if (fresh[r][c][d] && !cands[r][c][d]) removed.push(`r${r + 1}c${c + 1}-${d + 1}`);
			for (const ar of type2) console.log(JSON.stringify({
				position: board.flat().join(""),
				clues: line,
				removed: removed.join(" "),
				removedCount: removed.length,
				cells: ar.cells.map(([r, c]) => `r${r + 1}c${c + 1}`).join(" "),
				eliminations: ar.eliminations.map((e) => `${e.digit}r${e.row + 1}c${e.col + 1}`).join(" "),
				reason: ar.reasonText
			}));
			found++;
			break;
		}
		const effect = fullTechniqueEffect(pickEasiestInstance(instances));
		for (const e of effect.eliminatedCandidates) cands[e.row][e.col][e.digit - 1] = false;
		for (const s of effect.solvedCandidates) {
			if (board[s.row][s.col] !== 0) continue;
			board[s.row][s.col] = s.digit;
			cands[s.row][s.col] = Array(9).fill(false);
			SudokuRules.eliminatePeerCandidates(cands, board, s.row, s.col, s.digit);
		}
	}
}
//#endregion
export {};
