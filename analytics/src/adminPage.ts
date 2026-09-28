// The /admin dashboard's page shell, login form and assets. The script and
// stylesheet live in their own files (bundled as text - see the [[rules]]
// in wrangler.toml) and are served from /admin/app.js and /admin/app.css,
// so the page's CSP can forbid inline script and style entirely.
import ADMIN_APP_JS from './dashboard.admin.js'
import ADMIN_CSS from './dashboard.admin.css'

export { ADMIN_APP_JS, ADMIN_CSS }

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

const HEAD = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sudoku Trainer Usage</title>
<link rel="icon" href="data:,">
<link rel="stylesheet" href="/admin/app.css">
</head>`

export function loginPageHtml(error?: string): string {
  return `${HEAD}
<body>
<form class="login" method="post" action="/admin/login">
  <h1>Sudoku Trainer · Usage</h1>
  ${error ? `<p class="err">${escapeHtml(error)}</p>` : ''}
  <input type="password" name="password" placeholder="Admin password" autocomplete="current-password" required autofocus>
  <button class="primary" type="submit">Sign in</button>
</form>
</body>
</html>`
}

export function adminPageHtml(): string {
  return `${HEAD}
<body>
<header class="top" id="toolbar"></header>
<main id="content"><p class="status">Loading…</p></main>
<div id="tooltip" hidden></div>
<dialog id="visit-dialog">
  <div class="dialog-head"><h3>Visit</h3><button type="button" class="close" aria-label="Close">✕</button></div>
  <div class="dialog-body"></div>
</dialog>
<script src="/admin/app.js" defer></script>
</body>
</html>`
}
