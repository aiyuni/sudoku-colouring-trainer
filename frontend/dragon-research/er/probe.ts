import { PuzzleImporter } from '../../src/sudoku/PuzzleImporter'
import { SudokuShortAicFinder, classifyShortAic, aicChainText, findEmptyRectangleIntersections, findRectangleEliminations } from '../../src/sudoku/SudokuShortAicFinder'
const S = 'SCv7_32_f2e5ajabdp1j225shfbk26jvo0sdnt067l0q8pptb65b4i6i5pdfbrm5n28hkc0ogq0vi3nrdlmevotbgthjn13tfjrenmuoovhht3i16d81le0maho6t2mob19sbd082kmcn306kccfc1ucbalg4bdi9ie6adn120vetvbmtabsnqbsrn37cvnk542052ci11subm8h7iovvu3ial56apj64574sn8jifq10ft1gmp12oqh3ubelipm9lf98gkssurbbm9o94khknd0qjm6snd2p7ft73fjrb2r9vinfm29unro3l5ou'
const r = await new PuzzleImporter().import(S)
if (!r.ok) throw new Error(r.error)
for (const a of new SudokuShortAicFinder().findShortAics(r.board, r.candidates))
  if (classifyShortAic(a) === 'single-digit') console.log(a.pattern ?? '(unnamed)', '|', aicChainText(a.nodes), '=>', a.eliminations.map((e) => `${e.digit}r${e.row + 1}c${e.col + 1}`).join(','), '|', a.patternText)
console.log('ERIs:', findEmptyRectangleIntersections(r.board, r.candidates).filter((e) => e.digit === 2).map((e) => `box${e.box + 1} r${e.row + 1}c${e.col + 1} (${e.boxCells.length})`).join('; '))
console.log('RE:', findRectangleEliminations(r.board, r.candidates).map((x) => `${x.elimination.digit}r${x.elimination.row + 1}c${x.elimination.col + 1} hinge r${x.hinge[0] + 1}c${x.hinge[1] + 1} box${x.box + 1}`).join('; '))
