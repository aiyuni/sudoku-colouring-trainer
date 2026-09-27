// Records every puzzle import from the frontend into D1.
//
// The frontend only ever sends { puzzle, importType, sourceFormat } - the
// timestamp, country and validity are all decided here, so a client can't
// forge them and the page never holds a credential (the D1 binding lives
// only on this Worker). There is deliberately no read endpoint: the data is
// only reachable through `wrangler d1 execute` / the Cloudflare dashboard.
import { SudokuSolver } from '../../frontend/src/sudoku/SudokuSolver'

interface Env {
  DB: D1Database
  ALLOWED_ORIGINS: string
}

type ImportType = 'ocr' | 'string'

const SOURCE_FORMATS = new Set(['plain', 'sudoku-coach', 'sudokuwiki'])
const MAX_BODY_BYTES = 1024
// Fewer than 17 clues can never have a unique solution, so skip the solver
// (same shortcut App.tsx takes).
const MIN_UNIQUE_SOLUTION_CLUES = 17

const solver = new SudokuSolver()

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = request.headers.get('Origin') ?? ''
    const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    const cors: Record<string, string> = allowed.includes(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      : {}

    const url = new URL(request.url)
    if (url.pathname !== '/import') {
      return new Response(null, { status: 404 })
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Max-Age': '86400' },
      })
    }
    if (request.method !== 'POST') {
      return new Response(null, { status: 405, headers: cors })
    }
    // sendBeacon always sends an Origin header on cross-origin POSTs, so a
    // missing/unknown one means it didn't come from our page.
    if (!allowed.includes(origin)) {
      return new Response(null, { status: 403 })
    }

    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) {
      return new Response(null, { status: 413, headers: cors })
    }
    const parsed = parseBody(text)
    if (!parsed) {
      return new Response(null, { status: 400, headers: cors })
    }

    const board = toBoard(parsed.puzzle)
    const clueCount = parsed.puzzle.replace(/0/g, '').length
    const solveStatus = clueCount < MIN_UNIQUE_SOLUTION_CLUES ? 'multiple' : solver.solve(board).status
    const country = (request.cf?.country as string | undefined) ?? request.headers.get('CF-IPCountry')

    // Respond immediately; the insert finishes in the background.
    ctx.waitUntil(
      env.DB.prepare(
        `INSERT INTO puzzle_imports
           (puzzle, import_type, source_format, is_valid_puzzle, solve_status, clue_count, imported_at, country)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          parsed.puzzle,
          parsed.importType,
          parsed.sourceFormat,
          solveStatus === 'solved' ? 1 : 0,
          solveStatus,
          clueCount,
          new Date().toISOString(),
          country ?? null,
        )
        .run()
        .catch((err) => console.error('D1 insert failed', err)),
    )
    return new Response(null, { status: 204, headers: cors })
  },
} satisfies ExportedHandler<Env>

function parseBody(
  text: string,
): { puzzle: string; importType: ImportType; sourceFormat: string | null } | null {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const { puzzle, importType, sourceFormat } = body as Record<string, unknown>
  if (typeof puzzle !== 'string' || !/^[0-9]{81}$/.test(puzzle)) {
    return null
  }
  if (importType !== 'ocr' && importType !== 'string') {
    return null
  }
  let format: string | null = null
  if (importType === 'string') {
    if (typeof sourceFormat !== 'string' || !SOURCE_FORMATS.has(sourceFormat)) {
      return null
    }
    format = sourceFormat
  }
  return { puzzle, importType, sourceFormat: format }
}

function toBoard(puzzle: string): number[][] {
  return Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => Number(puzzle[r * 9 + c])),
  )
}
