# To-do (PrefsDB)

A static to-do app with no backend: data lives in [PrefsDB](https://prefsdb.com).

- **Sign-in:** email + passphrase are the seed for `PrefsDB.getkey("todo-app", [email, passphrase], { email })`.
  The client hashes the seed in the browser. A new account gets a verification email; the page waits with
  `db.waitForVerification()` and opens the list as soon as the link is clicked.
- **Testing without an inbox:** sign in with any address at `sandbox.prefsdb.com` (e.g. `dev@sandbox.prefsdb.com`).
  That makes a PrefsDB test key: it works at once, has small limits and is deleted after a day.
- **Google / GitHub sign-in:** PrefsDB's sign-in add-on (`prefsdb.signin.v1.min.js`) gives each Google or GitHub account
  its own key. No email step is needed. GitHub works with no setup. Google needs your own OAuth client ID: create a
  "Web application" client in Google Cloud, add `http://localhost:8080` (and your real host) under
  *Authorized JavaScript origins*, then paste the ID into `GOOGLE_CLIENT_ID` in `app.js`. Each way of signing in is a
  separate account with its own list; the app says so when someone switches.
- **Storage:** each to-do is one entry in the map `todos` (project `todo-app`), keyed by its id, with a JSON value
  `{ id, text, done, created }`, read back with `entries()`. Edits overwrite the entry; deletes remove it; "Clear done"
  deletes several keys in one call.
- **Session:** the PrefsDB client keeps the session and renews it by itself. The app only hears about it when renewing
  is impossible (`db.onSessionExpired()`, e.g. a Google/GitHub sign-in older than 7 days) and then asks to sign in again.
  The passphrase is never stored, so reloading the page means signing in again.
- **Client:** `index.html` loads PrefsDB client release 1.0.0 with its SRI hash, so the browser refuses a changed file.
  Newer releases and their hashes are listed at https://prefsdb.com/v/versions.json.

## Run

Serve the folder from `https://` anywhere (GitHub Pages, Netlify, Cloudflare Pages, ...), or locally from
`http://localhost`, which PrefsDB accepts while you develop:

    node serve.js        # http://localhost:8080/
    # or: python3 -m http.server 8080 --bind localhost

Keys are tied to the page's origin, so a list created on one host won't appear on another.

## Use

Add with Enter, tick to complete, double-click to edit (Enter saves, Esc cancels), × to delete.
