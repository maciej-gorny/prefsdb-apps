# PrefsDB demo apps

Small demo apps that keep their data in [PrefsDB](https://prefsdb.com) instead of their own backend.

## [To-do](todo/)

A to-do list that runs as plain static files: HTML, CSS and JavaScript, with no build step and no server code.

- **Sign in** with Google, GitHub, or an email and passphrase. Each user gets their own PrefsDB key, so their list
  follows them to any device.
- **Manage to-dos:** add, tick off, edit (double-click), delete, filter by All / Active / Done, and clear finished items.
- **Storage:** each to-do is saved as one entry in a PrefsDB map. Changes appear instantly and are undone if a save fails.

To run it locally over HTTPS (PrefsDB requires it), see [todo/README.md](todo/README.md).
