/** TeaVM's loader for a WebAssembly GC module (see variant-rating/README.md
 * at the repo root). Rejects where the browser has no WebAssembly GC. */
export function load(
  path: string,
  options?: object,
): Promise<{
  exports: {
    rateVariant(givens: string, regions: string, cages: string): string
    rateVariantRules(givens: string, regions: string, cages: string, rules: string): string
  }
}>
