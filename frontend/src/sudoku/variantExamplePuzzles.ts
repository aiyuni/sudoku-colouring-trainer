import type { SudokuConstraints } from './SudokuConstraints'
import type { Board } from './types'

/**
 * Published X-Sudoku and Anti-Knight puzzles, for the Variant page's Puzzle
 * menu ("Example ...") beside the random generator. Every one was checked
 * before it went in - exactly one solution under its rule, with this
 * project's own solver - and `npm run test:variants` checks them all again.
 * `classicSolutions` is what the same givens have as a plain Sudoku (2 = two
 * or more): nearly all have several, i.e. the extra rule is really needed.
 *
 * Sources:
 *  - X-Sudoku: the example list of SudokuWiki's X-Sudoku solver
 *    (sudokuwiki.org/sudokux.aspx, `gexSDX` in its script), with the site's
 *    own label for each (the technique it shows off, or a grade).
 *  - Anti-Knight: sudokutodo.com/cat/anti-knight's printable sheets. They
 *    are images, read with this app's OCR (dragon-research/variants/
 *    read-ak-images.ts); only sheets whose reading has exactly one solution
 *    under the Anti-Knight rule were kept (10 of the 18 - the rest were
 *    misread somewhere and are simply left out, not corrected by hand).
 */
export interface VariantExamplePuzzle {
  kind: 'x-sudoku' | 'anti-knight'
  /** 81 digits, 0 = empty. */
  givens: string
  /** Where it is from and what the source calls it. */
  label: string
  classicSolutions: 1 | 2
}

const x = (label: string, givens: string): VariantExamplePuzzle => ({ kind: 'x-sudoku', label: `SudokuWiki: ${label}`, classicSolutions: 2, givens })
const knight = (label: string, classicSolutions: 1 | 2, givens: string): VariantExamplePuzzle => ({
  kind: 'anti-knight',
  label: `SudokuTodo: ${label}`,
  classicSolutions,
  givens,
})

export const VARIANT_EXAMPLE_PUZZLES: readonly VariantExamplePuzzle[] = [
  x('18 clue moderate', '400805200000000000080070000000208907000000004105300000000000010000000000001007006'),
  x('12 clue tough', '000000010000000200030000405000000000000000000000006000000070000602000080000340000'),
  x('Tough Strategies', '700020080000000900000309051000070000008450100000060000000500000000000000010080002'),
  x('Naked Quad', '903070000260000000040080090004300000000000000000904100080000070000000086001060905'),
  x('X-Wing x2', '000601085680700000000000000000000190000070000046030000000000000020007058360904000'),
  x('Y-Wing x3', '000901400040008000050040080300000008002174300100000007090010020000400030003802000'),
  x('W-Wing', '100000000000804100008007050020040090800000005070060210086400900005209000000000000'),
  x('RE x4', '016000020002006700907000000004601000500080006000209300000000508005900600080000930'),
  x('SwordFish', '010200050009000400000100000000467090001508600090301000000002000008000900070005040'),
  x('Simple Colouring R2', '000800000706005300020309000030050000802030107000080020000102090009500802000008000'),
  x('Simple Colouring R4', '000040307040000080090600040004700038000000000620005709050003070030000060906070000'),
  x('X-Cycle', '000000240040001000080000010600004050000053080030700002070040060000600070065000000'),
  x('UR 1', '000300796376190840490000310600020000000613000000080601130000084504031967067000103'),
  x('XYZ-Wings', '000080000308000006040006890061009000004000100000602570037200040600000903000060000'),
  x('WXYZ-Wing', '009000400130000592000000000000000006000080000400000070000009000006030051021000700'),
  x('Extreme Extreme', '000007002230060000700000000000000000902000503000600000000000005000083006504700000'),
  x('Unsolveable', '000378000000104000000000000930000054100030002420000013000000000000801000000596000'),
  knight('Easy #1', 1, '518060043097415802460000070756934208009107436100086000600803190920600384831009620'),
  knight('Easy #4', 2, '126050498830604250005810703042100806370968524008000009004370000713586942509001307'),
  knight('Easy #6', 2, '840621375001954008050308014128060000734000269965207080207096843583040196400003000'),
  knight('Easy #9', 2, '543670890000900042820043756290734108000589200380216970000405600400890523002301489'),
  knight('Easy #20', 1, '006812037832074519471500028710000900620947153040008702004285076500400091003090845'),
  knight('Medium #2', 2, '600107000000609700500802609102000063003004087458006000000000904390020800000493025'),
  knight('Medium #3', 2, '000068004000104290000072005215003000000640000040280000004800003639017802827000019'),
  knight('Medium #4', 2, '000410089004082700000005010090003801000100090020890007005000108480500936930708004'),
  knight('Medium #7', 2, '041700050050004018690210030009401500105000000402070091926000080000000100804052070'),
  knight('Medium #9', 2, '030004000000009001000607548390000250500008000600370004163040000450906300089053076'),
]

export function exampleConstraints(kind: VariantExamplePuzzle['kind']): SudokuConstraints {
  return { regions: null, cages: [], ...(kind === 'x-sudoku' ? { diagonals: true } : { antiKnight: true }) }
}

export function exampleBoard(example: VariantExamplePuzzle): Board {
  return Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) => Number(example.givens[row * 9 + col])))
}

/** A random example of the kind, other than `not` when there is a choice (so
 * asking twice in a row gives a new puzzle). */
export function pickVariantExample(
  kind: VariantExamplePuzzle['kind'],
  not: string | null = null,
  random: () => number = Math.random,
): VariantExamplePuzzle {
  const all = VARIANT_EXAMPLE_PUZZLES.filter((example) => example.kind === kind)
  const choices = all.length > 1 ? all.filter((example) => example.givens !== not) : all
  return choices[Math.floor(random() * choices.length)]
}
