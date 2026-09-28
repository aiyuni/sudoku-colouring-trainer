// POST /sync: one batch of usage analytics from frontend/src/usageTracking.ts
// - engaged time per area and merged events for one visit, plus (on a page
// load's first batch) the page context. Written to the visitors, visits,
// visit_areas and events tables (migration 0003), never to puzzle_imports.
//
// Everything the client says is treated as untrusted: ids and names are
// length- and charset-checked, times and counts clamped, and timestamps come
// from this Worker's clock (the client only says how long ago an event
// happened), so a bad device clock or a forged body can't write far-off dates.
import { describeDevice, parseHints } from './device'

const MAX_BODY_BYTES = 32 * 1024
const MAX_AREAS = 60
const MAX_EVENTS = 200
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
  return { visitor: b.visitor, visit: b.visit, areas, events, context }
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

  // Respond at once; the writes (one transaction) finish in the background.
  ctx.waitUntil(db.batch(statements).catch((err) => console.error('D1 usage batch failed', err)))
  return 204
}
