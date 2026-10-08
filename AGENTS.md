# Bella's Diary

Bella's Diary is a deliberately small offline-first PWA for tracking puppy
house-training events. Keep changes specific to this app and easy to maintain.

## Architecture

Use the existing architecture:

- Vanilla HTML, CSS and JavaScript; no build system or package manager.
- Native IndexedDB through `diaryRepository` in `storage.js` is the local
  working copy. UI reads/writes local data; recording never waits for network.
- localStorage holds the aggregate-window preference and an untouched legacy
  diary rollback snapshot. Do not mirror current diary data into it.
- A service worker and web app manifest provide the offline application shell.
- Optional Google authentication and household sync use the existing single
  Supabase client owned by `auth.js`; reuse it rather than creating another.
- `sync.js` reconciles complete household snapshots. `cloud-diagnostic.js`
  discovers authorized households and runs explicit disposable cloud tests.
- Supabase SQL migrations and manual verification scripts live in `supabase/`.

Do not introduce additional frameworks, dependencies, backends, analytics,
account providers or build tooling unless explicitly requested. Preserve the
existing Supabase integration; it is an authorized part of the application.

## Product priorities

In order:

1. Fast one-tap recording
2. Readable 24-hour timeline
3. Pattern recognition
4. iPad usability
5. Simple editing
6. Offline reliability
7. Maintainability

## Data and sync constraints

- Must work on iPad Safari and offline once the application shell is cached.
- Must not require horizontal scrolling.
- Timeline and Data views share the same event store and editor; most recent
  dates/events appear first.
- Local data remains available when signed out or offline. Auth/network failures
  must not block diary startup or roll back committed local edits.
- Fresh diaries start empty. Automatically physically purge local `demo:true`
  rows, including demo tombstones, while preserving real events, real
  tombstones, household binding and real conflict copies.
- Retain demo-field/old-backup compatibility. Disposable Stage 4C cloud tests
  may use `demo:true`; normal sync must never upload or import demo rows.
- After authenticated discovery of exactly one RLS-authorized household,
  automatically bind an unbound diary. Never choose between multiple households,
  auto-rebind a different household or erase data because of identity/binding.
- Normal cloud writes are household-scoped. Updates and tombstones require the
  expected `server_version`; never physically delete real cloud diary rows.
- Preserve `serverVersion` and `syncBaseMutationId` on local edits/tombstones,
  generating the usual new `mutationId`. Mutation equality identifies a clean
  payload; do not order mutation IDs or client timestamps to resolve conflicts.
- Preserve both local edits and cloud conflict copies. Stage 5C resolution is
  not implemented; do not silently choose a winner.
- Keep local mutations and cloud merges transactional, using the latest persisted
  diary. Preserve BroadcastChannel/focus refresh and the existing serialized
  background sync triggers, including return-to-active events.
- Do not add polling, Realtime, background service-worker sync or generic
  replication infrastructure unless explicitly requested.
- Never introduce secret/service-role credentials. Browser configuration uses
  the project base URL and publishable key; authorization relies on Auth/RLS.

## Persistence and PWA updates

Do not change storage schemas incompatibly without atomic migration logic.
Current IndexedDB/diary schema is version 4; JSON backups remain format version 2
with explicit support for older version 1 backups. Preserve real metadata,
tombstones, ordering and binding during migrations/imports.

Bump the cache version in `sw.js` when cached application-shell files change.
Cache only the static shell, never Supabase API responses or the external SDK.
README and AGENTS changes alone do not require a cache bump.

## Verification

Use the existing dependency-free browser suite at
`http://127.0.0.1:8137/tests/indexeddb.html`, served with
`python -m http.server 8137 --bind 127.0.0.1`. It uses real IndexedDB and resets
only that disposable origin; never run destructive tests against the real diary.
After online checks pass, stop the server and run the offline checks from the
already open test page. The current suite has 215 checks, including SDK-stub
Auth, diagnostic and sync coverage. Check JavaScript syntax and `git diff --check`
for code changes. Live Google/RLS, two-device sync and iPad Home Screen behavior
require manual verification as documented in README.
