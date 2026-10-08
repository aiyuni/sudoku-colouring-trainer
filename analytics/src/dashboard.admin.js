// The /admin usage dashboard (served only to an authenticated session - see
// admin.ts). Plain browser JS, no build step, no dependencies. Every value
// shown comes from visitors' browsers, so it is only ever put on the page as
// text (el() / textContent), never as HTML.
'use strict'

const state = {
  range: '30',
  from: '',
  to: '',
  visitor: '',
  visitorName: '',
  bots: false,
  excluded: false,
  dailyMetric: 'visitors',
  eventCategory: 'all',
  data: null,
}

// ------------------------------------------------------------ helpers

function el(tag, attrs, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') node.className = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value)
    else if (key === 'text') node.textContent = value
    // Via CSSOM: the page's CSP blocks style attributes.
    else if (key === 'style') node.style.cssText = value
    else node.setAttribute(key, value === true ? '' : value)
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    node.append(child instanceof Node ? child : String(child))
  }
  return node
}

function svgEl(tag, attrs) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, value)
  return node
}

const $ = (id) => document.getElementById(id)
const nf = new Intl.NumberFormat()
const fmtNum = (n) => nf.format(Math.round(Number(n) || 0))
const plural = (n, word) => `${fmtNum(n)} ${word}${Math.round(Number(n)) === 1 ? '' : 's'}`

function fmtDuration(ms) {
  const total = Math.round((Number(ms) || 0) / 1000)
  if (total < 60) return `${total}s`
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`
}

function fmtDate(iso, withTime = true) {
  if (!iso) return ''
  const d = new Date(iso)
  return withTime
    ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function visitorName(row) {
  return row.label || `${String(row.visitor_id).slice(0, 8)}…`
}

const tooltip = () => $('tooltip')
function showTip(event, text) {
  const tip = tooltip()
  tip.textContent = text
  tip.hidden = false
  const x = Math.min(event.clientX + 14, window.innerWidth - tip.offsetWidth - 8)
  const y = Math.min(event.clientY + 14, window.innerHeight - tip.offsetHeight - 8)
  tip.style.left = `${x}px`
  tip.style.top = `${y}px`
}
function hideTip() {
  tooltip().hidden = true
}

// ------------------------------------------------------------ filters / URL

function rangeBounds() {
  if (state.range === 'custom') {
    return {
      from: state.from ? new Date(`${state.from}T00:00:00`).toISOString() : '',
      to: state.to ? new Date(new Date(`${state.to}T00:00:00`).getTime() + 86400000).toISOString() : '',
    }
  }
  if (state.range === 'all') return { from: '', to: '' }
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (Number(state.range) - 1))
  return { from: start.toISOString(), to: '' }
}

function query(extra) {
  const params = new URLSearchParams()
  const { from, to } = rangeBounds()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (state.visitor) params.set('visitor', state.visitor)
  if (state.bots) params.set('bots', '1')
  if (state.excluded) params.set('excluded', '1')
  params.set('tz', String(-new Date().getTimezoneOffset()))
  for (const [k, v] of Object.entries(extra || {})) params.set(k, v)
  return params.toString()
}

function saveHash() {
  const params = new URLSearchParams()
  params.set('range', state.range)
  if (state.range === 'custom') {
    params.set('from', state.from)
    params.set('to', state.to)
  }
  if (state.visitor) params.set('visitor', state.visitor)
  if (state.bots) params.set('bots', '1')
  if (state.excluded) params.set('excluded', '1')
  history.replaceState(null, '', `#${params}`)
}

function loadHash() {
  const params = new URLSearchParams(location.hash.slice(1))
  state.range = params.get('range') || '30'
  state.from = params.get('from') || ''
  state.to = params.get('to') || ''
  state.visitor = params.get('visitor') || ''
  state.bots = params.get('bots') === '1'
  state.excluded = params.get('excluded') === '1'
}

async function api(path, extra) {
  const response = await fetch(`/admin/api/${path}?${query(extra)}`, { credentials: 'same-origin' })
  if (response.status === 401) {
    location.reload()
    throw new Error('Signed out')
  }
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return response.json()
}

// ------------------------------------------------------------ charts

/** Single-series column chart with a hover tooltip per column. */
function columnChart(rows, { label, value, format, tip, width = 900, height = 220 }) {
  if (!rows.length) return el('div', { class: 'empty', text: 'No data for this range.' })
  const pad = { l: 44, r: 8, t: 10, b: 26 }
  const max = Math.max(1, ...rows.map(value))
  // Whole-number data with a small max gets whole-number gridlines.
  const niceMax = rows.every((r) => Number.isInteger(value(r))) ? Math.max(4, Math.ceil(niceCeil(max) / 4) * 4) : niceCeil(max)
  const plotW = width - pad.l - pad.r
  const plotH = height - pad.t - pad.b
  const step = plotW / rows.length
  const barW = Math.max(2, Math.min(40, step - 2))
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img' })
  const axis = svgEl('g', { class: 'axis' })
  for (let i = 0; i <= 4; i++) {
    const v = (niceMax / 4) * i
    const y = pad.t + plotH - (v / niceMax) * plotH
    axis.append(svgEl('line', { class: 'gridline', x1: pad.l, x2: width - pad.r, y1: y, y2: y }))
    const t = svgEl('text', { x: pad.l - 6, y: y + 4, 'text-anchor': 'end' })
    t.textContent = format(v)
    axis.append(t)
  }
  svg.append(axis)
  const labelEvery = Math.max(1, Math.ceil(rows.length / 12))
  rows.forEach((row, i) => {
    const v = value(row)
    const h = (v / niceMax) * plotH
    const x = pad.l + i * step + (step - barW) / 2
    const g = svgEl('g', { class: 'col' })
    if (h > 0) {
      const r = Math.min(4, barW / 2, h)
      const y = pad.t + plotH - h
      // Rounded top, square base on the axis.
      g.append(
        svgEl('path', {
          class: 'bar',
          d: `M${x},${pad.t + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${pad.t + plotH} Z`,
        }),
      )
    }
    const hit = svgEl('rect', { class: 'hit', x: pad.l + i * step, y: pad.t, width: step, height: plotH })
    hit.addEventListener('mousemove', (e) => showTip(e, tip(row)))
    hit.addEventListener('mouseleave', hideTip)
    g.append(hit)
    if (i % labelEvery === 0) {
      const t = svgEl('text', { x: pad.l + i * step + step / 2, y: height - 8, 'text-anchor': 'middle' })
      t.textContent = label(row)
      axis.append(t)
    }
    svg.append(g)
  })
  return el('div', { class: 'chart' }, svg)
}

function niceCeil(v) {
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp
  return 10 * exp
}

/** Horizontal bar list: name, bar, value. */
function hbars(rows, { name, value, format, tip, onClick }) {
  if (!rows.length) return el('div', { class: 'empty', text: 'No data for this range.' })
  const max = Math.max(1, ...rows.map(value))
  return el(
    'div',
    { class: 'hbars' },
    rows.map((row) =>
      el(
        'div',
        {
          class: 'hbar',
          onmousemove: tip ? (e) => showTip(e, tip(row)) : undefined,
          onmouseleave: tip ? hideTip : undefined,
          onclick: onClick ? () => onClick(row) : undefined,
          style: onClick ? 'cursor:pointer' : undefined,
        },
        el('div', { class: 'name', title: name(row), text: name(row) }),
        el('div', { class: 'track' }, el('div', { class: 'fill', style: `width:${(value(row) / max) * 100}%` })),
        el('div', { class: 'val', text: format(value(row)) }),
      ),
    ),
  )
}

/** Sortable table. columns: [{ key, label, num?, render?(row), sort?(row) }] */
function table(rows, columns, { onRowClick, rowClass, initialSort } = {}) {
  if (!rows.length) return el('div', { class: 'empty', text: 'Nothing here for this range.' })
  let sortKey = initialSort ? initialSort.key : null
  let asc = initialSort ? !!initialSort.asc : false
  const wrap = el('div', { class: 'table-wrap' })
  function draw() {
    const col = columns.find((c) => c.key === sortKey)
    const sorted = col
      ? [...rows].sort((a, b) => {
          const va = col.sort ? col.sort(a) : a[col.key]
          const vb = col.sort ? col.sort(b) : b[col.key]
          const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va ?? '').localeCompare(String(vb ?? ''))
          return asc ? cmp : -cmp
        })
      : rows
    const head = el(
      'tr',
      null,
      columns.map((c) =>
        el('th', {
          class: [c.num ? 'num' : '', c.key === sortKey ? 'sorted' : '', c.key === sortKey && asc ? 'asc' : ''].join(' '),
          text: c.label,
          onclick: () => {
            if (sortKey === c.key) asc = !asc
            else {
              sortKey = c.key
              asc = !c.num
            }
            draw()
          },
        }),
      ),
    )
    const body = sorted.map((row) =>
      el(
        'tr',
        {
          class: [onRowClick ? 'clickable' : '', rowClass ? rowClass(row) : ''].join(' '),
          onclick: onRowClick
            ? (e) => {
                if (!e.target.closest('input,button,a')) onRowClick(row)
              }
            : undefined,
        },
        columns.map((c) => {
          const content = c.render ? c.render(row) : row[c.key]
          return el('td', { class: [c.num ? 'num' : '', c.class || ''].join(' ') }, content ?? '')
        }),
      ),
    )
    wrap.replaceChildren(el('table', null, el('thead', null, head), el('tbody', null, body)))
  }
  draw()
  return wrap
}

function card(title, subtitle, ...content) {
  return el('section', { class: 'card' }, el('h2', { text: title }), subtitle ? el('p', { class: 'sub', text: subtitle }) : null, ...content)
}

function segmented(options, current, onChange) {
  return el(
    'div',
    { class: 'segmented', role: 'group' },
    options.map(([value, label]) =>
      el('button', { type: 'button', class: value === current ? 'active' : '', text: label, onclick: () => onChange(value) }),
    ),
  )
}

// ------------------------------------------------------------ sections

function renderKpis(t) {
  const visitors = Number(t.visitors) || 0
  const visits = Number(t.visits) || 0
  const tiles = [
    ['Unique visitors', fmtNum(visitors), `${fmtNum(t.new_visitors)} new in this range`],
    ['Returning visitors', fmtNum(t.returning_visitors), visitors ? `${Math.round((t.returning_visitors / visitors) * 100)}% came back at least once` : ''],
    ['Visits', fmtNum(visits), visitors ? `${(visits / visitors).toFixed(2)} per visitor` : ''],
    ['Engaged time / visit', fmtDuration(t.avg_engaged_ms), `open for ${fmtDuration(t.avg_duration_ms)} on average`],
    ['Total engaged time', fmtDuration(t.engaged_ms), `${fmtNum(t.page_loads)} page loads`],
    ['Short visits', fmtNum(t.short_visits), visits ? `${Math.round((t.short_visits / visits) * 100)}% under 10s engaged` : ''],
  ]
  return el(
    'div',
    { class: 'kpis' },
    tiles.map(([label, value, note]) =>
      el('div', { class: 'kpi' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), el('div', { class: 'note', text: note })),
    ),
  )
}

function fillDays(daily) {
  // Include days with no visits so gaps show as gaps.
  if (!daily.length) return daily
  const byDay = new Map(daily.map((d) => [d.day, d]))
  const { from } = rangeBounds()
  const start = from && state.range !== 'all' ? new Date(from) : new Date(`${daily[0].day}T00:00:00`)
  const end = new Date()
  const out = []
  for (let d = new Date(start); d <= end && out.length < 800; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    out.push(byDay.get(key) || { day: key, visitors: 0, visits: 0, new_visitors: 0, engaged_ms: 0 })
  }
  return out.length ? out : daily
}

function renderDaily(daily) {
  const holder = el('div')
  const metrics = {
    visitors: { label: 'Visitors', value: (r) => Number(r.visitors) || 0, format: fmtNum },
    visits: { label: 'Visits', value: (r) => Number(r.visits) || 0, format: fmtNum },
    new_visitors: { label: 'New visitors', value: (r) => Number(r.new_visitors) || 0, format: fmtNum },
    engaged: { label: 'Engaged minutes', value: (r) => (Number(r.engaged_ms) || 0) / 60000, format: (v) => fmtNum(v) },
  }
  const rows = fillDays(daily)
  function draw() {
    const m = metrics[state.dailyMetric]
    holder.replaceChildren(
      segmented(
        Object.entries(metrics).map(([k, v]) => [k, v.label]),
        state.dailyMetric,
        (k) => {
          state.dailyMetric = k
          draw()
        },
      ),
      columnChart(rows, {
        label: (r) => new Date(`${r.day}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        value: m.value,
        format: m.format,
        tip: (r) =>
          `${fmtDate(`${r.day}T00:00:00`, false)}\n${fmtNum(r.visitors)} visitors (${fmtNum(r.new_visitors)} new)\n${fmtNum(r.visits)} visits\n${fmtDuration(r.engaged_ms)} engaged`,
      }),
    )
  }
  draw()
  return card('Traffic over time', 'Per day, in your local time zone. Hover a column for the full numbers.', holder)
}

function sectionOf(area) {
  const i = area.indexOf(' › ')
  return i < 0 ? area : area.slice(0, i)
}

function renderAreas(areas) {
  const total = areas.reduce((s, a) => s + (Number(a.engaged_ms) || 0), 0)
  const sections = new Map()
  for (const a of areas) {
    const key = sectionOf(a.area)
    const s = sections.get(key) || { area: key, engaged_ms: 0, visits: 0, rows: [] }
    s.engaged_ms += Number(a.engaged_ms) || 0
    s.visits = Math.max(s.visits, Number(a.visits) || 0)
    s.rows.push(a)
    sections.set(key, s)
  }
  const sectionRows = [...sections.values()].sort((a, b) => b.engaged_ms - a.engaged_ms)
  const pct = (ms) => (total ? `${((ms / total) * 100).toFixed(1)}%` : '')

  const flat = []
  for (const s of sectionRows) {
    flat.push({ ...s, isSection: true })
    for (const r of s.rows.sort((a, b) => b.engaged_ms - a.engaged_ms)) flat.push(r)
  }
  const detail = table(
    flat,
    [
      { key: 'area', label: 'Area', render: (r) => (r.isSection ? r.area : r.area.slice(sectionOf(r.area).length + 3) || '(main)'), class: '' },
      { key: 'engaged_ms', label: 'Engaged time', num: true, render: (r) => fmtDuration(r.engaged_ms) },
      { key: 'share', label: 'Share', num: true, render: (r) => pct(r.engaged_ms) },
      { key: 'visitors', label: 'Visitors', num: true, render: (r) => (r.isSection ? '' : fmtNum(r.visitors)) },
      { key: 'visits', label: 'Visits', num: true, render: (r) => (r.isSection ? '' : fmtNum(r.visits)) },
      { key: 'avg', label: 'Avg per visit', num: true, render: (r) => (r.isSection ? '' : fmtDuration(r.engaged_ms / Math.max(1, r.visits))) },
    ],
    { rowClass: (r) => (r.isSection ? 'section-row' : '') },
  )
  // Indent the child rows.
  detail.querySelectorAll('tbody tr:not(.section-row) td:first-child').forEach((td) => td.classList.add('indent'))

  return el(
    'div',
    { class: 'cols-2' },
    card(
      'Where the time goes',
      'Engaged time (tab visible and used in the last 5 minutes) by section of the app.',
      hbars(sectionRows, {
        name: (r) => r.area,
        value: (r) => r.engaged_ms,
        format: (v) => `${fmtDuration(v)} · ${pct(v)}`,
        tip: (r) => `${r.area}\n${fmtDuration(r.engaged_ms)} (${pct(r.engaged_ms)} of all engaged time)`,
      }),
    ),
    card('Time by area', 'Every screen, menu, tab and technique, grouped by section. Click a header to sort.', detail),
  )
}

const EVENT_CATEGORIES = [
  ['all', 'All'],
  ['click', 'Buttons'],
  ['view', 'Opened'],
  ['setting', 'Settings changed'],
  ['technique', 'Techniques'],
  ['task', 'Long tasks'],
  ['board', 'Board'],
  ['import', 'Imports'],
  ['solve path', 'Solve path'],
  ['puzzle', 'Puzzles'],
  ['page', 'Page'],
  ['error', 'Errors'],
]

function renderEvents(events) {
  const holder = el('div')
  function draw() {
    const rows = state.eventCategory === 'all' ? events : events.filter((e) => e.category === state.eventCategory)
    const columns = [
      { key: 'category', label: 'Type' },
      { key: 'name', label: 'What' },
      { key: 'label', label: 'Detail', render: (r) => r.label ?? '' },
      { key: 'count', label: 'Times', num: true, render: (r) => fmtNum(r.count) },
      { key: 'visitors', label: 'Visitors', num: true, render: (r) => fmtNum(r.visitors) },
    ]
    if (state.eventCategory === 'task') {
      columns.push({ key: 'avg_value', label: 'Avg duration', num: true, render: (r) => (r.avg_value == null ? '' : fmtDuration(r.avg_value)) })
    }
    holder.replaceChildren(
      segmented(EVENT_CATEGORIES, state.eventCategory, (k) => {
        state.eventCategory = k
        draw()
      }),
      table(rows, columns, { initialSort: { key: 'count' } }),
    )
  }
  draw()
  return card(
    'What people do',
    'Button presses (by label, grouped across areas), settings changed (with the new value), techniques studied and applied, long tasks with outcome and duration, board edits, imports and errors.',
    holder,
  )
}

function renderWhen(d) {
  const hours = Array.from({ length: 24 }, (_, h) => d.hours.find((r) => Number(r.hour) === h) || { hour: h, visits: 0 })
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const weekdays = [1, 2, 3, 4, 5, 6, 0].map((w) => d.weekdays.find((r) => Number(r.weekday) === w) || { weekday: w, visits: 0 })
  return el(
    'div',
    { class: 'cols-3' },
    card(
      'Hour of day',
      'Visits started, your local time.',
      columnChart(hours, { width: 420, height: 200, label: (r) => String(r.hour), value: (r) => Number(r.visits), format: fmtNum, tip: (r) => `${r.hour}:00-${r.hour}:59\n${fmtNum(r.visits)} visits` }),
    ),
    card(
      'Day of week',
      'Visits started.',
      columnChart(weekdays, { width: 420, height: 200, label: (r) => days[r.weekday], value: (r) => Number(r.visits), format: fmtNum, tip: (r) => `${days[r.weekday]}\n${fmtNum(r.visits)} visits` }),
    ),
    card(
      'Loyalty',
      "Visits by the visitor's visit number (1 = first time here).",
      hbars(d.visitNumbers, { name: (r) => `Visit #${r.bucket}`, value: (r) => Number(r.visits), format: fmtNum }),
    ),
  )
}

function renderAudience(a) {
  const dims = [
    ['Country', a.country],
    ['City', a.city],
    ['Device type', a.deviceType],
    ['Device', a.device],
    ['OS', a.os],
    ['Browser', a.browser],
    ['Referrer', a.referrer],
    ['Language', a.language],
    ['Screen', a.screen],
  ]
  return el(
    'div',
    { class: 'cols-3' },
    dims.map(([title, rows]) =>
      card(
        title,
        null,
        hbars(rows.slice(0, 10), {
          name: (r) => String(r.key),
          value: (r) => Number(r.visitors),
          format: (v) => plural(v, 'visitor'),
          tip: (r) => `${r.key}\n${plural(r.visitors, 'visitor')}, ${plural(r.visits, 'visit')}`,
        }),
      ),
    ),
  )
}

async function saveVisitor(visitor, patch) {
  await fetch('/admin/api/visitor', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
    body: JSON.stringify({ visitor, ...patch }),
  })
}

function filterToVisitor(row) {
  state.visitor = row.visitor_id
  state.visitorName = visitorName(row)
  refresh()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function renderVisitors(rows) {
  return card(
    'Visitors',
    'One row per browser (a random id stored on their device). Click a row to see only that visitor. Name visitors you recognise, and tick Exclude for yourself so your own use stays out of the totals.',
    table(
      rows,
      [
        {
          key: 'label',
          label: 'Name',
          render: (r) =>
            el('input', {
              type: 'text',
              value: r.label || '',
              placeholder: String(r.visitor_id).slice(0, 8),
              onchange: (e) => saveVisitor(r.visitor_id, { label: e.target.value }),
            }),
        },
        { key: 'visitor_id', label: 'Id', render: (r) => el('span', { class: 'mono', title: r.visitor_id, text: String(r.visitor_id).slice(0, 8) }) },
        { key: 'visit_count', label: 'Visits (all time)', num: true, render: (r) => fmtNum(r.visit_count) },
        { key: 'visits_in_range', label: 'Visits (range)', num: true, render: (r) => fmtNum(r.visits_in_range) },
        { key: 'engaged_in_range', label: 'Engaged (range)', num: true, render: (r) => fmtDuration(r.engaged_in_range) },
        { key: 'total_engaged_ms', label: 'Engaged (all time)', num: true, render: (r) => fmtDuration(r.total_engaged_ms) },
        { key: 'first_seen_at', label: 'First seen', render: (r) => fmtDate(r.first_seen_at) },
        { key: 'last_seen_at', label: 'Last seen', render: (r) => fmtDate(r.last_seen_at) },
        { key: 'top_area', label: 'Most time in' },
        { key: 'imports', label: 'Imports', num: true, render: (r) => fmtNum(r.imports) },
        { key: 'where', label: 'Where', render: (r) => [r.city, r.country].filter(Boolean).join(', '), sort: (r) => `${r.country}${r.city}` },
        { key: 'device', label: 'Device', render: (r) => [r.device || r.device_type, r.os, r.browser].filter(Boolean).join(' · ') },
        {
          key: 'excluded',
          label: 'Exclude',
          render: (r) =>
            el(
              'span',
              null,
              el('input', {
                type: 'checkbox',
                checked: Number(r.excluded) === 1,
                title: 'Leave this visitor out of all totals',
                onchange: (e) => saveVisitor(r.visitor_id, { excluded: e.target.checked }),
              }),
              Number(r.is_bot) === 1 ? el('span', { class: 'tag warn', text: 'bot' }) : null,
            ),
        },
      ],
      { onRowClick: filterToVisitor, initialSort: { key: 'last_seen_at' } },
    ),
  )
}

function renderVisits(rows) {
  return card(
    'Visits',
    'Most recent first (up to 500). Click one for its full timeline.',
    table(
      rows,
      [
        { key: 'started_at', label: 'Started', render: (r) => fmtDate(r.started_at) },
        { key: 'visitor', label: 'Visitor', render: (r) => visitorName(r), sort: (r) => visitorName(r) },
        { key: 'visit_number', label: 'Visit #', num: true },
        { key: 'engaged_ms', label: 'Engaged', num: true, render: (r) => fmtDuration(r.engaged_ms) },
        {
          key: 'duration',
          label: 'Open for',
          num: true,
          render: (r) => fmtDuration(new Date(r.last_seen_at) - new Date(r.started_at)),
          sort: (r) => new Date(r.last_seen_at) - new Date(r.started_at),
        },
        { key: 'page_loads', label: 'Loads', num: true },
        { key: 'actions', label: 'Actions', num: true, render: (r) => fmtNum(r.actions) },
        { key: 'top_area', label: 'Most time in' },
        { key: 'where', label: 'Where', render: (r) => [r.city, r.country].filter(Boolean).join(', ') },
        { key: 'device', label: 'Device', render: (r) => [r.device || r.device_type, r.browser].filter(Boolean).join(' · ') },
        { key: 'referrer', label: 'Came from', render: (r) => r.referrer || '' },
      ],
      { onRowClick: (r) => openVisit(r.visit_id), initialSort: { key: 'started_at' } },
    ),
  )
}

async function openVisit(id) {
  const dialog = $('visit-dialog')
  const body = dialog.querySelector('.dialog-body')
  body.replaceChildren(el('p', { class: 'status', text: 'Loading…' }))
  dialog.showModal()
  try {
    const response = await fetch(`/admin/api/visit?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' })
    const { visit, areas, events } = await response.json()
    if (!visit) {
      body.replaceChildren(el('p', { text: 'Visit not found.' }))
      return
    }
    const facts = [
      ['Visitor', `${visit.label || ''} ${visit.visitor_id}`.trim()],
      ['Visit number', visit.visit_number],
      ['Started', fmtDate(visit.started_at)],
      ['Last activity', fmtDate(visit.last_seen_at)],
      ['Engaged', fmtDuration(visit.engaged_ms)],
      ['Page loads', visit.page_loads],
      ['Location', [visit.city, visit.region, visit.country].filter(Boolean).join(', ')],
      ['Device', [visit.device_type, visit.device].filter(Boolean).join(' · ')],
      ['OS / browser', [visit.os, visit.os_version, '·', visit.browser, visit.browser_version].filter(Boolean).join(' ')],
      ['Screen / viewport', [visit.screen, visit.viewport].filter(Boolean).join(' / ')],
      ['Language / time zone', [visit.language, visit.timezone].filter(Boolean).join(' / ')],
      ['Came from', visit.referrer || '(direct)'],
      ['Campaign', visit.campaign || ''],
      ['Installed app / dark mode', `${visit.standalone ? 'yes' : 'no'} / ${visit.dark_mode ? 'yes' : 'no'}`],
    ]
    body.replaceChildren(
      el(
        'dl',
        { class: 'facts' },
        facts.map(([k, v]) => el('div', null, el('dt', { text: k }), el('dd', { text: String(v ?? '') }))),
      ),
      el('button', { type: 'button', text: 'Show only this visitor', onclick: () => { dialog.close(); filterToVisitor(visit) } }),
      el('h3', { text: 'Time by area' }),
      hbars(
        [...areas].sort((a, b) => b.engaged_ms - a.engaged_ms),
        { name: (r) => r.area, value: (r) => Number(r.engaged_ms), format: fmtDuration, tip: (r) => `${r.area}\nfirst ${fmtDate(r.first_at)}\nlast ${fmtDate(r.last_at)}` },
      ),
      el('h3', { text: 'Timeline' }),
      table(
        events,
        [
          { key: 'occurred_at', label: 'Time', render: (r) => new Date(r.occurred_at).toLocaleTimeString() },
          { key: 'category', label: 'Type' },
          { key: 'name', label: 'What' },
          { key: 'label', label: 'Detail', render: (r) => r.label ?? '' },
          { key: 'value', label: 'Value', num: true, render: (r) => (r.value == null ? '' : r.category === 'task' ? fmtDuration(r.value) : fmtNum(r.value)) },
          { key: 'count', label: 'Times', num: true },
        ],
        {},
      ),
    )
  } catch (err) {
    body.replaceChildren(el('p', { class: 'error-banner', text: String(err) }))
  }
}

// ------------------------------------------------------------ toolbar

function renderToolbar() {
  const bar = $('toolbar')
  const range = el(
    'select',
    {
      'aria-label': 'Date range',
      onchange: (e) => {
        state.range = e.target.value
        renderToolbar()
        if (state.range !== 'custom') refresh()
      },
    },
    [
      ['1', 'Today'],
      ['7', 'Last 7 days'],
      ['30', 'Last 30 days'],
      ['90', 'Last 90 days'],
      ['365', 'Last 12 months'],
      ['all', 'All time'],
      ['custom', 'Custom…'],
    ].map(([v, l]) => el('option', { value: v, selected: v === state.range, text: l })),
  )
  const custom =
    state.range === 'custom'
      ? [
          el('input', { type: 'date', value: state.from, 'aria-label': 'From', onchange: (e) => { state.from = e.target.value; refresh() } }),
          el('span', { class: 'muted', text: 'to' }),
          el('input', { type: 'date', value: state.to, 'aria-label': 'To', onchange: (e) => { state.to = e.target.value; refresh() } }),
        ]
      : []
  const visitorChip = state.visitor
    ? el(
        'span',
        { class: 'chip' },
        `Visitor: ${state.visitorName || state.visitor.slice(0, 8)}`,
        el('button', { type: 'button', 'aria-label': 'Show all visitors', text: '✕', onclick: () => { state.visitor = ''; state.visitorName = ''; refresh() } }),
      )
    : null
  const check = (key, label) =>
    el('label', null, el('input', { type: 'checkbox', checked: state[key], onchange: (e) => { state[key] = e.target.checked; refresh() } }), label)

  const exportPanel = el(
    'div',
    { class: 'menu-panel', hidden: true },
    [
      ['visitors', 'Visitors (CSV)'],
      ['visits', 'Visits (CSV)'],
      ['areas', 'Time by area, per visit (CSV)'],
      ['events', 'Events (CSV)'],
      ['quiz', 'Practice quiz answers (CSV)'],
      ['saved', 'Saved puzzles (CSV)'],
    ].map(([table, label]) => el('a', { href: `/admin/export?${query({ table })}`, text: label })),
  )
  const exportMenu = el(
    'div',
    { class: 'menu' },
    el('button', { type: 'button', text: 'Export ▾', onclick: () => { exportPanel.hidden = !exportPanel.hidden } }),
    exportPanel,
  )
  const logout = el('form', { method: 'post', action: '/admin/logout' }, el('button', { type: 'submit', text: 'Sign out' }))

  bar.replaceChildren(
    ...[el('h1', { text: 'Sudoku Trainer · Usage' }),
    range,
    ...custom,
    visitorChip,
    check('excluded', 'Include excluded'),
    check('bots', 'Include bots'),
    el('span', { class: 'spacer' }),
    el('span', { class: 'status', id: 'status' }),
    el('button', { type: 'button', text: 'Refresh', onclick: refresh }),
    exportMenu,
    logout,
  ].filter(Boolean))
}

// ------------------------------------------------------------ main

let refreshToken = 0
async function refresh() {
  const token = ++refreshToken
  saveHash()
  renderToolbar()
  $('status').textContent = 'Loading…'
  try {
    const [overview, visitors, visits] = await Promise.all([api('overview'), api('visitors'), api('visits')])
    if (token !== refreshToken) return
    if (state.visitor && !state.visitorName) {
      const me = visitors.find((v) => v.visitor_id === state.visitor)
      if (me) state.visitorName = visitorName(me)
      renderToolbar()
    }
    const content = $('content')
    content.replaceChildren(
      renderKpis(overview.totals),
      renderDaily(overview.daily),
      renderAreas(overview.areas),
      renderEvents(overview.events),
      renderWhen(overview),
      state.visitor ? null : renderVisitors(visitors),
      renderVisits(visits),
      state.visitor ? null : el('h2', { text: 'Audience', style: 'margin:8px 0 0;font-size:15px' }),
      state.visitor ? null : renderAudience(overview.audience),
    )
    $('status').textContent = `Updated ${new Date().toLocaleTimeString()}`
  } catch (err) {
    if (token !== refreshToken) return
    $('status').textContent = ''
    $('content').replaceChildren(el('div', { class: 'error-banner', text: `Couldn't load: ${err.message || err}` }))
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu')) document.querySelectorAll('.menu-panel').forEach((p) => (p.hidden = true))
})
$('visit-dialog').querySelector('.close').addEventListener('click', () => $('visit-dialog').close())
loadHash()
refresh()
