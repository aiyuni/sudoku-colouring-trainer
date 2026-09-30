//#region src/sudoku/SudokuReverseBugFinder.ts
const boxOf = (row, col) => Math.floor(row / 3) * 3 + Math.floor(col / 3);
/**
* Reverse BUG (Sudopedia): for two digits a and b, a solution's 18 a/b cells
* split into two unavoidable sets whenever 2n of them occupy exactly n rows,
* n columns and n boxes: the other 18 - 2n then occupy exactly the other
* 9 - n rows, columns and boxes, one a and one b in each, so swapping a and b
* among just those cells gives another valid grid. If none of those cells is
* a given, that second grid is a second solution. So in a unique puzzle, the
* given a/b cells can never all lie inside such a "closed" set of n < 9 rows,
* columns and boxes - and a candidate whose placement would close one is
* false.
*
* Closing test: a set is closed exactly when each of its a cells has its
* row's, column's and box's b in the set too, and vice versa. Growing a seed
* by that rule gives the smallest closed set containing it, as long as every
* partner it asks for is already placed; one that isn't means we can't tell,
* so nothing is concluded.
*
* Reverse BUG Lite (Sudopedia): two rows of one band (or two columns of one
* stack). If their placed cells fill the same positions with the same set of
* digits in both lines, swapping the two lines' cells in every other position
* keeps every row, column and box valid - a second solution unless one of
* those positions holds a given. Same closure idea, over positions instead of
* digit partners.
*/
var SudokuReverseBugFinder = class {
	find(board, candidates, givens, seed = "solved") {
		return [...this.findReverseBug(board, candidates, givens, seed), ...this.findReverseBugLite(board, candidates, givens, seed)];
	}
	findReverseBug(board, candidates, givens, seed = "solved") {
		const out = [];
		for (let a = 1; a <= 9; a++) for (let b = a + 1; b <= 9; b++) for (let row = 0; row < 9; row++) for (let col = 0; col < 9; col++) {
			if (board[row][col] !== 0) continue;
			for (const digit of [a, b]) {
				if (!candidates[row][col][digit - 1]) continue;
				const pattern = closeDigitPair(board, givens, seed, a, b, row, col, digit);
				if (pattern) out.push({
					kind: "reverse-bug",
					eliminated: {
						row,
						col,
						digit
					},
					digits: [a, b],
					patternCells: pattern,
					size: pattern.length / 2
				});
			}
		}
		return out;
	}
	findReverseBugLite(board, candidates, givens, seed = "solved") {
		const out = [];
		for (const byRow of [true, false]) {
			const at = (line, pos) => byRow ? [line, pos] : [pos, line];
			for (let band = 0; band < 3; band++) for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
				const lines = [band * 3 + i, band * 3 + j];
				for (const [k, line] of lines.entries()) for (let pos = 0; pos < 9; pos++) {
					const [row, col] = at(line, pos);
					if (board[row][col] !== 0) continue;
					for (let digit = 1; digit <= 9; digit++) {
						if (!candidates[row][col][digit - 1]) continue;
						const value = (l, p) => {
							if (l === k && p === pos) return digit;
							const [r, c] = at(lines[l], p);
							return board[r][c];
						};
						const inSeed = (l, p) => {
							if (l === k && p === pos) return true;
							const [r, c] = at(lines[l], p);
							return seed === "givens" && givens ? givens[r][c] : board[r][c] !== 0;
						};
						const positions = closeLinePair(value, inSeed);
						if (positions) out.push({
							kind: "reverse-bug-lite",
							eliminated: {
								row,
								col,
								digit
							},
							digits: positions.map((p) => value(0, p)).sort((x, y) => x - y),
							patternCells: positions.flatMap((p) => [at(lines[0], p), at(lines[1], p)]),
							size: positions.length
						});
					}
				}
			}
		}
		return out;
	}
};
/** The smallest closed a/b set containing the seed and (row, col) = digit,
* or null if it needs an unplaced partner or would be all 18 cells. */
function closeDigitPair(board, givens, seed, a, b, row, col, digit) {
	const valueAt = (r, c) => r === row && c === col ? digit : board[r][c];
	const placed = {
		[a]: [
			Array(9).fill(null),
			Array(9).fill(null),
			Array(9).fill(null)
		],
		[b]: [
			Array(9).fill(null),
			Array(9).fill(null),
			Array(9).fill(null)
		]
	};
	const queue = [];
	for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
		const v = valueAt(r, c);
		if (v !== a && v !== b) continue;
		const slots = [
			r,
			c,
			boxOf(r, c)
		];
		for (let kind = 0; kind < 3; kind++) {
			if (placed[v][kind][slots[kind]]) return null;
			placed[v][kind][slots[kind]] = [r, c];
		}
		if (r === row && c === col || (seed === "givens" && givens ? givens[r][c] : true)) queue.push([r, c]);
	}
	const inSet = /* @__PURE__ */ new Set();
	for (const [r, c] of queue) inSet.add(r * 9 + c);
	for (let q = 0; q < queue.length; q++) {
		const [r, c] = queue[q];
		const other = valueAt(r, c) === a ? b : a;
		const slots = [
			r,
			c,
			boxOf(r, c)
		];
		for (let kind = 0; kind < 3; kind++) {
			const partner = placed[other][kind][slots[kind]];
			if (!partner) return null;
			const key = partner[0] * 9 + partner[1];
			if (!inSet.has(key)) {
				inSet.add(key);
				queue.push(partner);
			}
		}
	}
	return queue.length < 18 ? queue : null;
}
/** Positions (0-8) of the smallest set, containing every seeded position,
* where both lines are placed and hold the same digits - or null. */
function closeLinePair(value, inSeed) {
	const posOf = [/* @__PURE__ */ new Map(), /* @__PURE__ */ new Map()];
	for (let line = 0; line < 2; line++) for (let pos = 0; pos < 9; pos++) {
		const v = value(line, pos);
		if (v !== 0) {
			if (posOf[line].has(v) || value(1 - line, pos) === v) return null;
			posOf[line].set(v, pos);
		}
	}
	const queue = [];
	const inSet = /* @__PURE__ */ new Set();
	for (let pos = 0; pos < 9; pos++) if (inSeed(0, pos) || inSeed(1, pos)) {
		queue.push(pos);
		inSet.add(pos);
	}
	for (let q = 0; q < queue.length; q++) {
		const pos = queue[q];
		for (let line = 0; line < 2; line++) {
			const v = value(line, pos);
			if (v === 0) return null;
			const partner = posOf[1 - line].get(v);
			if (partner === void 0) return null;
			if (!inSet.has(partner)) {
				inSet.add(partner);
				queue.push(partner);
			}
		}
	}
	return queue.length < 9 ? queue : null;
}
//#endregion
//#region dragon-research/reverse-bug/example.ts
const cells = `189 7 18 2 4 5 3 19 6
6 3 2 1 8 9 4 5 7
19 5 4 3 7 6 129 129 8
1238 1289 1378 5 6 12 129 78 4
124 1249 6 8 12 7 5 1239 39
5 128 178 9 3 4 6 78 12
7 128 138 6 5 12 1289 4 39
123 6 9 4 12 8 7 123 5
1248 1248 5 7 9 3 128 6 12`.split("\n").map((l) => l.trim().split(/\s+/));
const board = cells.map((row) => row.map((s) => s.length === 1 ? Number(s) : 0));
const cands = cells.map((row) => row.map((s) => Array.from({ length: 9 }, (_, d) => s.length > 1 && s.includes(String(d + 1)))));
const f = new SudokuReverseBugFinder();
for (const h of f.find(board, cands, null, "solved")) console.log(h.kind, `${h.eliminated.digit}r${h.eliminated.row + 1}c${h.eliminated.col + 1}`, h.digits, h.patternCells.map(([r, c]) => `r${r + 1}c${c + 1}`).join(" "));
const lb = Array.from({ length: 9 }, () => Array(9).fill(0));
lb[0][0] = 1;
lb[0][3] = 2;
lb[0][6] = 3;
lb[1][0] = 3;
lb[1][3] = 1;
const lc = lb.map((row) => row.map((v) => Array.from({ length: 9 }, () => v === 0)));
for (const h of f.findReverseBugLite(lb, lc, null, "solved")) console.log(h.kind, `${h.eliminated.digit}r${h.eliminated.row + 1}c${h.eliminated.col + 1}`, h.digits);
//#endregion
export {};
