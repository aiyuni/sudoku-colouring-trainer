//#region src/sudoku/types.ts
const SAMPLE_PUZZLE = [
	[
		5,
		3,
		0,
		0,
		7,
		0,
		0,
		0,
		0
	],
	[
		6,
		0,
		0,
		1,
		9,
		5,
		0,
		0,
		0
	],
	[
		0,
		9,
		8,
		0,
		0,
		0,
		0,
		6,
		0
	],
	[
		8,
		0,
		0,
		0,
		6,
		0,
		0,
		0,
		3
	],
	[
		4,
		0,
		0,
		8,
		0,
		3,
		0,
		0,
		1
	],
	[
		7,
		0,
		0,
		0,
		2,
		0,
		0,
		0,
		6
	],
	[
		0,
		6,
		0,
		0,
		0,
		0,
		2,
		8,
		0
	],
	[
		0,
		0,
		0,
		4,
		1,
		9,
		0,
		0,
		5
	],
	[
		0,
		0,
		0,
		0,
		8,
		0,
		0,
		7,
		9
	]
];
//#endregion
//#region src/sudoku/boardUtils.ts
const SIZE = 9;
function cloneBoard(board) {
	return board.map((row) => [...row]);
}
function createEmptyCandidates() {
	return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => Array(SIZE).fill(false)));
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
//#endregion
//#region src/sudoku/SudokuAvoidableRectangleFinder.ts
const boxOf$3 = (row, col) => Math.floor(row / 3) * 3 + Math.floor(col / 3);
const cellRef$3 = ([row, col]) => `r${row + 1}c${col + 1}`;
const sees$2 = (a, b) => a[0] === b[0] || a[1] === b[1] || boxOf$3(a[0], a[1]) === boxOf$3(b[0], b[1]);
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
				boxOf$3(r1, c1),
				boxOf$3(r1, c2),
				boxOf$3(r2, c1),
				boxOf$3(r2, c2)
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
			if (sees$2(cell, a) && sees$2(cell, b)) eliminations.push({
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
//#region src/sudoku/SudokuBugPlusNFinder.ts
/** Which kind of unit a set of cells belongs to - used to say "row",
* "column", or "box" instead of the vaguer "section". */
function classifyUnitKind$1(cells) {
	if (cells.every(([r]) => r === cells[0][0])) return "row";
	if (cells.every(([, c]) => c === cells[0][1])) return "column";
	return "box";
}
function sees$1(a, b) {
	return a[0] === b[0] || a[1] === b[1] || Math.floor(a[0] / 3) === Math.floor(b[0] / 3) && Math.floor(a[1] / 3) === Math.floor(b[1] / 3);
}
/** Beyond BUG+3 the pattern is too far from all-bivalue to be worth naming
* (and 3^N combinations to try) - the user asked for 1, 2 and 3. */
const MAX_N = 3;
/**
* BUG+N (Bivalue Universal Grave + N): a grid where every unsolved cell is
* bivalue except N cells (N = 1..3) holding three candidates each.
*
* A "BUG" is a deadly pattern: every unsolved cell bivalue and every digit
* left in a row, column or box appearing there exactly twice. Such a grid
* always has an even number of solutions (0 or 2+), so a uniquely solvable
* puzzle can never be in one. Each tri-value cell has one extra ("BUG")
* digit - the one that, removed, leaves its units pairing up again. If
* removing the N BUG candidates leaves a true BUG, at least one of them must
* be true, or the puzzle would have that BUG's second solution.
*
* - BUG+1: the one BUG candidate is true - the cell's solution. It's the
*   candidate appearing three times in the cell's units. The original BUG+1
*   finder stopped at that count without checking the rest of the grid
*   really pairs up, which gave wrong placements whenever a hidden single
*   was still on the grid (a digit once in a unit is no BUG); the full check
*   below is what makes it sound, and gives the same answer everywhere the
*   old count was right.
* - BUG+2/BUG+3: one of the N BUG candidates is true, so any candidate that
*   can't be true alongside each of them goes - in practice the shared BUG
*   digit in every cell that sees all N tri-value cells (the user's example:
*   2 in r2c2 {1,2,8} and r8c9 {1,2,6}, so r8c2, which sees both, isn't 2).
*   A digit the tri-value cells merely share is NOT enough: 1 is in both of
*   those cells too, but it isn't a BUG candidate, and a cell seeing both
*   can still be 1.
*
* The BUG digits are found by trying every choice of one digit
* per tri-value cell (at most 3^3 = 27) and keeping one whose removal
* leaves every unit with each unplaced digit exactly twice - counting per
* unit alone can mislead when two tri-value cells share a unit.
*/
var SudokuBugPlusNFinder = class {
	find(board, candidates) {
		const triValue = [];
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0) continue;
			const digits = markedCandidateDigits(candidates[row][col]);
			if (digits.length === 2) continue;
			if (digits.length !== 3 || triValue.length === MAX_N) return null;
			triValue.push({
				cell: [row, col],
				digits
			});
		}
		if (triValue.length === 0) return null;
		return this.findVerified(board, candidates, triValue);
	}
	findVerified(board, candidates, triValue) {
		const units = sudokuUnits();
		const placed = units.map((unit) => {
			const set = /* @__PURE__ */ new Set();
			for (const [r, c] of unit) if (board[r][c] !== 0) set.add(board[r][c]);
			return set;
		});
		const counts = units.map((unit) => {
			const perDigit = new Array(10).fill(0);
			for (const [r, c] of unit) {
				if (board[r][c] !== 0) continue;
				for (let d = 1; d <= 9; d++) if (candidates[r][c][d - 1]) perDigit[d]++;
			}
			return perDigit;
		});
		const triInUnit = units.map((unit) => triValue.flatMap((t, i) => unit.some(([r, c]) => r === t.cell[0] && c === t.cell[1]) ? [i] : []));
		const isBugWithout = (choice) => {
			for (let u = 0; u < units.length; u++) for (let d = 1; d <= 9; d++) {
				let count = counts[u][d];
				for (const i of triInUnit[u]) if (choice[i] === d) count--;
				if (count !== (placed[u].has(d) ? 0 : 2)) return false;
			}
			return true;
		};
		const n = triValue.length;
		const total = 3 ** n;
		for (let code = 0; code < total; code++) {
			const choice = triValue.map((t, i) => t.digits[Math.floor(code / 3 ** i) % 3]);
			if (!isBugWithout(choice)) continue;
			const bugCandidates = triValue.map((t, i) => ({
				cell: t.cell,
				digit: choice[i]
			}));
			const solved = n === 1 ? {
				row: triValue[0].cell[0],
				col: triValue[0].cell[1],
				digit: choice[0]
			} : null;
			const eliminations = n === 1 ? [] : this.eliminationsFor(board, candidates, bugCandidates);
			if (!solved && eliminations.length === 0) continue;
			return {
				n,
				cells: triValue.map((t, i) => {
					const unitIndex = units.findIndex((_, u) => triInUnit[u].includes(i) && counts[u][choice[i]] === 3);
					const unit = unitIndex >= 0 ? units[unitIndex] : null;
					return {
						cell: t.cell,
						candidates: t.digits,
						bugDigit: choice[i],
						unit,
						unitKind: unit ? classifyUnitKind$1(unit) : null
					};
				}),
				solved,
				eliminations
			};
		}
		return null;
	}
	/** Every marked candidate that is false whichever BUG candidate is the
	* true one: for each of them it's either another digit of that candidate's
	* own cell, or the same digit in a cell that sees it. */
	eliminationsFor(board, candidates, bugCandidates) {
		const out = [];
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0) continue;
			for (let digit = 1; digit <= 9; digit++) {
				if (!candidates[row][col][digit - 1]) continue;
				if (bugCandidates.every(({ cell: [r, c], digit: d }) => r === row && c === col ? digit !== d : digit === d && sees$1([row, col], [r, c]))) out.push({
					row,
					col,
					digit
				});
			}
		}
		return out;
	}
};
function cellRef$2(row, col) {
	return `r${row + 1}c${col + 1}`;
}
function joinAnd(parts) {
	return parts.length <= 1 ? parts[0] ?? "" : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
/** "BUG+1", "BUG+2", "BUG+3" - what the UI calls an instance. */
function bugPlusNName(instance) {
	return `BUG+${instance.n}`;
}
/** "r2c2 {1,2,8} and r8c9 {1,2,6}" - the tri-value cells. */
function bugPlusNCellsText(instance) {
	return joinAnd(instance.cells.map(({ cell: [r, c], candidates }) => `${cellRef$2(r, c)} {${candidates.join(",")}}`));
}
/** "2 in r2c2 (three times in its column) and 2 in r8c9 (three times in its
* row)" - each tri-value cell's BUG digit and, where there is one, the unit
* that shows it. */
function bugPlusNExtrasText(instance) {
	return joinAnd(instance.cells.map(({ cell: [r, c], bugDigit, unitKind }) => `${bugDigit} in ${cellRef$2(r, c)}${unitKind ? ` (three times in its ${unitKind})` : ""}`));
}
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
		})).filter(({ mask }) => popcount$1(mask) >= 2 && popcount$1(mask) <= maxPerLine).map(({ line }) => line);
		const results = [];
		for (const lines of combinations(eligible, size)) {
			const union = lines.reduce((acc, line) => acc | masks[line], 0);
			const unionSize = popcount$1(union);
			const coverChoices = [];
			if (!finned) {
				if (unionSize === size) coverChoices.push(union);
			} else if (unionSize > size && unionSize <= size + 3) for (const cover of combinations(bitsOf$1(union), size)) {
				const coverMask = cover.reduce((acc, x) => acc | 1 << x, 0);
				if (bandsOf(union & ~coverMask) === 1) coverChoices.push(coverMask);
			}
			for (const coverMask of coverChoices) {
				if (lines.some((line) => popcount$1(masks[line] & coverMask) < 2)) continue;
				const crossLines = bitsOf$1(coverMask);
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
		case "box": return boxOf$2(row, col) === house.index;
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
function boxOf$2(row, col) {
	return Math.floor(row / 3) * 3 + Math.floor(col / 3);
}
function sees([r1, c1], [r2, c2]) {
	return (r1 !== r2 || c1 !== c2) && (r1 === r2 || c1 === c2 || boxOf$2(r1, c1) === boxOf$2(r2, c2));
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
function boxOf$1(row, col) {
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
			counts.box[digit][boxOf$1(row, col)]++;
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
	return boxOf$1(a.row, a.col) === boxOf$1(b.row, b.col) && counts.box[digit][boxOf$1(a.row, a.col)] === 2;
}
function sameBox(a, b) {
	return boxOf$1(a.row, a.col) === boxOf$1(b.row, b.col);
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
	return `only twice in ${kind === "box" ? `box ${boxOf$1(a.row, a.col) + 1}` : lineName(kind, a)} (${cellText(a.row, a.col)}, ${cellText(b.row, b.col)})`;
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
		text: `${digit} appears ${pairText(first, a, b)} and ${pairText(second, c, d)}, and ${cellText(b.row, b.col)} and ${cellText(c.row, c.col)} share box ${boxOf$1(b.row, b.col) + 1}`
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
		const inBox = (row, col) => boxOf$1(row, col) === box;
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
				if (popcount(digitMask) !== size + 1) continue;
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
					digits: bitsOf(digitMask).map((d) => d + 1),
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
function cellRef$1(row, col) {
	return `r${row + 1}c${col + 1}`;
}
function cellsLabel(cells) {
	return cells.map(([r, c]) => cellRef$1(r, c)).join(", ");
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
		const clause = `${cellRef$1(...extraCell)} alone holds more than just the pair`;
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
						from: `${digit}${cellRef$1(...A)}`,
						to: [`${digit}${cellRef$1(...N)}`]
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
						clause: `${X}${cellRef$1(...A)} strong links ${X}${cellRef$1(...B)} and ${Y}${cellRef$1(...B)} strong links ${Y}${cellRef$1(...cells[cIndex])}`,
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
				clause: `${cellRef$1(...A)}'s ${ownDigit} is strongly linked to ${cellRef$1(...cells[aOwnPartnerIndex])}`,
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
					from: `${digit}${cellRef$1(...Z)}`,
					to: zNeighbourIndices.map((i) => `${digit}${cellRef$1(...cells[i])}`)
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
function cellRef(row, col) {
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
	"BUG+N",
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
* once it's enabled in Settings), while Bivalue Oddagon and BUG+N (BUG+1/2/3; like every other
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
	bugPlusNFinder = new SudokuBugPlusNFinder();
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
		const describe = (n) => `${n.digit}${cellRef(n.row, n.col)}`;
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
				description: `Assuming ${colorLabel(primary)} is true: ${cellRef(r, c)} would be the only remaining ${digit} in its ${classifyUnitKind(unit)}, so colour it ${colorLabel(secondary)}.`,
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
				description: `Assuming ${colorLabel(primary)} is true eliminates every other candidate from ${cellRef(row, col)}, leaving only ${digit} - colour it ${colorLabel(secondary)}.`,
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
				if (allowedTechniques.has("BUG+N")) {
					const bug = this.memoFind("bug", grid, () => this.bugPlusNFinder.find(hypBoard, hypCandidates));
					if (bug?.solved) {
						const move = this.buildRule3CombinedMove(primary, steps, {
							technique: "BUG+N",
							basisCells: [bug.cells[0].cell],
							affectedCells: [],
							eliminatedCandidates: [],
							clause: this.bugPlusNClause(bug),
							summaryName: `a ${bugPlusNName(bug)}`,
							displayName: bugPlusNName(bug)
						}, {
							...bug.solved,
							color: secondary
						}, { kind: "direct" });
						if (emit(move)) return true;
					} else if (bug) {
						for (const { row, col, digit } of bug.eliminations) hypCandidates[row][col][digit - 1] = false;
						const chainStep = {
							technique: "BUG+N",
							basisCells: bug.cells.map(({ cell }) => cell),
							affectedCells: uniqueCells([...bug.eliminations]),
							eliminatedCandidates: bug.eliminations,
							clause: this.bugPlusNClause(bug),
							summaryName: `a ${bugPlusNName(bug)}`,
							displayName: bugPlusNName(bug)
						};
						if (this.emitForcedCells(hypBoard, hypCandidates, known, (forced) => emit(this.buildRule3CombinedMove(primary, steps, chainStep, {
							...forced,
							color: secondary
						}, { kind: "single candidate" })))) return true;
						steps.push(chainStep);
						appliedSomething = true;
					}
				}
				if (appliedSomething) continue;
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
			aic: s.aic ? toAicChain(s.aic) : void 0,
			...s.displayName ? { displayName: s.displayName } : {}
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
		const cell = cellRef(colored.row, colored.col);
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
		const basisLabel = instance.basisCells.map(([r, c]) => cellRef(r, c)).join(", ");
		const eliminationsLabel = this.formatCandidateGroups(instance.eliminations);
		return `a Locked Candidate (${typeLabel}) for ${instance.digit} in {${basisLabel}}, which eliminates ${eliminationsLabel}`;
	}
	nakedPairClause(pair) {
		const [a, b] = pair.digits;
		return `a naked pair of {${a},${b}} in {${pair.cells.map(([r, c]) => cellRef(r, c)).join(", ")}}, which eliminates ${this.formatCandidateGroups(pair.eliminations)}`;
	}
	nakedSubsetClause(subset) {
		const sizeWord = subset.size === 3 ? "triple" : "quad";
		const cellsLabel = subset.cells.map(([r, c]) => cellRef(r, c)).join(", ");
		return `a naked ${sizeWord} of {${subset.digits.join(",")}} in {${cellsLabel}}, which eliminates ${this.formatCandidateGroups(subset.eliminations)}`;
	}
	hiddenPairClause(pair) {
		const [a, b] = pair.digits;
		return `a hidden pair of {${a},${b}} in {${pair.cells.map(([r, c]) => cellRef(r, c)).join(", ")}}, which eliminates ${this.formatCandidateGroups(pair.eliminations)}`;
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
	bugPlusNClause(bug) {
		if (bug.solved) {
			const [{ cell: [row, col], candidates, unitKind }] = bug.cells;
			return `a BUG+1 at ${cellRef(row, col)} (candidates {${candidates.join(",")}}), where ${bug.solved.digit} appears three times in its ${unitKind}`;
		}
		return `a ${bugPlusNName(bug)} at ${bugPlusNCellsText(bug)}, whose extra digits are ${bugPlusNExtrasText(bug)} - one of them is true, which eliminates ${this.formatCandidateGroups([...bug.eliminations])}`;
	}
	avoidableRectangleClause(ar) {
		return `an Avoidable Rectangle (Type ${ar.type}) of {${ar.digits.join(",")}} at ${ar.cells.map(([r, c]) => cellRef(r, c)).join(", ")}, ${ar.reasonText}, which eliminates ${this.formatCandidateGroups(ar.eliminations)}`;
	}
	bivalueOddagonClauseIntro(oddagon) {
		const [a, b] = oddagon.loopDigits;
		const cellsLabel = oddagon.cells.map(([r, c]) => cellRef(r, c)).join(", ");
		return `a ${oddagon.cells.length}-cell Bivalue Oddagon of {${a},${b}} at ${cellsLabel}`;
	}
	bivalueOddagonSolveClause(oddagon) {
		const [row, col] = oddagon.solvedCell;
		return `${this.bivalueOddagonClauseIntro(oddagon)}, whose only guardian is ${oddagon.guardianDigit}${cellRef(row, col)}`;
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
		return `a hidden single at ${cellRef(cell.row, cell.col)}, since ${cell.digit} has nowhere else to go in its ${cell.unitKind}, so colour it ${colorLabel(secondary)}`;
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
			return `${[...digits].sort((x, y) => x - y).join("")}${cellRef(row, col)}`;
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
		const ref = (n) => `${n.digit}${cellRef(n.row, n.col)}`;
		return `${ref(own)} (${SECOND_DRAGON_LABELS[own.color]}) and ${ref(theirs)} (${colorLabel(theirs.color)}) can't both be true`;
	}
	/** "X is linked to S, so X implies S'", worded for a move description. */
	linkReasoning(link, primary) {
		const xName = SECOND_DRAGON_LABELS[primary];
		const falseSide = sideOf(link.theirs.color);
		const falseName = colorLabel(primaryForSide(falseSide));
		const impliedName = colorLabel(primaryForSide(oppositeSide(falseSide)));
		return `${this.linkClause(link)}: if ${falseName} is true, ${link.theirs.digit}${cellRef(link.theirs.row, link.theirs.col)} is true, so ${xName} is false. So if ${xName} is true, ${falseName} is false and ${impliedName} is true`;
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
			description: `${this.linkReasoning(link, primary)} - and so is every ${impliedNames} coloured candidate: thus, we can colour ${colored.length === 1 ? "it" : "them"} ${SECOND_DRAGON_LABELS[secondary]} as well, while keeping the original ${impliedNames} (${colored.map((n) => `${n.digit}${cellRef(n.row, n.col)}`).join(", ")}).`,
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
					...this.buildMassMove(nodes, side, `${this.linkReasoning(link, primary)}, which includes ${clash.digit}${cellRef(clash.row, clash.col)} - coloured ${clashName}. So ${xName} would make ${clashName} true as well, and ${xName} is false.`),
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
			description: `${a.digit}${cellRef(a.row, a.col)} and ${b.digit}${cellRef(b.row, b.col)} are coloured in ${colorLabel(a.color)} and ${colorLabel(b.color)}. Promote both colours to their primary Medusa colour (if not already Medusa).`,
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
			if (sideOf(a.color) === sideOf(b.color)) return this.buildMassMove(nodes, sideOf(a.color), `In ${cellRef(a.row, a.col)}, ${a.digit} (${colorLabel(a.color)}) and ${b.digit} (${colorLabel(b.color)}) are colours belonging to the same Medusa color, so that Medusa color is false.`);
		}
		for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
			const a = nodes[i];
			const b = nodes[j];
			if (a.digit !== b.digit || sideOf(a.color) !== sideOf(b.color)) continue;
			if (!sameUnit([a.row, a.col], [b.row, b.col])) continue;
			return this.buildMassMove(nodes, sideOf(a.color), `${a.digit} in ${cellRef(a.row, a.col)} (${colorLabel(a.color)}) and ${cellRef(b.row, b.col)} (${colorLabel(b.color)}) are colours belonging to the same Medusa color, so that Medusa color is false.`);
		}
		for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0 || byCell.has(cellKey(row, col))) continue;
			const digits = markedCandidateDigits(candidates[row][col]);
			if (digits.length === 0) continue;
			for (const side of ["A", "B"]) if (digits.every((digit) => nodes.some((n) => sideOf(n.color) === side && n.digit === digit && sameUnit([row, col], [n.row, n.col])))) return this.buildMassMove(nodes, side, `${cellRef(row, col)} has no coloured candidates, but ${digits.join(", ")} all see the ${colorLabel(primaryForSide(side))} side, so that side is false.`, [row, col]);
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
					description: `${cellRef(row, col)} cannot be ${digit} - it sees ${digit}'s coloured with opposite colours (${cellRef(seesA.row, seesA.col)} ${colorLabel(seesA.color)}, ${cellRef(seesB.row, seesB.col)} ${colorLabel(seesB.color)}).`,
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
				description: `${cellRef(row, col)} has candidates coloured with opposite colours, so the uncoloured candidate${eliminatedDigits.length === 1 ? "" : "s"} (${eliminatedDigits.join(", ")}) can be eliminated.`,
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
					description: `${cellRef(row, col)} is not ${digit} - its cell has a candidate coloured ${colorLabel(colored.color)}, and it sees an oppositely coloured ${digit} (${colorLabel(opponent.color)}) at ${cellRef(opponent.row, opponent.col)}.`,
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
new SudokuColorFinder();
new SudokuMedusaFinder();
new SudokuDragonFinder();
new SudokuLockedCandidateFinder();
new SudokuPairFinder();
const urFinder = new SudokuUniqueRectangleFinder();
const bugFinder = new SudokuBugPlusNFinder();
const oddagonFinder = new SudokuBivalueOddagonFinder();
const avoidableRectangleFinder = new SudokuAvoidableRectangleFinder();
function cellName(row, col) {
	return `r${row + 1}c${col + 1}`;
}
function boxOf(row, col) {
	return Math.floor(row / 3) * 3 + Math.floor(col / 3);
}
function unitCells(kind, index) {
	const cells = [];
	for (let a = 0; a < 9; a++) if (kind === "row") cells.push([index, a]);
	else if (kind === "column") cells.push([a, index]);
	else cells.push([Math.floor(index / 3) * 3 + Math.floor(a / 3), index % 3 * 3 + a % 3]);
	return cells;
}
/** Every row/column/box that contains both cells, in row, column, box order. */
function sharedUnits(a, b) {
	const units = [];
	if (a[0] === b[0]) units.push({
		kind: "row",
		index: a[0],
		cells: unitCells("row", a[0])
	});
	if (a[1] === b[1]) units.push({
		kind: "column",
		index: a[1],
		cells: unitCells("column", a[1])
	});
	if (boxOf(a[0], a[1]) === boxOf(b[0], b[1])) {
		const index = boxOf(a[0], a[1]);
		units.push({
			kind: "box",
			index,
			cells: unitCells("box", index)
		});
	}
	return units;
}
function unitPhrase(unit) {
	return `${unit.kind} ${unit.index + 1}`;
}
/** The unit in which `digit` has exactly these two cells left - i.e. the
* strong link between them - or null if there isn't one. */
function strongUnit(state, digit, a, b) {
	for (const unit of sharedUnits(a, b)) if (unit.cells.filter(([r, c]) => state.board[r][c] === 0 && state.candidates[r][c][digit - 1]).length === 2) return unit;
	return null;
}
function ref(row, col, digit) {
	return {
		row,
		col,
		digit
	};
}
function joinPhrases(items) {
	if (items.length <= 1) return items[0] ?? "";
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
function sameCell(a, b) {
	return a[0] === b[0] && a[1] === b[1];
}
function cellList(cells) {
	return joinPhrases(cells.map(([r, c]) => cellName(r, c)));
}
/** The row/column/box a solved-digit count or strong link lives in, named
* the way every other lesson names units. */
function unitContaining(kind, cell) {
	const index = kind === "row" ? cell[0] : kind === "column" ? cell[1] : boxOf(cell[0], cell[1]);
	return {
		kind,
		index,
		cells: unitCells(kind, index)
	};
}
/**
* Every Unique Rectangle type told the same way: the rectangle, why "all four
* corners are just the pair" can't happen (it would have two solutions), then
* the type's own reason. Types 7a-7d are shown as "suppose the eliminated
* candidate were true": each forced corner follows, one frame at a time, until
* the rectangle is the deadly pattern - which is why that candidate goes.
*
* The facts come from the finder's own instance (cells, reason cells, the
* elimination); only the order they're told in is worked out here.
*/
function buildUniqueRectangleLesson(options) {
	const { id, title, hint, state, type, corner } = options;
	const { board, candidates } = state;
	const instance = urFinder.find(board, candidates, { mergeTypes: false }).find((candidate) => candidate.type === type && candidate.cells.some((cell) => sameCell(cell, corner)));
	if (!instance) throw new Error(`No Unique Rectangle ${type} at ${cellName(corner[0], corner[1])} in this example.`);
	const [a, b] = instance.urDigits;
	const cells = instance.cells.map(([r, c]) => [r, c]);
	const digitsOf = ([r, c]) => markedCandidateDigits(candidates[r][c]);
	const bivalue = cells.filter((cell) => digitsOf(cell).length === 2);
	const pairPips = cells.flatMap(([r, c]) => [ref(r, c, a), ref(r, c, b)]);
	const colourOf = (digit) => digit === a ? "blue" : "yellow";
	const deadly = cells.map(([r, c], i) => {
		const digit = i === 0 || i === 3 ? a : b;
		return {
			...ref(r, c, digit),
			color: colourOf(digit)
		};
	});
	const spotlight = { digits: [
		a,
		b,
		...[...new Set(cells.flatMap((cell) => digitsOf(cell).filter((d) => d !== a && d !== b)))]
	] };
	const frames = [{
		badge: "Look",
		caption: `${cellList(cells)} span 2 rows, 2 columns and 2 boxes, and all four can be ${a} or ${b}` + (bivalue.length > 0 && bivalue.length < 4 ? `; ${cellList(bivalue)} ${bivalue.length === 1 ? "holds" : "hold"} nothing else.` : "."),
		outlineCells: cells,
		basis: pairPips,
		spotlight
	}, {
		badge: "Deadly",
		caption: `If all four ended up as just ${a} and ${b}, the two could swap diagonally: two solutions. A proper puzzle has exactly one, so this can never happen.`,
		outlineCells: cells,
		coloured: deadly,
		spotlight
	}];
	const eliminated = instance.eliminatedCandidates.map((e) => ref(e.row, e.col, e.digit));
	const solved = instance.solvedCandidates.map((s) => ref(s.row, s.col, s.digit));
	if (type === "Type 1") {
		const [extraCell] = instance.reasonCells;
		const extras = digitsOf(extraCell).filter((d) => d !== a && d !== b);
		const name = cellName(extraCell[0], extraCell[1]);
		const pairAtExtra = [ref(extraCell[0], extraCell[1], a), ref(extraCell[0], extraCell[1], b)];
		frames.push({
			badge: "Spot it",
			caption: `${name} is the only corner with anything else (${joinPhrases(extras.map(String))}). If it were ${a} or ${b}, all four corners would be just ${a} and ${b}.`,
			outlineCells: cells,
			basis: pairPips,
			eliminated: pairAtExtra,
			spotlight
		}, solved.length > 0 ? {
			badge: "Result",
			caption: `So ${name} must be ${solved[0].digit}.`,
			outlineCells: cells,
			solved,
			spotlight,
			applied: true
		} : {
			badge: "Result",
			caption: `So ${name} can't be ${a} or ${b}.`,
			outlineCells: cells,
			eliminated,
			spotlight,
			applied: true
		});
		return {
			id,
			title,
			hint,
			state,
			frames
		};
	}
	if (type === "Type 2" || type === "Type 5") {
		const extraCells = instance.reasonCells;
		const z = instance.eliminatedCandidates[0].digit;
		const zPips = extraCells.map(([r, c]) => ref(r, c, z));
		const targets = [...new Map(instance.eliminatedCandidates.map((e) => [`${e.row}.${e.col}`, [e.row, e.col]])).values()];
		const seeLinks = eliminated.flatMap((from) => zPips.map((to) => ({
			from,
			to,
			kind: "sees"
		})));
		const all = extraCells.length === 2 ? "both" : "all three";
		frames.push({
			badge: "Spot it",
			caption: `Only ${cellList(extraCells)} hold anything besides ${a} and ${b}, and in each it's just ${z}. If none of them were ${z}, all four corners would be just ${a} and ${b}, so at least one of them is ${z}.`,
			outlineCells: cells,
			basis: zPips,
			spotlight
		}, {
			badge: "Sees",
			caption: `${cellList(targets)} ${targets.length === 1 ? "sees" : "see"} ${all}, so wherever that ${z} lands, ${targets.length === 1 ? "it" : "they"} can't be ${z}.`,
			outlineCells: cells,
			basis: zPips,
			links: seeLinks,
			eliminated,
			spotlight
		}, {
			badge: "Result",
			caption: `So ${cellList(targets)} can't be ${z}.`,
			outlineCells: cells,
			eliminated,
			spotlight,
			applied: true
		});
		return {
			id,
			title,
			hint,
			state,
			frames
		};
	}
	if (type === "Type 3") {
		const [x, y] = instance.reasonCells;
		const subsetCells = (instance.subsetCells ?? []).map(([r, c]) => [r, c]);
		const extras = [...new Set([x, y].flatMap((cell) => digitsOf(cell).filter((d) => d !== a && d !== b)))].sort((p, q) => p - q);
		const subsetDigits = [.../* @__PURE__ */ new Set([...extras, ...subsetCells.flatMap(digitsOf)])].sort((p, q) => p - q);
		const extraPips = [x, y].flatMap(([r, c]) => extras.filter((d) => candidates[r][c][d - 1]).map((d) => ref(r, c, d)));
		const subsetPips = subsetCells.flatMap(([r, c]) => digitsOf([r, c]).map((d) => ref(r, c, d)));
		const houses = sharedUnits(x, y).filter((unit) => subsetCells.every((cell) => unit.cells.some((u) => sameCell(u, cell))));
		const housePhrase = joinPhrases(houses.map(unitPhrase));
		const pairNames = `${cellName(x[0], x[1])} and ${cellName(y[0], y[1])}`;
		const subsetSpotlight = { digits: [
			a,
			b,
			...subsetDigits
		] };
		frames.push({
			badge: "Merge",
			caption: `Only ${pairNames} hold anything besides ${a} and ${b}. They can't both be ${a} or ${b} (that's the deadly pattern), so one of them is ${extras.slice(0, -1).join(", ")} or ${extras[extras.length - 1]}: treat the two as one cell holding just {${extras.join(",")}}.`,
			outlineCells: cells,
			basis: extraPips,
			spotlight: subsetSpotlight
		}, {
			badge: "Subset",
			caption: `In ${housePhrase}, that merged cell plus ${cellList(subsetCells)} make ${subsetCells.length + 1} cells holding only the ${subsetDigits.length} digits ${subsetDigits.join(", ")}: a naked subset, so those digits all go in these cells.`,
			outlineCells: cells,
			greenCells: [
				x,
				y,
				...subsetCells
			],
			unitCells: houses.flatMap((unit) => unit.cells),
			basis: [...extraPips, ...subsetPips],
			spotlight: subsetSpotlight
		}, {
			badge: "Why",
			caption: `So none of ${subsetDigits.join(", ")} can go anywhere else in ${housePhrase}.`,
			outlineCells: cells,
			greenCells: [
				x,
				y,
				...subsetCells
			],
			unitCells: houses.flatMap((unit) => unit.cells),
			basis: [...extraPips, ...subsetPips],
			eliminated,
			spotlight: subsetSpotlight
		}, {
			badge: "Result",
			caption: `So ${joinPhrases(instance.eliminatedCandidates.map((e) => `${cellName(e.row, e.col)} can't be ${e.digit}`))}.`,
			outlineCells: cells,
			eliminated,
			spotlight: subsetSpotlight,
			applied: true
		});
		return {
			id,
			title,
			hint,
			state,
			frames
		};
	}
	if (type === "Type 4") {
		const [x, y] = instance.reasonCells;
		const e = instance.eliminatedCandidates[0].digit;
		const d = e === a ? b : a;
		const unit = strongUnit(state, d, x, y);
		const link = {
			from: ref(x[0], x[1], d),
			to: ref(y[0], y[1], d),
			kind: "strong"
		};
		const names = `${cellName(x[0], x[1])} and ${cellName(y[0], y[1])}`;
		frames.push({
			badge: "Link",
			caption: `In ${unit ? unitPhrase(unit) : "their shared unit"}, ${d} fits only in ${names}, so one of them is ${d}.`,
			outlineCells: cells,
			unitCells: unit?.cells,
			links: [link],
			spotlight
		}, {
			badge: "Why",
			caption: `The other one can't be ${e}: that would leave all four corners as just ${a} and ${b}.`,
			outlineCells: cells,
			links: [link],
			eliminated,
			spotlight
		}, {
			badge: "Result",
			caption: `So neither ${cellName(x[0], x[1])} nor ${cellName(y[0], y[1])} can be ${e}.`,
			outlineCells: cells,
			eliminated,
			spotlight,
			applied: true
		});
		return {
			id,
			title,
			hint,
			state,
			frames
		};
	}
	const target = instance.eliminatedCandidates[0];
	const targetCell = [target.row, target.col];
	const x = target.digit;
	const y = x === a ? b : a;
	const name = (cell) => cellName(cell[0], cell[1]);
	const others = (...exclude) => cells.filter((cell) => !exclude.some((e) => sameCell(e, cell)));
	let links;
	let steps;
	if (type === "Type 7a") {
		const [A, N] = instance.reasonCells;
		const [B] = others(A, N, targetCell);
		links = [{
			digit: x,
			from: A,
			to: N
		}];
		steps = [
			{
				cell: A,
				digit: y,
				because: `${name(A)} sees ${name(targetCell)}, so it isn't ${x}: it's ${y}`
			},
			{
				cell: N,
				digit: x,
				because: `the ${x} link puts ${x} in ${name(N)}`
			},
			{
				cell: B,
				digit: y,
				because: `${name(B)} sees both ${x}s, so it's ${y}`
			}
		];
	} else if (type === "Type 7b") {
		const [A, B, C] = instance.reasonCells;
		links = [{
			digit: x,
			from: A,
			to: B
		}, {
			digit: y,
			from: B,
			to: C
		}];
		steps = [
			{
				cell: A,
				digit: y,
				because: `${name(A)} sees ${name(targetCell)}, so it isn't ${x}: it's ${y}`
			},
			{
				cell: B,
				digit: x,
				because: `the ${x} link puts ${x} in ${name(B)}`
			},
			{
				cell: C,
				digit: y,
				because: `${name(B)} isn't ${y}, so the ${y} link puts ${y} in ${name(C)}`
			}
		];
	} else if (type === "Type 7c") {
		const [A, P] = instance.reasonCells;
		const [Q] = others(A, P, targetCell);
		links = [{
			digit: x,
			from: A,
			to: P
		}, {
			digit: y,
			from: targetCell,
			to: Q
		}];
		steps = [
			{
				cell: A,
				digit: y,
				because: `${name(A)} sees ${name(targetCell)}, so it isn't ${x}: it's ${y}`
			},
			{
				cell: P,
				digit: x,
				because: `the ${x} link puts ${x} in ${name(P)}`
			},
			{
				cell: Q,
				digit: y,
				because: `${name(targetCell)} isn't ${y}, so the ${y} link puts ${y} in ${name(Q)}`
			}
		];
	} else {
		const [A] = instance.reasonCells;
		const [R, C] = others(A, targetCell);
		links = [{
			digit: y,
			from: targetCell,
			to: R
		}, {
			digit: y,
			from: targetCell,
			to: C
		}];
		steps = [
			{
				cell: R,
				digit: y,
				because: `${name(targetCell)} isn't ${y}, so the ${y} link puts ${y} in ${name(R)}`
			},
			{
				cell: C,
				digit: y,
				because: `the other ${y} link puts ${y} in ${name(C)} too`
			},
			{
				cell: A,
				digit: x,
				because: `${name(A)} sees both ${y}s, so it's ${x}`
			}
		];
	}
	const linkLines = links.map((l) => ({
		from: ref(l.from[0], l.from[1], l.digit),
		to: ref(l.to[0], l.to[1], l.digit),
		kind: "strong"
	}));
	const linkUnits = links.map((l) => strongUnit(state, l.digit, l.from, l.to));
	frames.push({
		badge: "Links",
		caption: links.map((l, i) => `In ${linkUnits[i] ? unitPhrase(linkUnits[i]) : "their shared unit"}, ${l.digit} fits only in ${name(l.from)} and ${name(l.to)}.`).join(" "),
		outlineCells: cells,
		unitCells: linkUnits.flatMap((unit) => unit?.cells ?? []),
		links: linkLines,
		spotlight
	});
	const targetPip = ref(target.row, target.col, x);
	const suppose = [{
		...targetPip,
		color: colourOf(x)
	}];
	frames.push({
		badge: "Suppose",
		caption: `Suppose ${name(targetCell)} were ${x}.`,
		outlineCells: cells,
		links: linkLines,
		coloured: suppose,
		fresh: [targetPip],
		spotlight
	});
	steps.forEach((step, i) => {
		const pip = ref(step.cell[0], step.cell[1], step.digit);
		frames.push({
			badge: "Follow",
			caption: `Then ${step.because}.`,
			outlineCells: cells,
			links: linkLines,
			coloured: [...suppose, ...steps.slice(0, i + 1).map((s) => ({
				...ref(s.cell[0], s.cell[1], s.digit),
				color: colourOf(s.digit)
			}))],
			fresh: [pip],
			spotlight
		});
	});
	const allColoured = [...suppose, ...steps.map((s) => ({
		...ref(s.cell[0], s.cell[1], s.digit),
		color: colourOf(s.digit)
	}))];
	frames.push({
		badge: "Deadly",
		caption: `Now all four corners are just ${a} and ${b}: the deadly pattern. So the supposition was wrong.`,
		outlineCells: cells,
		links: linkLines,
		coloured: allColoured,
		spotlight
	}, {
		badge: "Result",
		caption: `So ${name(targetCell)} can't be ${x}.`,
		outlineCells: cells,
		links: linkLines,
		eliminated,
		spotlight,
		applied: true
	});
	return {
		id,
		title,
		hint,
		state,
		frames
	};
}
/**
* BUG+1, BUG+2 and BUG+3 - one technique (BUG+N), one lesson builder; `n`
* says which the example must show. BUG+1: the one tri-value cell is the
* digit that breaks the pattern. BUG+2/BUG+3: one of the tri-value cells'
* extra digits is true, so a cell that sees them all can't be that digit.
*/
function buildBugPlusNLesson(id, title, hint, state, n) {
	const instance = bugFinder.find(state.board, state.candidates);
	if (!instance || instance.n !== n) throw new Error(`No BUG+${n} in this example.`);
	const triCells = instance.cells.map(({ cell: [r, c] }) => [r, c]);
	const deadlyCaption = "With only two candidates in every cell, each digit left in a row, column or box would appear there exactly twice: a pattern that always has two solutions.";
	if (instance.solved) {
		const [{ candidates, unitKind }] = instance.cells;
		const cell = triCells[0];
		const name = cellName(cell[0], cell[1]);
		const digit = instance.solved.digit;
		const unit = unitContaining(unitKind ?? "row", cell);
		const inUnit = unit.cells.filter(([r, c]) => state.board[r][c] === 0 && state.candidates[r][c][digit - 1]).map(([r, c]) => ref(r, c, digit));
		const solved = [ref(cell[0], cell[1], digit)];
		return {
			id,
			title,
			hint,
			state,
			frames: [
				{
					badge: "Look",
					caption: `Every unsolved cell has exactly two candidates, except ${name}, which has three (${joinPhrases(candidates.map(String))}).`,
					outlineCells: [cell]
				},
				{
					badge: "Deadly",
					caption: `${deadlyCaption} So ${name} must be the digit that breaks it.`,
					outlineCells: [cell]
				},
				{
					badge: "Count",
					caption: `In ${unitPhrase(unit)}, ${digit} appears three times, while every other digit pairs up. The odd one out is ${digit}.`,
					outlineCells: [cell],
					unitCells: unit.cells,
					basis: inUnit,
					spotlight: { digits: [digit] }
				},
				{
					badge: "Result",
					caption: `So ${name} is ${digit}.`,
					outlineCells: [cell],
					solved,
					spotlight: { digits: [digit] },
					applied: true
				}
			]
		};
	}
	const bugPips = instance.cells.map(({ cell: [r, c], bugDigit }) => ref(r, c, bugDigit));
	const bugDigits = [...new Set(instance.cells.map((c) => c.bugDigit))];
	const eliminated = instance.eliminations.map((e) => ref(e.row, e.col, e.digit));
	const described = joinPhrases(instance.cells.map(({ cell: [r, c], candidates }) => `${cellName(r, c)} (${joinPhrases(candidates.map(String))})`));
	const countFrames = instance.cells.map(({ cell: [r, c], bugDigit, unitKind }) => {
		const name = cellName(r, c);
		if (!unitKind) return {
			badge: "Count",
			caption: `${name}'s extra digit is ${bugDigit}: take it out, and every digit pairs up again around ${name}.`,
			outlineCells: triCells,
			basis: [ref(r, c, bugDigit)],
			spotlight: { digits: bugDigits }
		};
		const unit = unitContaining(unitKind, [r, c]);
		return {
			badge: "Count",
			caption: `In ${unitPhrase(unit)}, ${bugDigit} appears three times - one too many for the pattern. So ${name}'s extra digit is ${bugDigit}.`,
			outlineCells: triCells,
			unitCells: unit.cells,
			basis: unit.cells.filter(([ur, uc]) => state.board[ur][uc] === 0 && state.candidates[ur][uc][bugDigit - 1]).map(([ur, uc]) => ref(ur, uc, bugDigit)),
			spotlight: { digits: [bugDigit] }
		};
	});
	const eliminatedCells = eliminated.map((e) => [e.row, e.col]);
	const sameDigit = bugDigits.length === 1;
	const count = n === 2 ? "two" : "three";
	const allOf = n === 2 ? "both" : "all three";
	const pipsText = bugPips.map((p) => `${p.digit} in ${cellName(p.row, p.col)}`);
	const sharedOther = instance.cells[0].candidates.find((d) => !bugDigits.includes(d) && instance.cells.every((c) => c.candidates.includes(d)));
	const onlyOthers = eliminated.every((e) => !triCells.some((t) => sameCell(t, [e.row, e.col])));
	return {
		id,
		title,
		hint,
		state,
		frames: [
			{
				badge: "Look",
				caption: `Every unsolved cell has exactly two candidates, except ${count} cells with three: ${described}.`,
				outlineCells: triCells
			},
			{
				badge: "Deadly",
				caption: `${deadlyCaption} So each of these ${count} cells has one extra digit, and the extras are what keep the puzzle to one solution.`,
				outlineCells: triCells
			},
			...countFrames,
			{
				badge: "Key",
				caption: n === 2 ? `If neither ${pipsText[0]} nor ${pipsText[1]} were true, taking them out would leave the two-solution pattern. So at least one of them is true.` : `If none of ${pipsText.slice(0, -1).join(", ")} or ${pipsText[pipsText.length - 1]} were true, taking them out would leave the two-solution pattern. So at least one of them is true.`,
				outlineCells: triCells,
				basis: bugPips,
				spotlight: { digits: bugDigits }
			},
			{
				badge: "Eliminate",
				caption: sameDigit && onlyOthers ? `Whichever of them is ${bugDigits[0]}, a cell that sees ${allOf} of them can't be ${bugDigits[0]}.` + (sharedOther ? ` Only the extra digit counts: ${sharedOther} is in ${allOf} cells too, but it isn't an extra digit, so a cell seeing them can still be ${sharedOther}.` : "") : `Anything that can't be true alongside each of them goes.`,
				outlineCells: triCells,
				basis: bugPips,
				eliminated,
				links: eliminated.flatMap((e) => bugPips.filter((p) => !sameCell([p.row, p.col], [e.row, e.col])).map((p) => ({
					from: e,
					to: p,
					kind: "sees"
				}))),
				spotlight: { digits: bugDigits }
			},
			{
				badge: "Result",
				caption: `So ${joinPhrases([...new Set(eliminated.map((e) => e.digit))].map((d) => `${cellList(eliminatedCells.filter((_, i) => eliminated[i].digit === d))} can't be ${d}`))}.`,
				outlineCells: triCells,
				eliminated,
				spotlight: { digits: bugDigits },
				applied: true
			}
		]
	};
}
function buildAvoidableRectangleLesson(options) {
	const { id, title, hint, state, type, cell } = options;
	const instance = avoidableRectangleFinder.find(state.board, state.candidates, state.givens).find((ar) => ar.type === type && ar.eliminations.some((e) => e.row === cell[0] && e.col === cell[1]));
	if (!instance) throw new Error(`No Avoidable Rectangle Type ${type} eliminating from ${cellName(cell[0], cell[1])} in this example.`);
	const corners = instance.cells.map(([r, c]) => [r, c]);
	const solvedCorners = instance.solvedCells.map(([r, c]) => [r, c]);
	const unsolved = corners.filter(([r, c]) => state.board[r][c] === 0);
	const eliminated = instance.eliminations.map((e) => ref(e.row, e.col, e.digit));
	const [a, b] = instance.digits;
	const look = {
		badge: "Look",
		caption: `${joinPhrases(solvedCorners.map(([r, c]) => `${cellName(r, c)} (${state.board[r][c]})`))} were solved along the way - none of them is a given. With ${cellList(unsolved)} they make a rectangle over two boxes.`,
		outlineCells: corners,
		spotlight: { digits: [
			a,
			b,
			...instance.extraDigit ? [instance.extraDigit] : []
		] }
	};
	let frames;
	if (type === 1) {
		const { row, col, digit } = eliminated[0];
		frames = [
			look,
			{
				badge: "Deadly",
				caption: `If ${cellName(row, col)} were ${digit}, the corners would read ${a}, ${b}, ${a}, ${b} with no given among them - swap the ${a}s and ${b}s and you'd have a second solution.`,
				outlineCells: corners,
				eliminated
			},
			{
				badge: "Result",
				caption: `So ${cellName(row, col)} can't be ${digit}.`,
				outlineCells: corners,
				eliminated,
				applied: true
			}
		];
	} else {
		const x = instance.extraDigit;
		const basis = unsolved.flatMap(([r, c]) => markedCandidateDigits(state.candidates[r][c]).map((d) => ref(r, c, d)));
		const spotlight = { digits: [x] };
		frames = [
			{
				...look,
				basis
			},
			{
				badge: "Deadly",
				caption: `If neither ${cellName(...unsolved[0])} nor ${cellName(...unsolved[1])} were ${x}, they'd complete ${a}, ${b}, ${a}, ${b} round the rectangle with no given - a second solution. So one of them is ${x}.`,
				outlineCells: corners,
				basis
			},
			{
				badge: "Eliminate",
				caption: `Any cell that sees both of them can't be ${x}: ${cellList(eliminated.map((e) => [e.row, e.col]))}.`,
				outlineCells: corners,
				basis,
				eliminated,
				spotlight
			},
			{
				badge: "Result",
				caption: `So ${x} goes from ${cellList(eliminated.map((e) => [e.row, e.col]))}.`,
				outlineCells: corners,
				eliminated,
				spotlight,
				applied: true
			}
		];
	}
	return {
		id,
		title,
		hint,
		state,
		frames
	};
}
function buildBivalueOddagonLesson(options) {
	const { id, title, hint, state, type, cell } = options;
	const instance = oddagonFinder.find(state.board, state.candidates).find((candidate) => candidate.type === type && candidate.cells.some((c) => sameCell(c, cell)));
	if (!instance) throw new Error(`No Bivalue Oddagon Type ${type} through ${cellName(cell[0], cell[1])} in this example.`);
	const [a, b] = instance.loopDigits;
	const x = instance.guardianDigit;
	const loop = instance.cells.map(([r, c]) => [r, c]);
	const n = loop.length;
	const guardians = instance.guardianCells.map(([r, c]) => [r, c]);
	const spotlight = { digits: [
		a,
		b,
		x
	] };
	const ring = loop.map(([r, c], i) => {
		const [nr, nc] = loop[(i + 1) % n];
		return {
			from: ref(r, c, a),
			to: ref(nr, nc, a),
			kind: "sees"
		};
	});
	const alternating = loop.map(([r, c], i) => {
		const digit = i % 2 === 0 ? a : b;
		return {
			...ref(r, c, digit),
			color: digit === a ? "blue" : "yellow"
		};
	});
	const [lr, lc] = loop[n - 1];
	const [fr, fc] = loop[0];
	const frames = [{
		badge: "Look",
		caption: `These ${n} cells can each be ${a} or ${b} (${cellList(guardians)} can also be ${x}), and each one sees the next, making a loop of ${n}.`,
		outlineCells: loop,
		links: ring,
		spotlight
	}, {
		badge: "Why",
		caption: `Neighbours in the loop can't match, so a loop of just ${a} and ${b} must alternate. With an odd number of cells, the last one meets the first with the same digit: impossible.`,
		outlineCells: loop,
		coloured: alternating,
		links: [{
			from: ref(lr, lc, a),
			to: ref(fr, fc, a),
			kind: "sees"
		}],
		spotlight
	}];
	if (type === 1) {
		const [g] = guardians;
		const solved = [ref(g[0], g[1], x)];
		frames.push({
			badge: "Spot it",
			caption: `So some loop cell must be something else, and only ${cellName(g[0], g[1])} has another option: ${x}.`,
			outlineCells: loop,
			solved,
			spotlight
		}, {
			badge: "Result",
			caption: `So ${cellName(g[0], g[1])} is ${x}.`,
			outlineCells: loop,
			solved,
			spotlight,
			applied: true
		});
	} else {
		const eliminated = instance.eliminations.map((e) => ref(e.row, e.col, e.digit));
		const guardianPips = guardians.map(([r, c]) => ref(r, c, x));
		frames.push({
			badge: "Spot it",
			caption: `So some loop cell must be something else. Only ${cellList(guardians)} have another option, ${x}, so one of them is ${x}.`,
			outlineCells: loop,
			basis: guardianPips,
			spotlight
		}, {
			badge: "Eliminate",
			caption: `Any other cell that sees all of them can't be ${x}.`,
			outlineCells: loop,
			basis: guardianPips,
			eliminated,
			links: eliminated.flatMap((e) => guardianPips.map((g) => ({
				from: e,
				to: g,
				kind: "sees"
			}))),
			spotlight
		}, {
			badge: "Result",
			caption: `${x} is removed from ${cellList(eliminated.map((e) => [e.row, e.col]))}.`,
			outlineCells: loop,
			eliminated,
			spotlight,
			applied: true
		});
	}
	return {
		id,
		title,
		hint,
		state,
		frames
	};
}
//#endregion
//#region src/tutorial/puzzleState.ts
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
/** Builds a tutorial position from the two pieces the example lists in
* tutorialExamples.ts store: an 81-character board ('0' = empty, row by row)
* and, optionally, the pencil marks that have already been removed from a
* plain "every legal digit" autofill, written the way the app writes cells
* ("r3c4-5 r3c4-9" = 5 and 9 removed from r3c4).
*
* Pencil marks are app state, not something derivable from the board - the
* finders trust them as given - so this is what makes a mid-solve position
* reproducible from a short string.
*
* Every filled cell counts as a given unless `cluesString` (the original
* puzzle, 81 digits) is passed: then only its digits are givens and the rest
* of the board's are solved cells - which Avoidable Rectangles need. */
function decodePuzzleState(boardString, removed = "", cluesString) {
	if (!/^[0-9]{81}$/.test(boardString)) throw new Error("A tutorial board must be exactly 81 digits (0 for an empty cell).");
	const board = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => Number(boardString[r * 9 + c])));
	const candidates = createEmptyCandidates();
	for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (board[r][c] === 0) candidates[r][c] = DIGITS.map((d) => SudokuRules.isSafe(board, r, c, d));
	for (const token of removed.split(/\s+/).filter(Boolean)) {
		const match = /^r([1-9])c([1-9])-([1-9])$/.exec(token);
		if (!match) throw new Error(`Bad removed-candidate "${token}" - expected something like r3c4-5.`);
		candidates[Number(match[1]) - 1][Number(match[2]) - 1][Number(match[3]) - 1] = false;
	}
	if (cluesString !== void 0 && !/^[0-9]{81}$/.test(cluesString)) throw new Error("A tutorial clue string must be exactly 81 digits (0 for a non-given).");
	return {
		board,
		givens: board.map((row, r) => row.map((value, c) => {
			if (cluesString === void 0) return value !== 0;
			const clue = Number(cluesString[r * 9 + c]);
			if (clue !== 0 && clue !== value) throw new Error(`Clue ${clue} at r${r + 1}c${c + 1} isn't on the board.`);
			return clue !== 0;
		})),
		candidates
	};
}
SAMPLE_PUZZLE.map((row) => row.join("")).join("");
/** Runs a builder, and if the position ever stops matching what the builder
* expects (say a finder changes), drops that one lesson instead of breaking
* the whole page. */
function safely(build) {
	try {
		return [build()];
	} catch (error) {
		console.warn("[tutorial] skipped a lesson:", error);
		return [];
	}
}
/** Abusing Uniqueness: one sub-tab per technique. Most positions here were
* mined from real solves as the first stuck point after the Basics, and need
* no pencil marks removed - a plain autofill of the board shows them. UR
* Types 2, 3 and 5 are mid-solve positions (from Sudoku.Coach states), so
* they list the marks already removed. */
function buildUniquenessGroups() {
	return [
		{
			title: "UR Type 1",
			blurb: "Three corners hold only the pair, so the fourth must be something else.",
			lessons: safely(() => buildUniqueRectangleLesson({
				id: "ur-1",
				title: "UR Type 1",
				state: decodePuzzleState("408025761206071508157608320589164273621537000743002156870019635315706902960053017"),
				type: "Type 1",
				corner: [8, 3]
			}))
		},
		{
			title: "UR Type 2",
			blurb: "Two side-by-side corners share one extra candidate, so one of them is it.",
			lessons: safely(() => buildUniqueRectangleLesson({
				id: "ur-2",
				title: "UR Type 2",
				state: decodePuzzleState("200901600000006003000405000036000509504093800900050370381562497000849135459317200", "r1c3-8 r2c2-7 r2c8-1 r2c8-2 r3c1-1 r3c2-1 r3c2-7 r3c5-2 r3c8-8 r3c9-8 r4c5-8 r6c4-2"),
				type: "Type 2",
				corner: [4, 7]
			}))
		},
		{
			title: "UR Type 3",
			blurb: "Two side-by-side extra corners act as one cell in a naked subset.",
			lessons: safely(() => buildUniqueRectangleLesson({
				id: "ur-3",
				title: "UR Type 3",
				state: decodePuzzleState("000730504035800060040105300060001030403000000050090000974010852582900613316582007", "r2c1-1 r3c1-2 r4c5-2 r4c5-4 r5c5-2 r6c6-4 r6c7-1 r6c9-1"),
				type: "Type 3",
				corner: [5, 3]
			}))
		},
		{
			title: "UR Type 4",
			blurb: "One pair digit is locked into the two extra corners, so the other pair digit leaves them.",
			lessons: safely(() => buildUniqueRectangleLesson({
				id: "ur-4",
				title: "UR Type 4",
				state: decodePuzzleState("754001000183726945962854371047589103510043097300017450000008514435162789801405632"),
				type: "Type 4",
				corner: [6, 1]
			}))
		},
		{
			title: "UR Type 5",
			blurb: "Type 2 with the shared extra candidate in diagonal corners, or in three corners.",
			lessons: [...safely(() => buildUniqueRectangleLesson({
				id: "ur-5-diagonal",
				title: "UR Type 5 (diagonal)",
				hint: "The extra candidate is in two diagonal corners.",
				state: decodePuzzleState("980510460502640918461089070795008146148006320326104800854061030600400081210800604", "r5c5-9 r6c9-9 r7c4-2 r7c9-7 r8c5-5 r8c6-7 r8c7-2 r9c5-5 r9c6-7"),
				type: "Type 5",
				corner: [4, 4]
			})), ...safely(() => buildUniqueRectangleLesson({
				id: "ur-5-three",
				title: "UR Type 5 (three corners)",
				hint: "The extra candidate is in three corners.",
				state: decodePuzzleState("002037004903401287407092310005086400708320001000900008209048100004003800830009040", "r1c2-6 r1c4-5 r1c7-5 r3c2-6 r4c2-1 r5c2-6 r6c2-1 r6c2-6 r6c5-5 r6c7-6 r6c8-6 r8c5-5 r8c9-5 r9c4-1 r9c4-7"),
				type: "Type 5",
				corner: [0, 6]
			}))]
		},
		{
			title: "UR Type 7a",
			blurb: "Two pair-only corners sit diagonally, and one of them is linked to a neighbour.",
			lessons: safely(() => buildUniqueRectangleLesson({
				id: "ur-7a",
				title: "UR Type 7a",
				state: decodePuzzleState("430706520785492613020305007548671392000520000072840165217954836004238001803167200"),
				type: "Type 7a",
				corner: [4, 0]
			}))
		},
		{
			title: "UR Type 7b",
			blurb: "Two links chain round the rectangle from a pair-only corner.",
			lessons: safely(() => buildUniqueRectangleLesson({
				id: "ur-7b",
				title: "UR Type 7b",
				state: decodePuzzleState("100548007500763200070291504050176948417859002006432175700305406000904703000627800"),
				type: "Type 7b",
				corner: [8, 7]
			}))
		},
		{
			title: "UR Type 7c",
			blurb: "Each side of the rectangle is locked to a different pair digit.",
			lessons: safely(() => buildUniqueRectangleLesson({
				id: "ur-7c",
				title: "UR Type 7c",
				state: decodePuzzleState("010052047034010952527490160783249615152060094040501270498125736075906401061074509"),
				type: "Type 7c",
				corner: [1, 3]
			}))
		},
		{
			title: "UR Type 7d",
			blurb: "Hidden Rectangle: the corner opposite a pair-only cell is linked to both its neighbours.",
			lessons: safely(() => buildUniqueRectangleLesson({
				id: "ur-7d",
				title: "UR Type 7d",
				state: decodePuzzleState("504769803839152467607483095046530900098240536352690040981306054473905680265804309"),
				type: "Type 7d",
				corner: [3, 5]
			}))
		},
		{
			title: "BUG+1",
			blurb: "Every cell has two candidates except one: that cell holds the digit that breaks the pattern.",
			lessons: safely(() => buildBugPlusNLesson("bug-plus-one", "BUG+1", "BUG+1 (avoiding a Bivalue Universal Grave)", decodePuzzleState("086307250205608703734521869802736500053284607647915382561473928328169475479852136"), 1))
		},
		{
			title: "BUG+2",
			blurb: "Two cells have three candidates: one of their extra digits is true, so a cell seeing both loses that digit.",
			lessons: safely(() => buildBugPlusNLesson("bug-plus-two", "BUG+2", "BUG+2: two cells hold the way out", decodePuzzleState("000397040309504607047806039700983465435672918896145273054730090903450700178269354", "r1c1-2 r1c2-1 r1c2-2 r1c7-1 r7c9-1"), 2))
		},
		{
			title: "BUG+3",
			blurb: "Three cells have three candidates: one of their extra digits is true, so a cell seeing all three loses that digit.",
			lessons: safely(() => buildBugPlusNLesson("bug-plus-three", "BUG+3", "BUG+3: three cells hold the way out", decodePuzzleState("271463800395718624648529371539246718460801003180390460913680040754932186826104030"), 3))
		},
		{
			title: "Bivalue Oddagon",
			blurb: "An odd loop of cells can't be filled with just two digits. Strictly, this one doesn't need uniqueness - such a loop has no solution at all - but it's a close cousin of the patterns here.",
			lessons: [...safely(() => buildBivalueOddagonLesson({
				id: "oddagon-1",
				title: "One way out",
				hint: "Type 1: a single cell can break the loop.",
				state: decodePuzzleState("815006024427850601936421857183945762592637418674218500058060140041500086369184275"),
				type: 1,
				cell: [7, 5]
			})), ...safely(() => buildBivalueOddagonLesson({
				id: "oddagon-2",
				title: "Several ways out",
				hint: "Type 2: the loop is broken by one of a few cells, all with the same extra digit.",
				state: decodePuzzleState("285090763103500492094002581501009826029050134408200957917625348842973615356000279"),
				type: 2,
				cell: [1, 5]
			}))]
		},
		{
			title: "Avoidable Rectangle",
			blurb: "A Unique Rectangle made partly of solved cells: none of them is a given, so they must not end up as two digits that could swap.",
			lessons: [...safely(() => buildAvoidableRectangleLesson({
				id: "avoidable-rectangle-1",
				title: "Three corners solved",
				hint: "Type 1: the fourth corner must not complete the pattern.",
				state: decodePuzzleState("000400809043008251081200000800005007030067000090004000009082415408500302052040086", "", "000000809043008050001200000800005007030067000090004000000000015400000300052040080"),
				type: 1,
				cell: [7, 4]
			})), ...safely(() => buildAvoidableRectangleLesson({
				id: "avoidable-rectangle-2",
				title: "Two corners solved",
				hint: "Type 2: one of the two open corners must take its extra digit.",
				state: decodePuzzleState("300104006000020070065800001130500900600291000009000000006900704843702000000460032", "r6c6-3 r6c7-3 r6c8-8 r6c9-3 r7c8-5", "300004006000020070065800001130500900600201000009000000000900704800000000000460032"),
				type: 2,
				cell: [6, 4]
			}))]
		}
	];
}
//#endregion
//#region dragon-research/bug-n/lesson-check.ts
for (const title of [
	"BUG+1",
	"BUG+2",
	"BUG+3"
]) {
	const group = buildUniquenessGroups().find((g) => g.title === title);
	if (!group || group.lessons.length !== 1) throw new Error(`${title}: ${group?.lessons.length}`);
	for (const lesson of group.lessons) {
		console.log(`== ${lesson.title} (${lesson.hint})`);
		for (const f of lesson.frames) console.log(`[${f.badge}] ${f.caption}  elim=${(f.eliminated ?? []).map((e) => `${e.digit}r${e.row + 1}c${e.col + 1}`)} solved=${(f.solved ?? []).map((e) => `${e.digit}r${e.row + 1}c${e.col + 1}`)}`);
	}
}
//#endregion
export {};
