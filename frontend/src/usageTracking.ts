import { useEffect } from 'react'
import { deviceHints } from './deviceHints'

// Anonymous usage analytics: who comes back, how long they stay, and which
// parts of the app they spend that time in. Sent to the same Cloudflare
// Worker as the import analytics (`analytics/` at the repo root, `POST /sync`),
// which stores it in its own D1 tables (visitors, visits, visit_areas,
// events) - never in puzzle_imports. Read it on the Worker's password-
// protected /admin dashboard; see analytics/README.md.
//
// Identity, with no accounts:
// - visitor: a random id kept in localStorage, so closing the browser and
//   coming back later is still the same visitor (a new browser, device,
//   private window or cleared site data is a new one - nothing more
//   identifying is ever collected).
// - visit: starts on the first page load after 30 minutes of inactivity
//   (the usual web-analytics definition). A refresh or a second tab inside
//   that window is the same visit; the Worker counts its page loads.
//
// Time is *engaged* time, per "area" (Solver › Techniques, Menu › Settings,
// How It Works › Dragon Colouring, ...): only while the tab is visible and
// the user has done something (click, key, scroll, touch) in the last
// IDLE_MS - a tab left open overnight doesn't count as eight hours of use.
//
// Invisible and cheap by design: no UI, never awaited, every error
// swallowed, events merged in memory (a hundred digit entries are one row
// with count 100) and sent in one small request per minute at most, plus
// one when the tab is hidden or closed. Only active when the build sets
// VITE_ANALYTICS_URL, like importAnalytics.ts.
const ANALYTICS_URL: string | undefined = import.meta.env.VITE_ANALYTICS_URL
// Deliberately not "/collect", "/track" or "/analytics": content blockers
// match those path names (see the Worker's name in wrangler.toml).
const SYNC_URL = ANALYTICS_URL ? new URL('sync', ANALYTICS_URL).toString() : undefined

const VISITOR_KEY = 'sudoku-trainer.vid'
const VISIT_KEY = 'sudoku-trainer.visit'
const VISIT_TIMEOUT_MS = 30 * 60_000
const IDLE_MS = 5 * 60_000
const FLUSH_INTERVAL_MS = 60_000
// How often the "last active" time is written to localStorage (interaction
// handlers fire on every scroll tick; the visit timeout doesn't need ms).
const ACTIVITY_PERSIST_MS = 15_000
const MAX_EVENTS_PER_BATCH = 150
const MAX_LABEL_LENGTH = 200

/** Stacking order of areas that can be open at once: the highest active
 * layer is where the user is; within a layer, the most recently opened. */
export const AREA_LAYER = {
  solver: 0,
  menu: 10,
  dialog: 20,
  tutorial: 30,
  tutorialSection: 31,
} as const

interface PendingEvent {
  category: string
  name: string
  label: string | null
  value: number | null
  count: number
  /** Date.now() of the first occurrence in this batch. */
  at: number
}

interface ActiveArea {
  name: string
  layer: number
  order: number
}

let started = false
let visitorId = ''
let visitId = ''
let pageLoadId = ''
let contextSent = false
let lastActivityAt = 0
let lastPersistedActivityAt = 0

let visible = true
let lastSettleAt = 0
let lastInteractionAt = 0
let areaMs = new Map<string, number>()
let events = new Map<string, PendingEvent>()
let droppedEvents = 0
// Filled in asynchronously at start (Client Hints are a promise); sent
// with the page context once ready.
let device: Record<string, unknown> | null = null

const activeAreas = new Map<number, ActiveArea>()
let nextAreaToken = 1
let nextAreaOrder = 1

function randomId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode / blocked storage: this page load is its own visitor.
  }
}

function loadVisitorId(): string {
  const stored = readStorage(VISITOR_KEY)
  if (stored && /^[A-Za-z0-9-]{8,64}$/.test(stored)) {
    return stored
  }
  const created = randomId()
  writeStorage(VISITOR_KEY, created)
  return created
}

/** Continues the visit stored by this or another tab if it was active in
 * the last VISIT_TIMEOUT_MS, else starts a new one. */
function loadVisitId(now: number): string {
  try {
    const stored = JSON.parse(readStorage(VISIT_KEY) ?? 'null') as { id?: unknown; at?: unknown } | null
    if (stored && typeof stored.id === 'string' && typeof stored.at === 'number' && now - stored.at < VISIT_TIMEOUT_MS) {
      return stored.id
    }
  } catch {
    // Unreadable - start fresh.
  }
  return randomId()
}

function persistActivity(now: number): void {
  lastPersistedActivityAt = now
  writeStorage(VISIT_KEY, JSON.stringify({ id: visitId, at: now }))
}

function currentArea(): string {
  let best: ActiveArea | null = null
  for (const area of activeAreas.values()) {
    if (!best || area.layer > best.layer || (area.layer === best.layer && area.order > best.order)) {
      best = area
    }
  }
  return best?.name ?? 'Solver'
}

/** Credits the engaged time since the last settle to the current area.
 * Called before anything that changes the area, the visibility or the
 * idle state, so each span goes to the area it was spent in. */
function settle(now = Date.now()): void {
  // Nothing on screen has registered yet (the first moments before React
  // mounts): not worth an area of its own.
  if (visible && activeAreas.size > 0) {
    const end = Math.min(now, lastInteractionAt + IDLE_MS)
    const ms = end - lastSettleAt
    if (ms > 0) {
      const area = currentArea()
      areaMs.set(area, (areaMs.get(area) ?? 0) + ms)
    }
  }
  lastSettleAt = now
}

function onInteraction(): void {
  const now = Date.now()
  if (now - lastActivityAt >= VISIT_TIMEOUT_MS) {
    // Back after a long break with the tab still open: that's a new visit.
    settle(now)
    flush(false)
    visitId = randomId()
    contextSent = false
    lastSettleAt = now
  } else if (now - lastInteractionAt > IDLE_MS) {
    // Back from idle: settle so the idle gap isn't counted.
    settle(now)
    lastSettleAt = now
  }
  lastInteractionAt = now
  lastActivityAt = now
  if (now - lastPersistedActivityAt >= ACTIVITY_PERSIST_MS) {
    persistActivity(now)
  }
}

function onVisibilityChange(): void {
  const now = Date.now()
  settle(now)
  visible = document.visibilityState === 'visible'
  if (visible) {
    onInteraction()
    lastSettleAt = now
  } else {
    flush(true)
  }
}

function pageContext(): Record<string, unknown> {
  const params = new URLSearchParams(location.search)
  const campaign: Record<string, string> = {}
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'ref']) {
    const value = params.get(key)
    if (value) campaign[key] = value.slice(0, 100)
  }
  let referrer: string | null = null
  try {
    // Only the referring site, not our own pages (an in-site reload).
    if (document.referrer && new URL(document.referrer).origin !== location.origin) {
      referrer = document.referrer.slice(0, 300)
    }
  } catch {
    referrer = null
  }
  let timezone: string | null = null
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null
  } catch {
    timezone = null
  }
  const matches = (query: string) => {
    try {
      return window.matchMedia(query).matches
    } catch {
      return false
    }
  }
  return {
    referrer,
    campaign: Object.keys(campaign).length ? campaign : null,
    language: navigator.language ?? null,
    timezone,
    screen: `${screen.width}x${screen.height}@${Math.round((window.devicePixelRatio || 1) * 100) / 100}`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    standalone: matches('(display-mode: standalone)'),
    darkMode: matches('(prefers-color-scheme: dark)'),
    webdriver: navigator.webdriver === true,
    device: device ?? { touchPoints: navigator.maxTouchPoints ?? 0 },
  }
}

function flush(final: boolean): void {
  if (!SYNC_URL || !started) {
    return
  }
  const now = Date.now()
  settle(now)
  const areas: Record<string, number> = {}
  let hasAreas = false
  for (const [area, ms] of areaMs) {
    const rounded = Math.round(ms)
    if (rounded > 0) {
      areas[area] = rounded
      hasAreas = true
    }
  }
  const pending = [...events.values()]
  if (droppedEvents > 0) {
    pending.push({ category: 'meta', name: 'Events dropped', label: null, value: null, count: droppedEvents, at: now })
  }
  if (!hasAreas && pending.length === 0 && contextSent) {
    return
  }
  areaMs = new Map()
  events = new Map()
  droppedEvents = 0

  const includeContext = !contextSent
  const body: Record<string, unknown> = {
    visitor: visitorId,
    visit: visitId,
    pageLoad: pageLoadId,
    areas,
    // `age` rather than a timestamp: the Worker subtracts it from its own
    // clock, so a wrong clock on the user's device doesn't skew times.
    events: pending.map((e) => ({
      category: e.category,
      name: e.name,
      label: e.label,
      value: e.value,
      count: e.count,
      age: Math.max(0, now - e.at),
    })),
  }
  if (includeContext) {
    body.context = pageContext()
  }
  const sentVisitId = visitId
  void send(body, final).then((ok) => {
    // Unless a new visit started meanwhile - that one still needs its own.
    if (ok && includeContext && sentVisitId === visitId) {
      contextSent = true
    }
  })
}

async function send(body: Record<string, unknown>, final: boolean): Promise<boolean> {
  try {
    // text/plain keeps it a CORS "simple request" (no preflight); keepalive
    // lets the last batch finish after the tab closes. Not sendBeacon:
    // content blockers drop beacon requests as a type (see importAnalytics).
    const response = await fetch(SYNC_URL!, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'text/plain' },
      keepalive: final,
      mode: 'cors',
    })
    return response.ok
  } catch {
    return false
  }
}

/** Starts tracking this page load. Safe to call more than once; does
 * nothing without VITE_ANALYTICS_URL. */
export function startUsageTracking(): void {
  if (started || !SYNC_URL || typeof window === 'undefined') {
    return
  }
  started = true
  const now = Date.now()
  visitorId = loadVisitorId()
  visitId = loadVisitId(now)
  pageLoadId = randomId()
  visible = document.visibilityState === 'visible'
  lastSettleAt = now
  lastInteractionAt = now
  lastActivityAt = now
  persistActivity(now)
  void deviceHints().then((hints) => {
    device = hints
  })

  const passive = { passive: true, capture: true } as const
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(type, onInteraction, passive)
  }
  window.addEventListener('click', onClick, passive)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', () => flush(true))
  window.addEventListener('error', (event) => {
    trackEvent('error', String(event.message || 'Script error').slice(0, 120), `${event.filename ?? ''}:${event.lineno ?? ''}`)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
    trackEvent('error', `Unhandled rejection: ${reason}`.slice(0, 120))
  })
  window.setInterval(() => {
    if (visible) flush(false)
  }, FLUSH_INTERVAL_MS)

  trackEvent('page', 'Page load', location.pathname)
  // Register the visit soon, but off the startup path.
  window.setTimeout(() => flush(false), 3000)
}

/** Records one occurrence of something. Repeats with the same category,
 * name and label (and no value) inside one batch are merged into a count. */
export function trackEvent(category: string, name: string, label?: string | null, value?: number | null): void {
  if (!started) {
    return
  }
  const cleanLabel = label == null ? null : String(label).slice(0, MAX_LABEL_LENGTH)
  const cleanValue = typeof value === 'number' && Number.isFinite(value) ? value : null
  const key = cleanValue === null ? `${category}\u0000${name}\u0000${cleanLabel ?? ''}` : `${category}\u0000${events.size}\u0000${Math.random()}`
  const existing = events.get(key)
  if (existing) {
    existing.count++
    return
  }
  if (events.size >= MAX_EVENTS_PER_BATCH) {
    droppedEvents++
    return
  }
  events.set(key, { category, name: name.slice(0, 120), label: cleanLabel, value: cleanValue, count: 1, at: Date.now() })
}

/** Generic button tracking, so every toolbar item, Auto-solve button,
 * stepper arrow, tab and tutorial pill is counted without wiring each one:
 * what was clicked, and in which area. Grid cells are left out (board edits
 * are counted by App itself), and so is anything whose label is long text
 * such as a Techniques row (those are tracked by name instead). */
function onClick(event: Event): void {
  try {
    const target = event.target instanceof Element ? event.target : null
    const control = target?.closest('button, [role="tab"], [role="menuitem"], a[href], summary')
    if (!control || control.closest('[role="grid"], [data-track-ignore]')) {
      return
    }
    // The visible text is what the user saw ("Autofill"), unless it's only
    // an icon ("⚙", "▶") - then the aria-label/title says what it is.
    const visible = (control.textContent ?? '').replace(/\s+/g, ' ').trim()
    const raw =
      control.getAttribute('data-track') ??
      (/\p{L}/u.test(visible) ? visible : null) ??
      control.getAttribute('aria-label') ??
      control.getAttribute('title') ??
      visible
    // Counts and positions in labels ("Step 3 of 12") would split one
    // button into many rows; menu carets aren't part of the name.
    const label = raw.replace(/[▾▴▸◂]/g, '').replace(/\s+/g, ' ').replace(/\d+/g, '#').trim()
    if (!label || label.length > 60) {
      return
    }
    trackEvent('click', label, currentArea())
  } catch {
    // Never let analytics break a click.
  }
}

/** While `active`, marks `name` as where the user is (see AREA_LAYER). */
export function useAnalyticsArea(name: string, layer: number, active = true): void {
  useEffect(() => {
    if (!active || !started) {
      return
    }
    settle()
    const token = nextAreaToken++
    activeAreas.set(token, { name, layer, order: nextAreaOrder++ })
    trackEvent('view', name)
    return () => {
      settle()
      activeAreas.delete(token)
    }
  }, [name, layer, active])
}

/** Reports every setting that changed since the last render as one
 * 'setting' event (name = setting, label = new value). The first call only
 * records the starting values. */
let previousSettings: Map<string, string> | null = null
export function trackSettingsChanges(settings: Record<string, unknown>): void {
  if (!started) {
    return
  }
  const next = new Map<string, string>()
  for (const [key, value] of Object.entries(settings)) {
    next.set(key, describeSettingValue(value))
  }
  if (previousSettings) {
    for (const [key, value] of next) {
      if (previousSettings.get(key) !== value) {
        trackEvent('setting', key, value)
      }
    }
  }
  previousSettings = next
}

function describeSettingValue(value: unknown): string {
  if (value instanceof Set) {
    return [...value].map(String).sort().join(', ')
  }
  if (Array.isArray(value)) {
    return value.map(String).sort().join(', ')
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value)
  }
  return String(value)
}
