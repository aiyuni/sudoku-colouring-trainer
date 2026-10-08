// POST /sync: one batch of usage analytics from frontend/src/usageTracking.ts
// - engaged time per area and merged events for one visit, plus (on a page
// load's first batch) the page context. Written to the visitors, visits,
// visit_areas and events tables (migration 0003), never to puzzle_imports.
// Answered practice-quiz questions ride along in the same batch (`quiz`) and
// go to quiz_answers (migration 0004); Saved Puzzles actions (`saves`) go to
// saved_puzzle_events (migration 0005).
//
// Everything the client says is treated as untrusted: ids and names are
// length- and charset-checked, times and counts clamped, and timestamps come
// from this Worker's clock (the client only says how long ago an event
// happened), so a bad device clock or a forged body can't write far-off dates.
import { describeDevice, parseHints } from './device'

const MAX_BODY_BYTES = 32 * 1024
const MAX_AREAS = 60
const MAX_EVENTS = 200
const MAX_QUIZ_ANSWERS = 60
// Saved Puzzles actions (frontend/src/savedPuzzles.ts). A save carries the
// whole position as import-box text, 1-3 KB; the client sends each action in
// a batch of its own, so the body limit above is never the constraint.
const MAX_SAVED_PUZZLE_ACTIONS = 8
const SAVED_PUZZLE_ACTIONS = new Set(['save', 'update', 'open', 'delete'])
const MAX_SAVED_PUZZLE_TEXT_LENGTH = 4000
const MAX_SAVED_STATE_TEXT_LENGTH = 12000
const QUIZ_ID_PATTERN = /^[a-z0-9][a-z0-9/-]{0,79}$/
const QUIZ_KINDS = new Set(['choice', 'cells', 'candidates', 'colour'])
const MAX_QUIZ_QUESTIONS = 50
const MAX_QUIZ_QUESTION_MS = 60 * 60_000
// A batch covers about a minute; the last one before a tab closes can hold
// longer (a flush is skipped while hidden). Anything above this is bogus.
const MAX_AREA_MS = 2 * 60 * 60_000
const MAX_EVENT_AGE_MS = 24 * 60 * 60_000
const MAX_USER_AGENT_LENGTH = 512
const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/
const BOT_USER_AGENT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|phantom|puppeteer|playwright|selenium/i

interface UsageEvent {
  category: string
  name: string
  label: string | null
  value: number | null
  count: number
  age: number
}

interface QuizAnswer {
  quiz: string
  run: string
  question: string
  kind: string
  index: number
  total: number
  misses: number
  revealed: number
  ms: number | null
  age: number
}

interface SavedPuzzleAction {
  id: string
  action: string
  saveId: string
  name: string
  page: string
  variant: string
  puzzle: string | null
  state: string | null
  filled: number | null
  rating: string | null
  age: number
}

interface UsageContext {
  referrer: string | null
  campaign: string | null
  language: string | null
  timezone: string | null
  screen: string | null
  viewport: string | null
  standalone: number | null
  darkMode: number | null
  webdriver: boolean
  device: unknown
}

interface UsageBatch {
  visitor: string
  visit: string
  areas: Array<[string, number]>
  events: UsageEvent[]
  quiz: QuizAnswer[]
  saves: SavedPuzzleAction[]
  context: UsageContext | null
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null
  }
  // Printable only (keeps the '›' separator and accented labels).
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
  return clean.length > 0 ? clean : null
}

function flag(value: unknown): number | null {
  return typeof value === 'boolean' ? (value ? 1 : 0) : null
}

function wholeNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? Math.round(value) : null
}

function parseQuizAnswers(raw: unknown): QuizAnswer[] {
  const answers: QuizAnswer[] = []
  if (!Array.isArray(raw)) {
    return answers
  }
  for (const item of raw.slice(0, MAX_QUIZ_ANSWERS)) {
    if (typeof item !== 'object' || item === null) continue
    const a = item as Record<string, unknown>
    const question = text(a.question, 80)
    const index = wholeNumber(a.index, 0, MAX_QUIZ_QUESTIONS - 1)
    const total = wholeNumber(a.total, 1, MAX_QUIZ_QUESTIONS)
    const misses = wholeNumber(a.misses, 0, 999)
    if (
      typeof a.quiz !== 'string' ||
      !QUIZ_ID_PATTERN.test(a.quiz) ||
      typeof a.run !== 'string' ||
      !ID_PATTERN.test(a.run) ||
      typeof a.kind !== 'string' ||
      !QUIZ_KINDS.has(a.kind) ||
      !question ||
      index === null ||
      total === null ||
      index >= total ||
      misses === null
    ) {
      continue
    }
    answers.push({
      quiz: a.quiz,
      run: a.run,
      question,
      kind: a.kind,
      index,
      total,
      misses,
      revealed: a.revealed === true ? 1 : 0,
      ms: wholeNumber(a.ms, 0, MAX_QUIZ_QUESTION_MS),
      age: typeof a.age === 'number' && Number.isFinite(a.age) ? Math.max(0, Math.min(a.age, MAX_EVENT_AGE_MS)) : 0,
    })
  }
  return answers
}

function parseSavedPuzzleActions(raw: unknown): SavedPuzzleAction[] {
  const actions: SavedPuzzleAction[] = []
  if (!Array.isArray(raw)) {
    return actions
  }
  for (const item of raw.slice(0, MAX_SAVED_PUZZLE_ACTIONS)) {
    if (typeof item !== 'object' || item === null) continue
    const a = item as Record<string, unknown>
    const name = text(a.name, 100)
    if (
      typeof a.id !== 'string' ||
      !ID_PATTERN.test(a.id) ||
      typeof a.saveId !== 'string' ||
      !ID_PATTERN.test(a.saveId) ||
      typeof a.action !== 'string' ||
      !SAVED_PUZZLE_ACTIONS.has(a.action) ||
      (a.page !== 'classic' && a.page !== 'variant') ||
      !name
    ) {
      continue
    }
    // Whole or not at all: a cut-off puzzle string can't be loaded.
    const whole = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? text(value, max) : null)
    actions.push({
      id: a.id,
      action: a.action,
      saveId: a.saveId,
      name,
      page: a.page,
      variant: text(a.variant, 60) ?? (a.page === 'classic' ? 'Classic' : 'Variant'),
      puzzle: whole(a.puzzle, MAX_SAVED_PUZZLE_TEXT_LENGTH),
      state: a.action === 'save' || a.action === 'update' ? whole(a.state, MAX_SAVED_STATE_TEXT_LENGTH) : null,
      filled: wholeNumber(a.filled, 0, 81),
      rating: text(a.rating, 80),
      age: typeof a.age === 'number' && Number.isFinite(a.age) ? Math.max(0, Math.min(a.age, MAX_EVENT_AGE_MS)) : 0,
    })
  }
  return actions
}

function parseBatch(raw: string): UsageBatch | null {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) {
    return null
  }
  const b = body as Record<string, unknown>
  if (typeof b.visitor !== 'string' || !ID_PATTERN.test(b.visitor) || typeof b.visit !== 'string' || !ID_PATTERN.test(b.visit)) {
    return null
  }

  const areas: Array<[string, number]> = []
  if (typeof b.areas === 'object' && b.areas !== null) {
    for (const [name, ms] of Object.entries(b.areas as Record<string, unknown>).slice(0, MAX_AREAS)) {
      const area = text(name, 150)
      if (area && typeof ms === 'number' && Number.isFinite(ms) && ms > 0) {
        areas.push([area, Math.round(Math.min(ms, MAX_AREA_MS))])
      }
    }
  }

  const events: UsageEvent[] = []
  if (Array.isArray(b.events)) {
    for (const item of b.events.slice(0, MAX_EVENTS)) {
      if (typeof item !== 'object' || item === null) continue
      const e = item as Record<string, unknown>
      const category = text(e.category, 40)
      const name = text(e.name, 150)
      if (!category || !name) continue
      events.push({
        category,
        name,
        label: text(e.label, 200),
        value: typeof e.value === 'number' && Number.isFinite(e.value) ? e.value : null,
        count: typeof e.count === 'number' && Number.isFinite(e.count) ? Math.max(1, Math.min(Math.round(e.count), 100_000)) : 1,
        age: typeof e.age === 'number' && Number.isFinite(e.age) ? Math.max(0, Math.min(e.age, MAX_EVENT_AGE_MS)) : 0,
      })
    }
  }

  let context: UsageContext | null = null
  if (typeof b.context === 'object' && b.context !== null) {
    const c = b.context as Record<string, unknown>
    let campaign: string | null = null
    if (typeof c.campaign === 'object' && c.campaign !== null) {
      const entries = Object.entries(c.campaign as Record<string, unknown>)
        .slice(0, 5)
        .map(([k, v]) => [text(k, 20), text(v, 100)] as const)
        .filter(([k, v]) => k && v)
      campaign = entries.length ? JSON.stringify(Object.fromEntries(entries)) : null
    }
    context = {
      referrer: text(c.referrer, 300),
      campaign,
      language: text(c.language, 35),
      timezone: text(c.timezone, 64),
      screen: text(c.screen, 30),
      viewport: text(c.viewport, 30),
      standalone: flag(c.standalone),
      darkMode: flag(c.darkMode),
      webdriver: c.webdriver === true,
      device: c.device,
    }
  }
  return { visitor: b.visitor, visit: b.visit, areas, events, quiz: parseQuizAnswers(b.quiz), saves: parseSavedPuzzleActions(b.saves), context }
}

export async function handleSync(request: Request, db: D1Database, ctx: ExecutionContext): Promise<number> {
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) {
    return 413
  }
  const batch = parseBatch(raw)
  if (!batch) {
    return 400
  }

  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const cf = (request.cf ?? {}) as { country?: string; region?: string; city?: string }
  const country = cf.country ?? request.headers.get('CF-IPCountry')
  const userAgent = (request.headers.get('User-Agent') ?? '').slice(0, MAX_USER_AGENT_LENGTH)
  const c = batch.context
  const device = c ? describeDevice(userAgent, parseHints(c.device)) : null
  const isBot = BOT_USER_AGENT.test(userAgent) || c?.webdriver === true ? 1 : 0
  const engagedMs = batch.areas.reduce((sum, [, ms]) => sum + ms, 0)

  const statements: D1PreparedStatement[] = []
  // Visitor first (context fields only overwrite when this batch has them).
  statements.push(
    db
      .prepare(
        `INSERT INTO visitors (visitor_id, first_seen_at, last_seen_at, country, region, city, device_type, device, os,
                               os_version, browser, browser_version, language, timezone, is_bot)
         VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT (visitor_id) DO UPDATE SET
           last_seen_at = excluded.last_seen_at,
           country = COALESCE(excluded.country, visitors.country),
           region = COALESCE(excluded.region, visitors.region),
           city = COALESCE(excluded.city, visitors.city),
           device_type = COALESCE(excluded.device_type, visitors.device_type),
           device = COALESCE(excluded.device, visitors.device),
           os = COALESCE(excluded.os, visitors.os),
           os_version = COALESCE(excluded.os_version, visitors.os_version),
           browser = COALESCE(excluded.browser, visitors.browser),
           browser_version = COALESCE(excluded.browser_version, visitors.browser_version),
           language = COALESCE(excluded.language, visitors.language),
           timezone = COALESCE(excluded.timezone, visitors.timezone),
           is_bot = MAX(visitors.is_bot, excluded.is_bot)`,
      )
      .bind(
        batch.visitor,
        nowIso,
        c ? (country ?? null) : null,
        c ? (cf.region ?? null) : null,
        c ? (cf.city ?? null) : null,
        device?.deviceType ?? null,
        device?.device ?? null,
        device?.os ?? null,
        device?.osVersion ?? null,
        device?.browser ?? null,
        device?.browserVersion ?? null,
        c?.language ?? null,
        c?.timezone ?? null,
        isBot,
      ),
  )
  // The visit. visit_number = this visitor's earlier visits + 1, fixed at
  // insert. The WHERE keeps a (forged) batch from touching another
  // visitor's visit.
  statements.push(
    db
      .prepare(
        `INSERT INTO visits (visit_id, visitor_id, visit_number, started_at, last_seen_at, engaged_ms, page_loads,
                             country, region, city, device_type, device, os, os_version, browser, browser_version,
                             user_agent, language, timezone, screen, viewport, referrer, campaign, standalone, dark_mode, is_bot)
         VALUES (?1, ?2, (SELECT COUNT(*) + 1 FROM visits WHERE visitor_id = ?2), ?3, ?3, ?4, ?5,
                 ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)
         ON CONFLICT (visit_id) DO UPDATE SET
           last_seen_at = excluded.last_seen_at,
           engaged_ms = visits.engaged_ms + excluded.engaged_ms,
           page_loads = visits.page_loads + excluded.page_loads,
           is_bot = MAX(visits.is_bot, excluded.is_bot)
         WHERE visits.visitor_id = excluded.visitor_id`,
      )
      .bind(
        batch.visit,
        batch.visitor,
        nowIso,
        engagedMs,
        c ? 1 : 0,
        c ? (country ?? null) : null,
        c ? (cf.region ?? null) : null,
        c ? (cf.city ?? null) : null,
        device?.deviceType ?? null,
        device?.device ?? null,
        device?.os ?? null,
        device?.osVersion ?? null,
        device?.browser ?? null,
        device?.browserVersion ?? null,
        c ? userAgent || null : null,
        c?.language ?? null,
        c?.timezone ?? null,
        c?.screen ?? null,
        c?.viewport ?? null,
        c?.referrer ?? null,
        c?.campaign ?? null,
        c?.standalone ?? null,
        c?.darkMode ?? null,
        isBot,
      ),
  )
  statements.push(
    db
      .prepare(
        `UPDATE visitors SET
           visit_count = (SELECT COUNT(*) FROM visits WHERE visitor_id = ?1),
           total_engaged_ms = total_engaged_ms + ?2
         WHERE visitor_id = ?1`,
      )
      .bind(batch.visitor, engagedMs),
  )
  const areaInsert = db.prepare(
    `INSERT INTO visit_areas (visit_id, visitor_id, area, engaged_ms, first_at, last_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?5 WHERE EXISTS (SELECT 1 FROM visits WHERE visit_id = ?1 AND visitor_id = ?2)
     ON CONFLICT (visit_id, area) DO UPDATE SET
       engaged_ms = visit_areas.engaged_ms + excluded.engaged_ms,
       last_at = excluded.last_at`,
  )
  for (const [area, ms] of batch.areas) {
    statements.push(areaInsert.bind(batch.visit, batch.visitor, area, ms, nowIso))
  }
  const eventInsert = db.prepare(
    `INSERT INTO events (visit_id, visitor_id, occurred_at, category, name, label, value, count)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE EXISTS (SELECT 1 FROM visits WHERE visit_id = ?1 AND visitor_id = ?2)`,
  )
  for (const e of batch.events) {
    statements.push(
      eventInsert.bind(batch.visit, batch.visitor, new Date(now - e.age).toISOString(), e.category, e.name, e.label, e.value, e.count),
    )
  }

  // Quiz answers go in a transaction of their own, after the visit exists:
  // if quiz_answers is missing (this Worker deployed before migration 0004),
  // only they are lost, not the whole usage batch. A resent answer is ignored
  // (UNIQUE run_id + question_index).
  const quizInsert = db.prepare(
    `INSERT OR IGNORE INTO quiz_answers (visit_id, visitor_id, answered_at, quiz_id, run_id, question_id, question_kind,
                                         question_index, question_count, wrong_attempts, first_try, revealed, duration_ms)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
     WHERE EXISTS (SELECT 1 FROM visits WHERE visit_id = ?1 AND visitor_id = ?2)`,
  )
  const quizStatements = batch.quiz.map((a) =>
    quizInsert.bind(
      batch.visit,
      batch.visitor,
      new Date(now - a.age).toISOString(),
      a.quiz,
      a.run,
      a.question,
      a.kind,
      a.index,
      a.total,
      a.misses,
      a.misses === 0 ? 1 : 0,
      a.revealed,
      a.ms,
    ),
  )

  // Saved Puzzles actions, likewise in a transaction of their own (the table
  // is migration 0005). A resent action is ignored (UNIQUE action_id).
  const savedInsert = db.prepare(
    `INSERT OR IGNORE INTO saved_puzzle_events (action_id, visit_id, visitor_id, occurred_at, action, page, variant,
                                                save_id, name, puzzle, state, filled_cells, rating)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
     WHERE EXISTS (SELECT 1 FROM visits WHERE visit_id = ?2 AND visitor_id = ?3)`,
  )
  const savedStatements = batch.saves.map((a) =>
    savedInsert.bind(
      a.id,
      batch.visit,
      batch.visitor,
      new Date(now - a.age).toISOString(),
      a.action,
      a.page,
      a.variant,
      a.saveId,
      a.name,
      a.puzzle,
      a.state,
      a.filled,
      a.rating,
    ),
  )

  // Respond at once; the writes (one transaction) finish in the background.
  ctx.waitUntil(
    db
      .batch(statements)
      .catch((err) => console.error('D1 usage batch failed', err))
      .then(() => (quizStatements.length > 0 ? db.batch(quizStatements) : undefined))
      .catch((err) => console.error('D1 quiz batch failed', err))
      .then(() => (savedStatements.length > 0 ? db.batch(savedStatements) : undefined))
      .catch((err) => console.error('D1 saved puzzle batch failed', err)),
  )
  return 204
}
