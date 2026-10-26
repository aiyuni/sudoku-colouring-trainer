// Short share links (migration 0007). The site's share links carry their
// whole content in the fragment - a Dragon's recorded move log is a few
// thousand characters even deflated - so the page can ask for a short one
// instead: it POSTs the fragment (`d=1...` or `p=1...`, without the `#`) to
// /share and gets an id back, and a link `#s=<id>` is resolved with
// GET /share/<id>, which returns that same fragment text.
//
// The id is derived from the content (SHA-256, base62), so sharing the same
// Dragon twice gives the same link and stores one row. Rows are never
// changed or deleted, which is what lets a GET be cached for good. The
// fragment itself is only stored and handed back, never interpreted here:
// the page checks everything it reads from a link (techniqueShareLink.ts,
// shareLink.ts), as it does for a long one.

/** The stored text: a fragment kind, `=`, then a base64url payload. The
 * page reads at most 200k characters of payload (MAX_REPLAY_PAYLOAD_LENGTH),
 * so nothing longer could ever be opened. */
const FRAGMENT = /^[dp]=[A-Za-z0-9_-]{1,200000}$/
const MAX_BODY_BYTES = 200_010
const ID = /^[0-9A-Za-z]{8,16}$/
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
/** 8 base62 characters = ~47 bits: a collision between two different shares
 * is astronomically unlikely, and is handled anyway (a longer id). */
const ID_LENGTHS = [8, 12, 16]

async function idsFor(body: string): Promise<string[]> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)))
  let value = 0n
  for (const byte of digest) {
    value = (value << 8n) | BigInt(byte)
  }
  let text = ''
  while (text.length < ID_LENGTHS[ID_LENGTHS.length - 1]) {
    text += BASE62[Number(value % 62n)]
    value /= 62n
  }
  return ID_LENGTHS.map((length) => text.slice(0, length))
}

/** POST /share: stores the fragment, answers `{"id": "..."}`. */
export async function handleCreateShare(request: Request, db: D1Database, site: string): Promise<Response> {
  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 })
  }
  if (!FRAGMENT.test(body)) {
    return new Response(null, { status: 400 })
  }
  for (const id of await idsFor(body)) {
    await db
      .prepare('INSERT OR IGNORE INTO share_links (id, body, created_at, site) VALUES (?, ?, ?, ?)')
      .bind(id, body, new Date().toISOString(), site)
      .run()
    const stored = await db.prepare('SELECT body FROM share_links WHERE id = ?').bind(id).first<{ body: string }>()
    if (stored?.body === body) {
      return Response.json({ id })
    }
  }
  return new Response(null, { status: 500 })
}

/** GET /share/<id>: the stored fragment as plain text, 404 when unknown. */
export async function handleReadShare(id: string, db: D1Database): Promise<Response> {
  if (!ID.test(id)) {
    return new Response(null, { status: 404 })
  }
  const row = await db.prepare('SELECT body FROM share_links WHERE id = ?').bind(id).first<{ body: string }>()
  if (!row) {
    return new Response(null, { status: 404 })
  }
  return new Response(row.body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=31536000, immutable' },
  })
}
