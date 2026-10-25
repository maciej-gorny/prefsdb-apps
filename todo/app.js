// To-do app backed by PrefsDB (https://prefsdb.com).
// Each to-do is one entry in the map "todos", keyed by its id, under project "todo-app".

const APP_NAME = "todo-app";
const MAP = "todos";

// Google sign-in needs your own OAuth client ID (see README). Leave empty to hide the Google button.
const GOOGLE_CLIENT_ID = "";

let db = null;
let todoStore = null; // db.project(APP_NAME).map(MAP), kept: a chain never changes db, so it can be reused
let account = null; // { kind: "password", email } or { kind: "sso", provider }; memory only
let sso = null;
let waiting = null; // AbortController while waiting for the email link to be clicked
let unwatch = null; // removes the onSessionExpired listener of the current key
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

// ---------- PrefsDB ----------

// The client keeps the session itself (it renews it before it runs out), so
// a key only stops working when renewing it is impossible: a Google/GitHub
// sign-in older than 7 days, or a key that was rotated or removed.
function useKey(key) {
  if (unwatch) unwatch();
  db = key;
  todoStore = db.project(APP_NAME).map(MAP);
  unwatch = db.onSessionExpired(() => {
    signOut();
    setStatus("Your session ended. Please sign in again.", true);
  });
}

// Runs a PrefsDB call and throws its error object (check err.error, a stable code).
async function call(fn) {
  const res = await fn();
  if (res && res.success === false) throw res;
  return res;
}

function parseEntry(v) {
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return null; }
  }
  return v && typeof v === "object" && v.id ? v : null;
}

// entries() gives [{ key, value }] whether the map holds one to-do or many.
async function loadTodos() {
  const entries = await todoStore.entries();
  todos = entries.map((e) => parseEntry(e.value)).filter(Boolean).sort((a, b) => a.created - b.created);
}

function saveTodo(todo) {
  return call(() => todoStore.put(todo.id, JSON.stringify(todo)));
}

function removeTodo(id) {
  return call(() => todoStore.remove(id));
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
    if (!db) return; // signed out meanwhile (session ended): that message stays
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
    () => call(() => todoStore.keys(done.map((t) => t.id)).delete()),
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

function showVerify() {
  $("verify-email").textContent = account.email;
  setStatus("");
  show("verify-view");
}

let signingIn = false;

// Email + passphrase. A new account waits on this page until its link is
// clicked: waitForVerification() checks every few seconds, and at once when
// the user comes back to this tab from their inbox. An address at
// sandbox.prefsdb.com makes a test key, which needs no email (see README).
async function signIn(email, passphrase) {
  if (signingIn) return;
  signingIn = true;
  setStatus("Signing in…");
  try {
    account = { kind: "password", email };
    useKey(await PrefsDB.getkey(APP_NAME, [email, passphrase], { email }));
    if (db.emailVerificationRequired()) {
      showVerify();
      waiting = new AbortController();
      await db.waitForVerification({ signal: waiting.signal });
      waiting = null;
    }
    await openList();
    if (db.testKey()) setStatus("Test account: it works without an email and is deleted after a day.");
  } catch (err) {
    if (err && err.error === "ABORTED") return; // "Use a different account"
    show("signin-view");
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
    onSignIn: async (signedIn, { provider, previousProvider }) => {
      useKey(signedIn);
      account = { kind: "sso", provider };
      try {
        await openList();
        // Each way of signing in is a separate account with its own list.
        if (previousProvider) {
          const names = { google: "Google", github: "GitHub", microsoft: "Microsoft", apple: "Apple" };
          setStatus(`You signed in with ${names[previousProvider] || previousProvider} last time. This is a separate account with its own list.`);
        }
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
  if (waiting) waiting.abort();
  waiting = null;
  if (account && account.kind === "sso" && sso) sso.signOut();
  if (unwatch) unwatch();
  unwatch = null;
  db = null;
  todoStore = null;
  account = null;
  todos = [];
  $("signin-form").reset();
  setStatus("");
  show("signin-view");
}

// ---------- wiring ----------

$("signin-form").addEventListener("submit", (e) => {
  e.preventDefault();
  signIn($("email").value.trim().toLowerCase(), $("passphrase").value);
});

$("verify-cancel").addEventListener("click", signOut);
$("signout").addEventListener("click", signOut);
$("clear-done").addEventListener("click", clearDone);

$("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("new-todo").value.trim();
  if (!text) return;
  $("new-todo").value = "";
  add(text);
});

document.querySelectorAll("[data-filter]").forEach((b) =>
  b.addEventListener("click", () => { filter = b.dataset.filter; render(); }));

// https:, or http://localhost while developing (PrefsDB refuses other plain-http pages).
setupSso();
