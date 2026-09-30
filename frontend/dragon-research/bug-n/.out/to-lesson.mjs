//#region src/sudoku/boardUtils.ts
const SIZE = 9;
function createEmptyCandidates() {
	return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => Array(SIZE).fill(false)));
}
/** Which digits (1-9) are marked as candidates in a single cell. */
function markedCandidateDigits(cellCandidates) {
	const digits = [];
	for (let i = 0; i < cellCandidates.length; i++) if (cellCandidates[i]) digits.push(i + 1);
	return digits;
}
function createEmptyCandidateColors() {
	return Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => Array(SIZE).fill(null)));
}
//#endregion
//#region src/sudoku/types.ts
/** The colour palette's order (swatch 1 first) - what "Copy Puzzle As-Is"
* stores a painted colour as, so a pasted string keeps each colour's place
* in the palette whatever hex the swatches have been customized to. Must
* match the swatch list in App.tsx; append new colours, never reorder, or
* strings copied earlier paste back in the wrong colours. */
const CANDIDATE_COLOR_ORDER = [
	"skyBlue",
	"paleYellow",
	"lightPink",
	"blue",
	"rust",
	"limeGreen",
	"purple",
	"darkGreen",
	"tan"
];
//#endregion
//#region src/sudoku/PuzzleImporter.ts
const BOARD_SIZE$1 = 9;
const CELL_COUNT = 81;
const STATE_PREFIX = "SCv7_";
const SUPPORTED_ENCODING_TAG = "32";
const BASE32_ALPHABET = "0123456789abcdefghijklmnopqrstuv";
const PAINT_SHAPE_CODES = {
	circle: "c",
	square: "s",
	diamond: "d"
};
/**
* Parses puzzle strings from the sources people paste in:
*  - A plain 81-character givens string (row-major, '0' or '.' empty,
*    '1'-'9' a given digit) - the format Sudoku.Coach and most other sites
*    use for a bare puzzle string
*  - Sudoku.Coach's full "SCv7_32_<payload>" state string, which is
*    base32(deflate(json)) of a state object also carrying the user's
*    entered digits and pencil marks (each candidate digit d is bit d,
*    1-9, of a per-cell integer)
*  - SudokuWiki.org's "text version of the board": an ASCII grid with one
*    or more digits per cell (a single digit is a solved cell, several are
*    its candidates)
*/
var PuzzleImporter = class {
	async import(raw) {
		const trimmed = raw.trim();
		switch (this.detectFormat(trimmed)) {
			case "sudoku-coach": return this.importSudokuCoachState(trimmed);
			case "sudokuwiki": return this.importSudokuWikiBoard(trimmed);
			case "plain": return this.importGivensOnly(trimmed);
		}
	}
	/** Which of the formats above `import` will treat `raw` as. */
	detectFormat(raw) {
		const trimmed = raw.trim();
		if (trimmed.startsWith(STATE_PREFIX)) return "sudoku-coach";
		if (trimmed.includes("|") && trimmed.includes("\n")) return "sudokuwiki";
		return "plain";
	}
	importGivensOnly(raw) {
		const digits = raw.replace(/\s+/g, "");
		if (digits.length !== CELL_COUNT) return {
			ok: false,
			error: `Expected an 81-character puzzle string, got ${digits.length}.`
		};
		if (!/^[0-9.]{81}$/.test(digits)) return {
			ok: false,
			error: "The puzzle string must contain only digits 0-9 or \".\" for empty cells."
		};
		const normalized = digits.replace(/\./g, "0");
		return this.buildResultFromDigitStrings(normalized, "0".repeat(CELL_COUNT), "");
	}
	async importSudokuCoachState(raw) {
		if (typeof DecompressionStream === "undefined") return {
			ok: false,
			error: "This browser cannot decompress Sudoku.Coach puzzle links; try a recent Chrome, Edge, or Firefox."
		};
		const parts = raw.split("_");
		if (parts.length < 3) return {
			ok: false,
			error: "That Sudoku.Coach string looks incomplete."
		};
		const [, tag, ...payloadParts] = parts;
		if (tag !== SUPPORTED_ENCODING_TAG) return {
			ok: false,
			error: `Unsupported Sudoku.Coach puzzle encoding "${tag}_" (only "32_" is supported).`
		};
		let bytes;
		try {
			bytes = this.decodeBase32(payloadParts.join("_"));
		} catch {
			return {
				ok: false,
				error: "Could not decode the Sudoku.Coach puzzle data."
			};
		}
		let json;
		try {
			json = await this.inflate(bytes);
		} catch {
			return {
				ok: false,
				error: "Could not decompress the Sudoku.Coach puzzle data."
			};
		}
		let state;
		try {
			state = JSON.parse(json);
		} catch {
			return {
				ok: false,
				error: "The Sudoku.Coach puzzle data was not valid."
			};
		}
		if (state.gridSize !== void 0 && state.gridSize !== BOARD_SIZE$1) return {
			ok: false,
			error: `Only 9x9 puzzles are supported (this one is ${state.gridSize}x${state.gridSize}).`
		};
		const givenDigits = state.givenDigits ?? "0".repeat(CELL_COUNT);
		const userDigits = state.userDigits ?? "0".repeat(CELL_COUNT);
		if (!/^[0-9]{81}$/.test(givenDigits) || !/^[0-9]{81}$/.test(userDigits)) return {
			ok: false,
			error: "The puzzle's digits were not in the expected format."
		};
		const result = this.buildResultFromDigitStrings(givenDigits, userDigits, state.userCellCandidates ?? "");
		if (result.ok && typeof state.sudokuSolverPaint === "string") result.candidateColors = this.decodePaint(state.sudokuSolverPaint);
		return result;
	}
	/**
	* SudokuWiki's text board has no concept of "given" vs "solved by you" -
	* every solved cell is just shown as its digit - so none of them come in
	* locked; only Sudoku.Coach's own given/user distinction does that.
	*/
	importSudokuWikiBoard(raw) {
		const lines = raw.split("\n").map((line) => line.trim()).filter((line) => line.length > 0 && !line.startsWith("+"));
		if (lines.length !== BOARD_SIZE$1) return {
			ok: false,
			error: `Expected 9 rows in the SudokuWiki board, found ${lines.length}.`
		};
		const board = [];
		const givens = [];
		const candidates = createEmptyCandidates();
		for (let row = 0; row < BOARD_SIZE$1; row++) {
			const tokens = lines[row].replace(/\|/g, " ").trim().split(/\s+/).filter((token) => token.length > 0);
			if (tokens.length !== BOARD_SIZE$1) return {
				ok: false,
				error: `Row ${row + 1} of the SudokuWiki board has ${tokens.length} cells instead of 9.`
			};
			const rowDigits = [];
			const rowGivens = [];
			for (let col = 0; col < BOARD_SIZE$1; col++) {
				const token = tokens[col];
				if (!/^[1-9]+$/.test(token)) return {
					ok: false,
					error: `Cell at row ${row + 1}, column ${col + 1} ("${token}") isn't a valid digit or candidate list.`
				};
				if (token.length === 1) rowDigits.push(Number(token));
				else {
					rowDigits.push(0);
					for (const char of token) candidates[row][col][Number(char) - 1] = true;
				}
				rowGivens.push(false);
			}
			board.push(rowDigits);
			givens.push(rowGivens);
		}
		return {
			ok: true,
			board,
			givens,
			candidates
		};
	}
	buildResultFromDigitStrings(givenDigits, userDigits, cellCandidates) {
		const board = [];
		const givens = [];
		for (let row = 0; row < BOARD_SIZE$1; row++) {
			const rowDigits = [];
			const rowGivens = [];
			for (let col = 0; col < BOARD_SIZE$1; col++) {
				const i = row * BOARD_SIZE$1 + col;
				const given = Number(givenDigits[i]);
				rowDigits.push(given !== 0 ? given : Number(userDigits[i]));
				rowGivens.push(given !== 0);
			}
			board.push(rowDigits);
			givens.push(rowGivens);
		}
		return {
			ok: true,
			board,
			givens,
			candidates: this.parseCoachCandidates(cellCandidates, board)
		};
	}
	parseCoachCandidates(cellCandidates, board) {
		const candidates = createEmptyCandidates();
		if (cellCandidates.length === 0) return candidates;
		const values = cellCandidates.split("-").map(Number);
		if (values.length !== CELL_COUNT) return candidates;
		for (let row = 0; row < BOARD_SIZE$1; row++) for (let col = 0; col < BOARD_SIZE$1; col++) {
			if (board[row][col] !== 0) continue;
			const value = values[row * BOARD_SIZE$1 + col];
			for (let digit = 1; digit <= 9; digit++) candidates[row][col][digit - 1] = (value & 1 << digit) !== 0;
		}
		return candidates;
	}
	/**
	* Builds a Sudoku.Coach "SCv7_32_<payload>" state string for the current
	* grid - the exact reverse of importSudokuCoachState: the same
	* given/user digit strings and bit-per-digit candidate encoding, JSON-
	* stringified, deflated, and base32-encoded. With `candidateColors`, the
	* paint rides along in an extra key only this app reads.
	*/
	async exportToSudokuCoachState(board, givens, candidates, candidateColors) {
		let givenDigits = "";
		let userDigits = "";
		for (let row = 0; row < BOARD_SIZE$1; row++) for (let col = 0; col < BOARD_SIZE$1; col++) {
			const value = board[row][col];
			givenDigits += givens[row][col] ? String(value) : "0";
			userDigits += !givens[row][col] && value !== 0 ? String(value) : "0";
		}
		const cellValues = [];
		for (let row = 0; row < BOARD_SIZE$1; row++) for (let col = 0; col < BOARD_SIZE$1; col++) {
			let value = 0;
			if (board[row][col] === 0) for (const digit of markedCandidateDigits(candidates[row][col])) value |= 1 << digit;
			cellValues.push(value);
		}
		const state = {
			gridSize: BOARD_SIZE$1,
			givenDigits,
			userDigits,
			userCellCandidates: cellValues.join("-")
		};
		const paint = candidateColors ? this.encodePaint(board, candidates, candidateColors) : "";
		if (paint) state.sudokuSolverPaint = paint;
		const json = JSON.stringify(state);
		const compressed = await this.deflateCompress(json);
		return `${STATE_PREFIX}${SUPPORTED_ENCODING_TAG}_${this.encodeBase32(compressed)}`;
	}
	/** One "-"-separated entry per painted candidate: its index
	* (cell * 9 + digit - 1), ":", then each layer as its 1-based place in
	* CANDIDATE_COLOR_ORDER plus a shape letter - "40:4c" is r5c5's 5 in
	* swatch 4 as a circle, "40:4c1s" the same split with swatch 1 as a
	* square. Palette positions rather than hex, so a pasted string comes
	* back in the same swatches, whatever colours they've been set to.
	* Paint on a candidate that isn't marked is left out, as commitGrid would
	* drop it anyway. */
	encodePaint(board, candidates, colors) {
		const entries = [];
		for (let row = 0; row < BOARD_SIZE$1; row++) for (let col = 0; col < BOARD_SIZE$1; col++) {
			if (board[row][col] !== 0) continue;
			for (let i = 0; i < BOARD_SIZE$1; i++) {
				const paint = colors[row][col][i];
				if (!paint || !candidates[row][col][i]) continue;
				const layers = paint.map((layer) => `${CANDIDATE_COLOR_ORDER.indexOf(layer.color) + 1}${PAINT_SHAPE_CODES[layer.shape]}`);
				entries.push(`${(row * BOARD_SIZE$1 + col) * BOARD_SIZE$1 + i}:${layers.join("")}`);
			}
		}
		return entries.join("-");
	}
	/** The reverse of encodePaint. Lenient: an entry it can't read is skipped
	* rather than failing the whole import - the digits and marks matter more
	* than the paint. */
	decodePaint(text) {
		const colors = createEmptyCandidateColors();
		const shapeOf = new Map(Object.entries(PAINT_SHAPE_CODES).map(([shape, code]) => [code, shape]));
		for (const entry of text.split("-")) {
			const match = /^(\d+):((?:\d+[a-z]){1,2})$/.exec(entry);
			if (!match) continue;
			const index = Number(match[1]);
			if (index >= 729) continue;
			const layers = [];
			for (const [, place, code] of match[2].matchAll(/(\d+)([a-z])/g)) {
				const color = CANDIDATE_COLOR_ORDER[Number(place) - 1];
				const shape = shapeOf.get(code);
				if (color && shape) layers.push({
					color,
					shape
				});
			}
			if (layers.length === 0) continue;
			const paint = layers.length === 1 ? [layers[0]] : [layers[0], layers[1]];
			const cell = Math.floor(index / BOARD_SIZE$1);
			colors[Math.floor(cell / BOARD_SIZE$1)][cell % BOARD_SIZE$1][index % BOARD_SIZE$1] = paint;
		}
		return colors;
	}
	async deflateCompress(text) {
		const bytes = new TextEncoder().encode(text);
		const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
		return new Uint8Array(await new Response(stream).arrayBuffer());
	}
	/** The exact reverse of decodeBase32 below - same unpadded base32hex
	* bit-packing (5 bytes -> 8 characters), with the same shortened final
	* group (4/3/2/1 leftover bytes -> 7/5/4/2 characters, no padding). */
	encodeBase32(bytes) {
		let result = "";
		for (let i = 0; i < bytes.length; i += 5) {
			const b0 = bytes[i] ?? 0;
			const b1 = bytes[i + 1] ?? 0;
			const b2 = bytes[i + 2] ?? 0;
			const b3 = bytes[i + 3] ?? 0;
			const b4 = bytes[i + 4] ?? 0;
			const remaining = bytes.length - i;
			const c = [
				b0 >> 3,
				(b0 & 7) << 2 | b1 >> 6,
				b1 >> 1 & 31,
				(b1 & 1) << 4 | b2 >> 4,
				(b2 & 15) << 1 | b3 >> 7,
				b3 >> 2 & 31,
				(b3 & 3) << 3 | b4 >> 5,
				b4 & 31
			];
			const charCount = remaining >= 5 ? 8 : [
				0,
				2,
				4,
				5,
				7
			][remaining];
			for (let k = 0; k < charCount; k++) result += BASE32_ALPHABET[c[k]];
		}
		return result;
	}
	decodeBase32(text) {
		const reverse = /* @__PURE__ */ new Uint8Array(256);
		for (let i = 0; i < 32; i++) reverse[BASE32_ALPHABET.charCodeAt(i)] = i;
		const byteLength = Math.floor(text.length * .625);
		const bytes = new Uint8Array(byteLength);
		let p = 0;
		for (let i = 0; i < text.length; i += 8) {
			const c = [];
			for (let k = 0; k < 8; k++) c.push(reverse[text.charCodeAt(i + k)] ?? 0);
			bytes[p++] = c[0] << 3 | c[1] >> 2;
			bytes[p++] = (c[1] & 3) << 6 | c[2] << 1 | c[3] >> 4;
			bytes[p++] = (c[3] & 15) << 4 | c[4] >> 1;
			bytes[p++] = (c[4] & 1) << 7 | c[5] << 2 | c[6] >> 3;
			bytes[p++] = (c[6] & 7) << 5 | c[7];
		}
		return bytes;
	}
	async inflate(bytes) {
		const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
		const buffer = await new Response(stream).arrayBuffer();
		return new TextDecoder().decode(buffer);
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
function classifyUnitKind(cells) {
	if (cells.every(([r]) => r === cells[0][0])) return "row";
	if (cells.every(([, c]) => c === cells[0][1])) return "column";
	return "box";
}
function sees(a, b) {
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
*   candidate appearing three times in one of the cell's units (the classic
*   count, kept exactly as the original BUG+1 finder did it).
* - BUG+2/BUG+3: one of the N BUG candidates is true, so any candidate that
*   can't be true alongside each of them goes - in practice the shared BUG
*   digit in every cell that sees all N tri-value cells (the user's example:
*   2 in r2c2 {1,2,8} and r8c9 {1,2,6}, so r8c2, which sees both, isn't 2).
*   A digit the tri-value cells merely share is NOT enough: 1 is in both of
*   those cells too, but it isn't a BUG candidate, and a cell seeing both
*   can still be 1.
*
* For N >= 2 the BUG digits are found by trying every choice of one digit
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
		return triValue.length === 1 ? this.findBugPlusOne(board, candidates, triValue[0]) : this.findBugPlusMany(board, candidates, triValue);
	}
	/** The original BUG+1 rule, unchanged: the first of the cell's units
	* (row, column, box order of sudokuUnits) showing one of its candidates
	* three times names its solution. */
	findBugPlusOne(board, candidates, tri) {
		const [row, col] = tri.cell;
		for (const unit of sudokuUnits()) {
			if (!unit.some(([r, c]) => r === row && c === col)) continue;
			for (const digit of tri.digits) if (unit.filter(([r, c]) => board[r][c] === 0 && candidates[r][c][digit - 1]).length === 3) return {
				n: 1,
				cells: [{
					cell: tri.cell,
					candidates: tri.digits,
					bugDigit: digit,
					unit,
					unitKind: classifyUnitKind(unit)
				}],
				solved: {
					row,
					col,
					digit
				},
				eliminations: []
			};
		}
		return null;
	}
	findBugPlusMany(board, candidates, triValue) {
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
			const eliminations = this.eliminationsFor(board, candidates, bugCandidates);
			if (eliminations.length === 0) continue;
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
						unitKind: unit ? classifyUnitKind(unit) : null
					};
				}),
				solved: null,
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
				if (bugCandidates.every(({ cell: [r, c], digit: d }) => r === row && c === col ? digit !== d : digit === d && sees([row, col], [r, c]))) out.push({
					row,
					col,
					digit
				});
			}
		}
		return out;
	}
};
//#endregion
//#region dragon-research/bug-n/to-lesson.ts
const result = await new PuzzleImporter().import(process.argv[2]);
if (!result.ok) throw new Error(result.error);
const { board, candidates } = result;
const removed = [];
for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) for (let d = 1; d <= 9; d++) {
	if (board[r][c] === 0 && SudokuRules.isSafe(board, r, c, d) && !candidates[r][c][d - 1]) removed.push(`r${r + 1}c${c + 1}-${d}`);
	if (board[r][c] === 0 && !SudokuRules.isSafe(board, r, c, d) && candidates[r][c][d - 1]) console.log(`extra mark ${d}r${r + 1}c${c + 1}`);
}
console.log(board.flat().join(""));
console.log(JSON.stringify(removed.join(" ")));
console.log(JSON.stringify(new SudokuBugPlusNFinder().find(board, candidates)));
//#endregion
export {};
