// The user's W-Wing example (2026-09-30): expects one W-Wing eliminating
// 4 from r1c7, r2c7, r3c7, r8c9, r9c9 via the remote pair {1,4} in r1c9, r8c7.
import { PuzzleImporter } from '../../src/sudoku/PuzzleImporter'
import { SudokuShortAicFinder, classifyShortAic, aicChainText } from '../../src/sudoku/SudokuShortAicFinder'
import { buildAicInstance } from '../../src/techniqueEngine'
const S = 'SCv7_32_f2ear3a1db1l0324tvpde68op69bsvlmt46nl0k0hnsh1ci8q8n5ksnnc8to85liti63dkgr67fmbfnku6unujb5rtr6brkvqfsqrjvteomvm4j4eep94r2k5rpe88144lmcgljtn55fapn1lml0b6adrmi4c3ib7irbfi5mlhilefleqfiljg7vqqhu0c4t9q3u6ufcsfojdba5q201g222ld136g2889e23fg0d7t810oolb0gjcasbsr4ca7196s6tptvqp46g624bv0crcme5cdh7tgr9f1ca44u20pohh9jte381l1cusfsjeav40'
const r = await new PuzzleImporter().import(S)
if (!r.ok) throw new Error(r.error)
for (const a of new SudokuShortAicFinder().findShortAics(r.board, r.candidates)) {
  if (classifyShortAic(a) !== 'general') continue
  console.log(a.pattern ?? '(unnamed)', '|', aicChainText(a.nodes), '=>', a.eliminations.map((e) => `${e.digit}r${e.row + 1}c${e.col + 1}`).join(','))
  if (a.pattern === 'W-Wing') console.log('   ', buildAicInstance(a, 'short-aic', a.pattern).notation, '|', a.patternText)
}
