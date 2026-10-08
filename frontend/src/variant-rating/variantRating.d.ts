/** The variant rating (SukakuExplainer's solver plus the Killer techniques),
 * compiled to JavaScript - see variant-rating/README.md at the repo root.
 * "ER/EP/ED" in tenths, e.g. "72/15/15". */
export function rateVariant(givens: string, regions: string, cages: string): string
/** The same with the extra rules: 'x' = the X-Sudoku diagonals, 'k' = the
 * Anti-Knight rule, 'xk' = both, '' = neither (then exactly rateVariant). */
export function rateVariantRules(givens: string, regions: string, cages: string, rules: string): string
