import { readReplayFromAddress, type ReplayDecodeResult } from './techniqueShareLink'

/** Short share links: `https://<site>/#s=Ab3xK9qZ` in place of a long
 * `#d=1...` technique link (a Dragon's recorded move log is thousands of
 * characters even deflated, more than chat apps and people want to carry).
 *
 * The long link's fragment is stored by the same Cloudflare Worker as the
 * analytics (`analytics/src/share.ts`, `POST /share`), under an id derived
 * from its content, and `#s=<id>` is turned back into it (`GET /share/<id>`)
 * before the page renders. Nothing is lost: the Worker returns the exact
 * fragment, which is then read as if the long link had been opened, with
 * all of its checks. Only active when the build sets VITE_ANALYTICS_URL;
 * without it, or when the Worker can't be reached, the long link is used. */

const ANALYTICS_URL: string | undefined = import.meta.env.VITE_ANALYTICS_URL
const SHARE_URL = ANALYTICS_URL ? new URL('share', ANALYTICS_URL).toString() : undefined
const HASH_KEY = '#s='
const ID = /^[0-9A-Za-z]{8,16}$/
const TIMEOUT_MS = 8000

function withTimeout(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined
}

/** The short link for a long one (`<site>...#d=...`), or the long one when
 * no short link could be made. Never rejects. */
export async function shortenShareLink(longUrl: string): Promise<string> {
  const at = longUrl.indexOf('#')
  if (!SHARE_URL || at < 0) {
    return longUrl
  }
  try {
    const response = await fetch(SHARE_URL, { method: 'POST', body: longUrl.slice(at + 1), signal: withTimeout() })
    const id: unknown = response.ok ? ((await response.json()) as { id?: unknown }).id : null
    return typeof id === 'string' && ID.test(id) ? `${longUrl.slice(0, at)}${HASH_KEY}${id}` : longUrl
  } catch {
    return longUrl
  }
}

/** The id of a short link, given its fragment or the whole link as text;
 * null when it isn't one. */
export function shortLinkIdOf(text: string): string | null {
  const trimmed = text.trim()
  const at = trimmed.indexOf(HASH_KEY)
  if (at < 0 || (at > 0 && !/^https?:\/\/\S+$/.test(trimmed))) {
    return null
  }
  const id = trimmed.slice(at + HASH_KEY.length)
  return ID.test(id) ? id : null
}

/** When the page was opened with a short link: fetches the long fragment
 * and puts it in the address (replaceState - no navigation, no hashchange),
 * so the ordinary readers find it there. Returns the short fragment to put
 * back once a replay has been read (`restoreShortLink`), or an error result
 * for the page's status line. Null when the address holds no short link.
 * Never rejects. */
export async function resolveShortLinkInAddress(): Promise<{ shortHash: string } | { error: ReplayDecodeResult } | null> {
  const id = shortLinkIdOf(window.location.hash)
  if (id === null) {
    return null
  }
  const failed = (error: string) => ({ error: { ok: false, error } as ReplayDecodeResult })
  if (!SHARE_URL) {
    return failed("This short link can't be opened here: this copy of the site has no link service.")
  }
  try {
    const response = await fetch(`${SHARE_URL}/${id}`, { signal: withTimeout() })
    if (response.status === 404) {
      return failed('This short link is not known - check that it was copied in full.')
    }
    const fragment = response.ok ? await response.text() : ''
    if (!/^[dp]=[A-Za-z0-9_-]+$/.test(fragment)) {
      return failed("Couldn't open this short link right now. Try again in a moment.")
    }
    const shortHash = window.location.hash
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${fragment}`)
    return { shortHash }
  } catch {
    return failed("Couldn't open this short link - check your connection and try again.")
  }
}

/** Puts the short link back in the address once its replay has been read,
 * so the address bar (and the replay's "Copy link") keep the short form. */
export function restoreShortLink(shortHash: string): void {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${shortHash}`)
}

/** What main.tsx waits for before rendering: the technique link in the
 * address, short or long (see readReplayFromAddress). A short link to a
 * position (`p=`) is left in the address in its long form, for the page to
 * open and take off the address as it does any position link. */
export async function readSharedLinkFromAddress(variantPage: boolean): Promise<ReplayDecodeResult | null> {
  const short = await resolveShortLinkInAddress()
  if (short && 'error' in short) {
    return short.error
  }
  const replay = await readReplayFromAddress(variantPage)
  if (short && replay) {
    restoreShortLink(short.shortHash)
  }
  return replay
}
