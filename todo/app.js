// To-do app backed by PrefsDB (https://prefsdb.com).
// Each to-do is one entry in the map "todos", keyed by its id, under project "todo-app".

const APP_NAME = "todo-app";
const MAP = "todos";

// Google sign-in needs your own OAuth client ID (see README). Leave empty to hide the Google button.
const GOOGLE_CLIENT_ID = "";

let db = null;
let account = null; // { kind: "password", email, passphrase } or { kind: "sso", provider }; memory only
let sso = null;
let todos = [];
let filter = "all";

const $ = (id) => document.getElementById(id);

// ---------- views & status ----------

function show(view) {
  for (const v of ["signin-view", "verify-view", "todo-view"]) $(v).hidden = v !== view;
}

function setStatus(msg, isError = false) {
  $("status").textContent = msg || "";
  $("status").classList.toggle("error", isError);
}

function describeError(err) {
  return (err && (err.message || err.error)) || String(err);
}

// "Refresh token" / "Expired token" / SESSION_*: the key is fine, its session isn't.
function isSessionError(res) {
  return /SESSION_|refresh token|expired token/i.test(`${res.error || ""} ${res.message || ""}`);
}

// ---------- PrefsDB ----------

// Gets the key again, which also starts a fresh session.
async function connect() {
  if (account.kind !== "password") {
    throw { error: "SESSION_EXPIRED", message: "Your session ended. Please sign in again." };
  }
  const { email, passphrase } = account;
  db = await PrefsDB.getkey(APP_NAME, [email, passphrase], { email });
  return db;
}

// The scope every call uses; builder state resets after each request.
function store() {
  return db.project(APP_NAME).map(MAP);
}

// Runs a PrefsDB call; if the session is missing or expired, renews it once and retries.
async function call(fn) {
  let res = await fn();
  if (res && res.success === false && isSessionError(res)) {
    await connect();
    res = await fn();
  }
  if (res && res.success === false) throw res;
  return res;
}

function parseEntry(v) {
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return null; }
  }
  return v && typeof v === "object" && v.id ? v : null;
}

async function loadTodos() {
  const res = await call(() => store().read());
  const raw = res.values ?? (res.count ? [res.value] : []);
  todos = raw.map(parseEntry).filter(Boolean).sort((a, b) => a.created - b.created);
}

function saveTodo(todo) {
  return call(() => store().put(todo.id, JSON.stringify(todo)));
}

function removeTodo(id) {
  return call(() => store().remove(id));
}

// ---------- rendering ----------

function render() {
  const list = $("todo-list");
  list.replaceChildren();

  const visible = todos.filter((t) =>
    filter === "all" ? true : filter === "done" ? t.done : !t.done);

  for (const todo of visible) {
    const li = document.createElement("li");
    li.className = todo.done ? "done" : "";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = todo.done;
    box.addEventListener("change", () => toggle(todo));

    const text = document.createElement("span");
    text.className = "text";
    text.textContent = todo.text;
    text.title = "Double-click to edit";
    text.addEventListener("dblclick", () => edit(todo, li, text));

    const del = document.createElement("button");
    del.className = "delete";
    del.textContent = "×";
    del.title = "Delete";
    del.addEventListener("click", () => destroy(todo));

    li.append(box, text, del);
    list.append(li);
  }

  if (!visible.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = todos.length ? "Nothing here." : "No to-dos yet.";
    list.append(li);
  }

  const left = todos.filter((t) => !t.done).length;
  $("remaining").textContent = `${left} item${left === 1 ? "" : "s"} left`;
  $("clear-done").hidden = !todos.some((t) => t.done);
  document.querySelectorAll("[data-filter]").forEach((b) =>
    b.classList.toggle("active", b.dataset.filter === filter));
}

// ---------- actions (optimistic, rolled back on failure) ----------

async function guarded(action, rollback) {
  try {
    await action();
    setStatus("");
  } catch (err) {
    rollback();
    render();
    setStatus("Couldn't save: " + describeError(err), true);
  }
}

async function add(text) {
  const todo = { id: crypto.randomUUID(), text, done: false, created: Date.now() };
  todos.push(todo);
  render();
  await guarded(() => saveTodo(todo), () => { todos = todos.filter((t) => t !== todo); });
}

async function toggle(todo) {
  todo.done = !todo.done;
  render();
  await guarded(() => saveTodo(todo), () => { todo.done = !todo.done; });
}

async function destroy(todo) {
  const index = todos.indexOf(todo);
  todos.splice(index, 1);
  render();
  await guarded(() => removeTodo(todo.id), () => { todos.splice(index, 0, todo); });
}

function edit(todo, li, span) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "edit";
  input.value = todo.text;
  input.maxLength = 500;
  li.replaceChild(input, span);
  input.focus();

  let finished = false;
  const finish = async (commit) => {
    if (finished) return;
    finished = true;
    const text = input.value.trim();
    if (!commit || !text || text === todo.text) return render();
    const before = todo.text;
    todo.text = text;
    render();
    await guarded(() => saveTodo(todo), () => { todo.text = before; });
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

async function clearDone() {
  const done = todos.filter((t) => t.done);
  todos = todos.filter((t) => !t.done);
  render();
  await guarded(
    () => call(() => store().keys(done.map((t) => t.id)).delete()),
    () => { todos = todos.concat(done).sort((a, b) => a.created - b.created); });
}

// ---------- sign in / out ----------

async function openList() {
  setStatus("Loading…");
  await loadTodos();
  setStatus("");
  show("todo-view");
  render();
  $("new-todo").focus();
}

function showVerify(msg = "") {
  $("verify-email").textContent = account.email;
  setStatus(msg, !!msg);
  show("verify-view");
}

let signingIn = false;

// Email + passphrase. Also used after the verification link is clicked:
// getkey() runs again first, so the list loads with a fresh session.
async function signIn() {
  if (signingIn) return;
  signingIn = true;
  setStatus("Signing in…");
  try {
    await connect();
    if (db.emailVerificationRequired()) return showVerify();
    await openList();
  } catch (err) {
    if (err && err.error === "UNVERIFIED") return showVerify("This account isn't verified yet. Click the link in the email first.");
    setStatus("Sign-in failed: " + describeError(err), true);
  } finally {
    signingIn = false;
  }
}

// Google / GitHub, through PrefsDB's sign-in add-on.
function setupSso() {
  sso = PrefsDB.signIn({
    name: APP_NAME,
    ...(GOOGLE_CLIENT_ID ? { google: { clientId: GOOGLE_CLIENT_ID } } : {}),
    github: true,
    theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    onStart: () => setStatus("Signing in…"),
    onSignIn: async (signedIn, { provider }) => {
      db = signedIn;
      account = { kind: "sso", provider };
      try {
        await openList();
      } catch (err) {
        setStatus("Sign-in failed: " + describeError(err), true);
      }
    },
    onError: (err) => {
      if (err.error === "POPUP_CLOSED" || err.error === "GITHUB_SIGNIN_CANCELLED") return setStatus("");
      setStatus(`Sign-in with ${err.provider || "provider"} failed: ${describeError(err)}`, true);
    },
  });
  sso.mount("#sso");
}

function signOut() {
  if (account && account.kind === "sso" && sso) sso.signOut();
  db = null;
  account = null;
  todos = [];
  $("signin-form").reset();
  setStatus("");
  show("signin-view");
}

// ---------- wiring ----------

$("signin-form").addEventListener("submit", (e) => {
  e.preventDefault();
  account = {
    kind: "password",
    email: $("email").value.trim().toLowerCase(),
    passphrase: $("passphrase").value,
  };
  signIn();
});

$("verify-continue").addEventListener("click", signIn);
$("verify-cancel").addEventListener("click", signOut);
$("signout").addEventListener("click", signOut);
$("clear-done").addEventListener("click", clearDone);

// Coming back to this tab from the verification email: try again automatically.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !$("verify-view").hidden) signIn();
});

$("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("new-todo").value.trim();
  if (!text) return;
  $("new-todo").value = "";
  add(text);
});

document.querySelectorAll("[data-filter]").forEach((b) =>
  b.addEventListener("click", () => { filter = b.dataset.filter; render(); }));

if (location.protocol !== "https:") {
  setStatus("PrefsDB needs this page served over HTTPS — sign-in won't work over " + location.protocol, true);
} else {
  setupSso();
}
