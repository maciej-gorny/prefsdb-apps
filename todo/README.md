# To-do (PrefsDB)

A static to-do app with no backend: data lives in [PrefsDB](https://prefsdb.com).

- **Sign-in:** email + passphrase are the seed for `PrefsDB.getkey("todo-app", [email, passphrase], { email })`.
  The client hashes the seed in the browser. A new account gets a verification email and works once the link is clicked.
- **Google / GitHub sign-in:** PrefsDB's sign-in add-on (`prefsdb.signin.v1.min.js`) gives each Google or GitHub account
  its own key. No email step is needed. GitHub works with no setup. Google needs your own OAuth client ID: create a
  "Web application" client in Google Cloud, add `https://localhost:8443` (and your real host) under
  *Authorized JavaScript origins*, then paste the ID into `GOOGLE_CLIENT_ID` in `app.js`. These are separate accounts
  from email + passphrase ones, so the same person gets a different list.
- **Storage:** each to-do is one entry in the map `todos` (project `todo-app`), keyed by its id, with a JSON value
  `{ id, text, done, created }`. Edits overwrite the entry; deletes remove it; "Clear done" deletes several keys in one call.
- **Session:** the session lasts 8 hours. If it expires, the app calls `getkey` again with the credentials it holds in memory.
  The passphrase is never saved, so reloading the page means signing in again.

## Run

PrefsDB's `getkey` only works on a page served over **HTTPS** (plain `http://localhost` won't keep the session cookie).
Some options:

- Deploy the folder to any static HTTPS host (GitHub Pages, Netlify, Cloudflare Pages, ...).
- Locally: `node serve.js` serves the folder at `https://localhost:8443/` using the self-signed certificate in `.cert/`
  (expect a browser warning). To make a new certificate:
  `openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout .cert/key.pem -out .cert/cert.pem -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`

Keys are tied to the page's origin, so a list created on one host won't appear on another.

## Use

Add with Enter, tick to complete, double-click to edit (Enter saves, Esc cancels), × to delete.
