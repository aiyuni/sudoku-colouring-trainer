/** TeaVM's loader for a WebAssembly GC module (see se-rating/README.md at
 * the repo root). Rejects where the browser has no WebAssembly GC. */
export function load(path: string, options?: object): Promise<{ exports: { rate(puzzle: string): string } }>
