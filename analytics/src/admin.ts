// /admin: the private usage dashboard, its JSON API and CSV exports.
//
// Only the site owner can get in: every /admin route needs the ADMIN_PASSWORD
// Worker secret (`npx wrangler secret put ADMIN_PASSWORD`), given either on
// the login form (which sets an HttpOnly, SameSite=Strict session cookie
// signed with that password - changing the password logs every session out)
// or as `Authorization: Bearer <password>` for scripts. With no secret set,
// every /admin route is a plain 404. Password guessing is capped globally:
// after MAX_LOGIN_FAILURES wrong passwords in LOCKOUT_WINDOW_MS, the login
// refuses everything until the window passes.
//
// The page is served from this Worker's own origin, so the dashboard is
// never part of (or linked from) the public site.
import { ADMIN_APP_JS, ADMIN_CSS, adminPageHtml, loginPageHtml } from './adminPage'

export interface AdminEnv {
  DB: D1Database
  ADMIN_PASSWORD?: string
}

const COOKIE_NAME = 'sudoku_admin'
const SESSION_MS = 30 * 24 * 60 * 60_000
const MAX_LOGIN_FAILURES = 10
const LOCKOUT_WINDOW_MS = 15 * 60_000
const LIST_LIMIT = 500
const EXPORT_LIMIT = 100_000

const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
}

function respond(body: BodyInit | null, status: number, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, ...headers } })
}

function json(data: unknown, status = 200): Response {
  return respond(JSON.stringify(data), status, { 'Content-Type': 'application/json; charset=utf-8' })
}

// ---------------------------------------------------------------- auth

const encoder = new TextEncoder()

function base64url(bytes: ArrayBuffer): string {
  let binary = ''
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmacKey(password: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

async function sign(password: string, message: string): Promise<string> {
  return base64url(await crypto.subtle.sign('HMAC', await hmacKey(password), encoder.encode(message)))
}

async function sameSecret(a: string, b: string): Promise<boolean> {
  // Hash first so the comparison is fixed-length and constant-time.
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  return crypto.subtle.timingSafeEqual(ha, hb)
}

async function sessionToken(password: string): Promise<string> {
  const expires = Date.now() + SESSION_MS
  return `${expires}.${await sign(password, `admin-session:${expires}`)}`
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

async function isAuthorized(request: Request, password: string): Promise<boolean> {
  const auth = request.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) {
    return sameSecret(auth.slice(7), password)
  }
  const token = readCookie(request, COOKIE_NAME)
  if (!token) return false
  const [expires, signature] = token.split('.')
  if (!expires || !signature || !(Number(expires) > Date.now())) return false
  return sameSecret(signature, await sign(password, `admin-session:${expires}`))
}

function sessionCookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${COOKIE_NAME}=${value}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`
}

async function handleLogin(request: Request, env: AdminEnv, password: string): Promise<Response> {
  const secure = new URL(request.url).protocol === 'https:'
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS).toISOString()
  const failures = await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_login_failures WHERE at >= ?')
    .bind(since)
    .first<{ n: number }>()
  if ((failures?.n ?? 0) >= MAX_LOGIN_FAILURES) {
    return respond(loginPageHtml('Too many failed attempts. Try again in 15 minutes.'), 429, {
      'Content-Type': 'text/html; charset=utf-8',
    })
  }
  const form = await request.formData().catch(() => null)
  const given = form?.get('password')
  if (typeof given === 'string' && (await sameSecret(given, password))) {
    return respond(null, 303, {
      Location: '/admin',
      'Set-Cookie': sessionCookie(await sessionToken(password), SESSION_MS / 1000, secure),
    })
  }
  await env.DB.batch([
    env.DB.prepare('INSERT INTO admin_login_failures (at) VALUES (?)').bind(new Date().toISOString()),
    env.DB.prepare('DELETE FROM admin_login_failures WHERE at < ?').bind(new Date(Date.now() - 86_400_000).toISOString()),
  ])
  return respond(loginPageHtml('Wrong password.'), 401, { 'Content-Type': 'text/html; charset=utf-8' })
}

// ---------------------------------------------------------------- filters

/** The dashboard's filters, shared by every query: a date range (on the
 * visit's start), one visitor, and whether bots / excluded visitors count. */
interface Filters {
  where: string
  params: unknown[]
  /** Minutes to add to UTC for the viewer's local day/hour buckets. */
  tzShift: string
}

function readFilters(url: URL): Filters {
  const conditions: string[] = []
  const params: unknown[] = []
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const visitor = url.searchParams.get('visitor')
  if (from && !Number.isNaN(Date.parse(from))) {
    conditions.push('v.started_at >= ?')
    params.push(new Date(from).toISOString())
  }
  if (to && !Number.isNaN(Date.parse(to))) {
    conditions.push('v.started_at < ?')
    params.push(new Date(to).toISOString())
  }
  if (visitor) {
    conditions.push('v.visitor_id = ?')
    params.push(visitor)
  }
  if (url.searchParams.get('bots') !== '1') {
    conditions.push('v.is_bot = 0 AND vr.is_bot = 0')
  }
  if (url.searchParams.get('excluded') !== '1' && !visitor) {
    conditions.push('vr.excluded = 0')
  }
  const tz = Math.max(-840, Math.min(840, Math.round(Number(url.searchParams.get('tz')) || 0)))
  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    tzShift: `${tz >= 0 ? '+' : ''}${tz} minutes`,
  }
}

const VISITS = 'visits v JOIN visitors vr ON vr.visitor_id = v.visitor_id'
const AREAS = 'visit_areas a JOIN visits v ON v.visit_id = a.visit_id JOIN visitors vr ON vr.visitor_id = v.visitor_id'
const EVENTS = 'events e JOIN visits v ON v.visit_id = e.visit_id JOIN visitors vr ON vr.visitor_id = v.visitor_id'
const QUIZ = 'quiz_answers q JOIN visits v ON v.visit_id = q.visit_id JOIN visitors vr ON vr.visitor_id = v.visitor_id'

async function all<T = Record<string, unknown>>(db: D1Database, sql: string, params: unknown[]): Promise<T[]> {
  return (await db.prepare(sql).bind(...params).all<T>()).results
}

// ---------------------------------------------------------------- API

async function overview(db: D1Database, f: Filters) {
  const { where, params, tzShift } = f
  const local = (column: string) => `datetime(${column}, '${tzShift}')`
  const dimension = (column: string) =>
    all(db, `SELECT COALESCE(${column}, '(unknown)') AS key, COUNT(DISTINCT v.visitor_id) AS visitors, COUNT(*) AS visits
             FROM ${VISITS} ${where} GROUP BY 1 ORDER BY visitors DESC, visits DESC LIMIT 25`, params)
  const [totals, returning, daily, hours, weekdays, visitNumbers, areas, events, dims] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(DISTINCT v.visitor_id) AS visitors, COUNT(*) AS visits,
                SUM(v.visit_number = 1) AS new_visitors,
                COALESCE(SUM(v.page_loads), 0) AS page_loads,
                COALESCE(SUM(v.engaged_ms), 0) AS engaged_ms,
                COALESCE(AVG(v.engaged_ms), 0) AS avg_engaged_ms,
                COALESCE(AVG((julianday(v.last_seen_at) - julianday(v.started_at)) * 86400000), 0) AS avg_duration_ms,
                SUM(v.engaged_ms < 10000) AS short_visits
         FROM ${VISITS} ${where}`,
      )
      .bind(...params)
      .first(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM (SELECT v.visitor_id FROM ${VISITS} ${where} GROUP BY v.visitor_id HAVING MAX(v.visit_number) > 1)`)
      .bind(...params)
      .first<{ n: number }>(),
    all(db, `SELECT date(${local('v.started_at')}) AS day, COUNT(DISTINCT v.visitor_id) AS visitors, COUNT(*) AS visits,
                    SUM(v.visit_number = 1) AS new_visitors, SUM(v.engaged_ms) AS engaged_ms
             FROM ${VISITS} ${where} GROUP BY 1 ORDER BY 1`, params),
    all(db, `SELECT CAST(strftime('%H', ${local('v.started_at')}) AS INTEGER) AS hour, COUNT(*) AS visits
             FROM ${VISITS} ${where} GROUP BY 1 ORDER BY 1`, params),
    all(db, `SELECT CAST(strftime('%w', ${local('v.started_at')}) AS INTEGER) AS weekday, COUNT(*) AS visits
             FROM ${VISITS} ${where} GROUP BY 1 ORDER BY 1`, params),
    all(db, `SELECT CASE WHEN v.visit_number >= 10 THEN '10+' WHEN v.visit_number >= 5 THEN '5-9' ELSE CAST(v.visit_number AS TEXT) END AS bucket,
                    COUNT(*) AS visits
             FROM ${VISITS} ${where} GROUP BY 1 ORDER BY MIN(v.visit_number)`, params),
    all(db, `SELECT a.area, SUM(a.engaged_ms) AS engaged_ms, COUNT(DISTINCT a.visitor_id) AS visitors, COUNT(*) AS visits
             FROM ${AREAS} ${where} GROUP BY a.area ORDER BY engaged_ms DESC`, params),
    // Labels that are a detail worth splitting by (a setting's new value, a
    // technique, a task outcome) stay; clicks' areas and imports' puzzles
    // would only fragment the counts.
    all(db, `SELECT e.category, e.name, CASE WHEN e.category IN ('setting', 'technique', 'task', 'error') THEN e.label END AS label,
                    SUM(e.count) AS count, COUNT(DISTINCT e.visitor_id) AS visitors, AVG(e.value) AS avg_value
             FROM ${EVENTS} ${where}
             GROUP BY 1, 2, 3 ORDER BY count DESC LIMIT 1000`, params),
    Promise.all([
      dimension('v.country'),
      dimension("v.city || ', ' || v.country"),
      dimension('v.device_type'),
      dimension('v.device'),
      dimension("v.os || COALESCE(' ' || v.os_version, '')"),
      dimension('v.browser'),
      dimension("CASE WHEN v.referrer IS NULL THEN '(direct)' ELSE substr(v.referrer, instr(v.referrer, '//') + 2, instr(substr(v.referrer, instr(v.referrer, '//') + 2) || '/', '/') - 1) END"),
      dimension('v.language'),
      dimension('v.screen'),
    ]),
  ])
  const [country, city, deviceType, device, os, browser, referrer, language, screen] = dims
  return {
    totals: { ...totals, returning_visitors: returning?.n ?? 0 },
    daily,
    hours,
    weekdays,
    visitNumbers,
    areas,
    events,
    audience: { country, city, deviceType, device, os, browser, referrer, language, screen },
  }
}

async function visitorsList(db: D1Database, f: Filters) {
  return all(
    db,
    `SELECT vr.visitor_id, vr.label, vr.excluded, vr.is_bot, vr.first_seen_at, vr.last_seen_at, vr.visit_count,
            vr.total_engaged_ms, vr.country, vr.city, vr.device_type, vr.device, vr.os, vr.browser,
            COUNT(*) AS visits_in_range, SUM(v.engaged_ms) AS engaged_in_range, MAX(v.last_seen_at) AS last_in_range,
            (SELECT COALESCE(SUM(count), 0) FROM events x WHERE x.visitor_id = vr.visitor_id AND x.category = 'import') AS imports,
            (SELECT area FROM visit_areas y WHERE y.visitor_id = vr.visitor_id GROUP BY area ORDER BY SUM(engaged_ms) DESC LIMIT 1) AS top_area
     FROM ${VISITS} ${f.where}
     GROUP BY vr.visitor_id ORDER BY last_in_range DESC LIMIT ${LIST_LIMIT}`,
    f.params,
  )
}

async function visitsList(db: D1Database, f: Filters) {
  return all(
    db,
    `SELECT v.visit_id, v.visitor_id, vr.label, v.visit_number, v.started_at, v.last_seen_at, v.engaged_ms, v.page_loads,
            v.country, v.city, v.device_type, v.device, v.os, v.browser, v.referrer,
            (SELECT area FROM visit_areas y WHERE y.visit_id = v.visit_id ORDER BY engaged_ms DESC LIMIT 1) AS top_area,
            (SELECT COALESCE(SUM(count), 0) FROM events x WHERE x.visit_id = v.visit_id) AS actions
     FROM ${VISITS} ${f.where}
     ORDER BY v.started_at DESC LIMIT ${LIST_LIMIT}`,
    f.params,
  )
}

async function visitDetail(db: D1Database, id: string) {
  const [visit, areas, events] = await Promise.all([
    db.prepare(`SELECT v.*, vr.label FROM ${VISITS} WHERE v.visit_id = ?`).bind(id).first(),
    all(db, 'SELECT area, engaged_ms, first_at, last_at FROM visit_areas WHERE visit_id = ? ORDER BY first_at', [id]),
    all(db, 'SELECT occurred_at, category, name, label, value, count FROM events WHERE visit_id = ? ORDER BY occurred_at, id', [id]),
  ])
  return { visit, areas, events }
}

async function updateVisitor(request: Request, db: D1Database): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { visitor?: unknown; label?: unknown; excluded?: unknown } | null
  if (!body || typeof body.visitor !== 'string') {
    return json({ error: 'visitor required' }, 400)
  }
  if (typeof body.label === 'string' || body.label === null) {
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) || null : null
    await db.prepare('UPDATE visitors SET label = ? WHERE visitor_id = ?').bind(label, body.visitor).run()
  }
  if (typeof body.excluded === 'boolean') {
    await db.prepare('UPDATE visitors SET excluded = ? WHERE visitor_id = ?').bind(body.excluded ? 1 : 0, body.visitor).run()
  }
  return json({ ok: true })
}

// ---------------------------------------------------------------- CSV export

const EXPORTS: Record<string, (f: Filters) => string> = {
  visitors: (f) =>
    `SELECT vr.*, COUNT(*) AS visits_in_range, SUM(v.engaged_ms) AS engaged_ms_in_range
     FROM ${VISITS} ${f.where} GROUP BY vr.visitor_id ORDER BY vr.first_seen_at`,
  visits: (f) => `SELECT v.*, vr.label AS visitor_label FROM ${VISITS} ${f.where} ORDER BY v.started_at`,
  areas: (f) =>
    `SELECT a.visit_id, a.visitor_id, vr.label AS visitor_label, v.started_at AS visit_started_at, a.area,
            CASE WHEN instr(a.area, ' › ') > 0 THEN substr(a.area, 1, instr(a.area, ' › ') - 1) ELSE a.area END AS section,
            a.engaged_ms, ROUND(a.engaged_ms / 1000.0, 1) AS engaged_seconds, a.first_at, a.last_at
     FROM ${AREAS} ${f.where} ORDER BY v.started_at, a.first_at`,
  events: (f) =>
    `SELECT e.id, e.visit_id, e.visitor_id, vr.label AS visitor_label, e.occurred_at, e.category, e.name, e.label, e.value, e.count
     FROM ${EVENTS} ${f.where} ORDER BY e.occurred_at, e.id`,
  quiz: (f) =>
    `SELECT q.id, q.visit_id, q.visitor_id, vr.label AS visitor_label, q.answered_at, q.quiz_id, q.run_id, q.question_index,
            q.question_count, q.question_id, q.question_kind, q.wrong_attempts, q.first_try, q.revealed, q.duration_ms
     FROM ${QUIZ} ${f.where} ORDER BY q.answered_at, q.id`,
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  // Guard against spreadsheet formula injection from visitor-supplied text.
  const safe = /^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

async function exportCsv(db: D1Database, table: string, f: Filters): Promise<Response> {
  const build = EXPORTS[table]
  if (!build) {
    return json({ error: 'unknown table' }, 400)
  }
  const result = await db.prepare(`${build(f)} LIMIT ${EXPORT_LIMIT}`).bind(...f.params).all()
  const rows = result.results as Record<string, unknown>[]
  const columns = rows.length ? Object.keys(rows[0]) : []
  // BOM so Excel reads it as UTF-8 (the '›' in area names).
  const lines = [columns.join(','), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))]
  const stamp = new Date().toISOString().slice(0, 10)
  return respond(`﻿${lines.join('\r\n')}\r\n`, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="sudoku-${table}-${stamp}.csv"`,
  })
}

// ---------------------------------------------------------------- router

export async function handleAdmin(request: Request, env: AdminEnv): Promise<Response> {
  const password = env.ADMIN_PASSWORD
  if (!password || password.length < 12) {
    // Not configured (or too weak to expose): pretend it doesn't exist.
    return new Response(null, { status: 404 })
  }
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, '') || '/admin'

  if (path === '/admin/login' && request.method === 'POST') {
    return handleLogin(request, env, password)
  }
  if (path === '/admin/app.css') {
    return respond(ADMIN_CSS, 200, { 'Content-Type': 'text/css; charset=utf-8' })
  }

  const authorized = await isAuthorized(request, password)
  if (path === '/admin' && request.method === 'GET') {
    return respond(authorized ? adminPageHtml() : loginPageHtml(), 200, { 'Content-Type': 'text/html; charset=utf-8' })
  }
  if (!authorized) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (path === '/admin/logout' && request.method === 'POST') {
    return respond(null, 303, { Location: '/admin', 'Set-Cookie': sessionCookie('', 0, url.protocol === 'https:') })
  }
  if (path === '/admin/app.js') {
    return respond(ADMIN_APP_JS, 200, { 'Content-Type': 'text/javascript; charset=utf-8' })
  }
  if (request.method === 'POST' && path === '/admin/api/visitor') {
    // A custom header can't be sent cross-site without a CORS preflight,
    // which this Worker never grants for /admin - so no CSRF.
    if (request.headers.get('X-Admin-Request') !== '1') {
      return json({ error: 'forbidden' }, 403)
    }
    return updateVisitor(request, env.DB)
  }
  if (request.method !== 'GET') {
    return json({ error: 'method not allowed' }, 405)
  }
  const filters = readFilters(url)
  switch (path) {
    case '/admin/api/overview':
      return json(await overview(env.DB, filters))
    case '/admin/api/visitors':
      return json(await visitorsList(env.DB, filters))
    case '/admin/api/visits':
      return json(await visitsList(env.DB, filters))
    case '/admin/api/visit':
      return json(await visitDetail(env.DB, url.searchParams.get('id') ?? ''))
    case '/admin/export':
      return exportCsv(env.DB, url.searchParams.get('table') ?? '', filters)
    default:
      return json({ error: 'not found' }, 404)
  }
}
