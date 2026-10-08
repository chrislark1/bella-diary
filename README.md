# Bella's Diary

A small offline-first puppy house-training diary for Bella. Vanilla HTML, CSS and JavaScript; no build system or analytics. Optional Google sign-in and household sync use Supabase; IndexedDB remains the immediate local working copy.

## Run

Open a terminal **in this directory** and run:

```sh
python3 -m http.server 8080
```

Then open http://localhost:8080. The Python process stays running in the terminal and does not automatically open a browser. On Windows, `python -m http.server 8080` or `py -m http.server 8080` may be the available command. Do not open index.html directly: service workers need HTTP on localhost or HTTPS.

## Files

- `index.html`: accessible page and shared event editor.
- `styles.css`: responsive layout with a shared timeline plotting grid.
- `app.js`: diary behavior, filtering, rendering, editing, statistics and backups.
- `storage.js`: asynchronous whole-diary repository, native IndexedDB persistence and legacy migration.
- `supabase-config.js`: Project URL and browser publishable-key placeholders.
- `auth.js`: independent Google authentication; pinned CDN client and account controls.
- `cloud-diagnostic.js`: authenticated household discovery and explicit temporary cloud test.
- `sync.js`: household snapshot reconciliation and optimistic event writes using the existing Auth client.
- `manifest.json`: standalone installation metadata.
- `sw.js`: complete offline app-shell cache.
- `icons/`: 192px and 512px PNG icons and SVG favicon.

## Using the diary

Fresh diaries start empty. Existing local sample rows (`demo:true`), including sample tombstones, are automatically physically purged in one local transaction. Real records, tombstones, household binding and real conflict copies remain intact. Older JSON backups still validate; sample records are discarded on import. This cleanup does not create cloud deletion operations. The `demo` field and legacy `demoCleared` metadata remain compatible with backups and cloud diagnostics.

Quick Wee/Poo/Meal buttons save immediately using local date and time. Wee and poo default to Outside; the dedicated **Inside wee / Inside poo** buttons record an inside accident immediately, without opening an editor. Poo defaults to Normal. Meal details start empty. Use Custom entry or tap a timeline mark / table row to edit, change location, add details, or delete. Both views share the same editor. The five filters apply only to Timeline and Data; switching views preserves the filter. Summary and statistics always use the whole diary. All recorded dates stay visible in the timeline, including dates with zero matches under a filter.

The **Diary / Stats** tabs at the top right switch between the diary and its separate Patterns & statistics panel. The top-right **···** menu holds JSON/CSV backups and the local/offline status. Quick recording remains available in both views. Returning to Diary preserves the Timeline/Data choice and current filter. Diary filters sit next to the Diary heading and apply to Timeline and Data. The likelihood buckets always describe the full diary.

**When things usually happen** has separate Wee/Poo/Meal rows of 24 one-hour buckets, aligned with the timeline's 00–24 axis. Choose the last 7, 14 or 30 calendar days, or all time; the choice is saved on this device. Each bucket's share is its portion of all logged events of that type in the chosen window. Shading is scaled to that type's busiest hour in the same window, so the most active bucket always stands out even as the routine changes. For example, five of twenty recorded wees at 08:00 gives a 25% event share; its shading also reflects how that compares with the busiest wee hour. Tap a bucket for the event share and count, its distinct diary-day count, and its relative shading; keyboard focus and the tooltip expose the same detail. Event shares for each row total 100% (allowing rounding). Empty types/buckets stay uncoloured. It describes recorded events, not a forecast; sparse or incomplete logging can skew it. Demo entries contribute until cleared.

Overlapping marks intentionally share one central lane at their actual times, with larger invisible tap targets. The Data tab lets you inspect and edit any obscured events. Historical rows retain a fixed 38px height and grow vertically. Timeline rows show dates without per-day event counts.

## Storage and backups

The app reads and writes the complete diary through the asynchronous `diaryRepository` interface in `storage.js`. Active diary data lives in this browser's native IndexedDB database `bellaDiary`, version 4 (previously 3). The `events` object store has one event record per `id`, including deleted records; the `meta` object store is keyed by `key` and holds `schemaVersion`, `demoCleared`, `initialized`, `eventOrder`, `householdId` and `syncConflicts`. The order metadata preserves the existing event sequence, including JSON export order. Each save replaces events and metadata in a single transaction and is successful only when that transaction completes.

Diary schema version 4 requires `createdAt`, `updatedAt`, `deletedAt`, `mutationId`, nullable `serverVersion` and nullable `syncBaseMutationId`. The version-3 upgrade adds only a null mutation baseline plus empty conflict metadata, preserving the binding, content and ordering. Version 2 gains null version/baseline and binding; version 1 gains validated creation/update/deletion/mutation metadata. Each native versionchange migration validates and replaces data atomically; failure rolls back the database version and leaves the prior data recoverable. Old connections close on versionchange and cannot reopen the upgraded database at an older version.

On first use of IndexedDB, an existing `bellaDiary.store` localStorage diary is parsed and passed through the app's existing validation before migration. Only a successful transaction marks IndexedDB initialized. Later launches use IndexedDB directly. The original localStorage value is deliberately left untouched as a rollback snapshot: new events, edits and imports do not update it. A fresh browser with neither diary initializes an empty diary through the repository once. Initialization checks inside the write transaction prevent two starting windows from overwriting each other's first diary.

The separate `bellaDiary.aggregateWindow` preference remains in localStorage. Other diary windows refresh after BroadcastChannel save notifications when available, and when focused or made visible. Saves within one window are queued so rapid recording keeps each entry. Normal mutations and sync merges transform the latest persisted diary in one transaction, avoiding stale-window replacement of unrelated changes. JSON import remains an explicit whole-diary replacement.

`createdAt` and `updatedAt` are canonical UTC ISO instants. Creation sets them equal; edits preserve creation and replace update time. `deletedAt` is null while active. Every create/edit/delete also mints an opaque `mutationId` without user identity. Rendering/loading do not change metadata. Sync uses server versions for concurrency and mutation equality for local changes; client timestamps and mutation ordering never decide conflicts. Timestamp validation still requires logical creation/update/deletion order; an incorrectly set device clock can require correction before editing.

Delete retains the record as a tombstone, setting `deletedAt` and `updatedAt` to the same current instant. One active-event boundary excludes tombstones from timeline dates, tables, filters, counts, streaks, buckets, statistics, meal relationships and CSV. Tombstones survive reloads and JSON restoration; there is no automatic tombstone expiry. Automatic sample cleanup physically purges every `demo:true` record while retaining real records and their tombstones.

An event's datetime is a local wall-clock ISO string `YYYY-MM-DDTHH:mm`; existing events keep their recorded calendar time if you later change timezone. Storage survives normal refresh, close/reopen and Home Screen relaunch in the same browser storage context. Browser profiles, devices and some installation contexts may have separate storage. Private browsing or clearing site data can remove the diary: JSON export remains the supported user backup, so export regularly. The retained legacy snapshot becomes stale after migration and is not a current backup.

Export JSON format version 2 includes an export timestamp, `demoCleared`, and every record in storage order, including metadata and tombstones. Import version 2 strictly validates UTC timestamps, modification order (`updatedAt >= createdAt`, `deletedAt <= updatedAt`), change IDs and existing event fields; it preserves metadata unchanged, including `serverVersion` when present. Older version-2 backups without that field restore it as null. The mutation baseline is retained when present and otherwise null; unknown versioned imports are reconciled conservatively. Conflict cloud copies are included when present. Household binding is not exported or imported: restoring events keeps the current device binding. Version 1 backups remain supported through an explicit upgrade that assigns current migration metadata and retains IDs/order/demo provenance. Version 1 timezone-qualified ISO datetimes retain the existing compatibility conversion to this device's local calendar time; local strings keep their wall-clock time. Import **replaces the whole diary after confirmation**; invalid files leave it intact. CSV includes only active events regardless of filters, with the existing columns, quoted values, UTF-8 BOM and formula-safe text. JSON is the lossless restore format; CSV is for analysis and cannot restore the diary.

Failed writes and transaction aborts leave both the committed database and current in-memory diary unchanged and show an error. IndexedDB open failures, unavailable storage, corrupt diaries and migration failures block mutations without seeding demo data or overwriting the legacy snapshot. An incomplete database is treated as an error. Export before changing browser storage settings; for recovery, preserve the IndexedDB data and any raw `bellaDiary.store` rollback value through browser developer tools before clearing storage.

## Offline and iPad installation

On wide, short screens such as the iPad mini in landscape, a compact layout reduces header, entry-control, bucket, and timeline spacing to keep more of the current week visible. The timeline still scrolls vertically as more dates are recorded.

After the first successful online load, wait for **Ready for offline use**. The service worker has then cached the entire static shell. Reload, entry creation, editing, deleting, filtering, statistics and JSON/CSV backups work without a network. No server persistence is required. The web server is only for initial loading and updates.

On iPad Safari, serve the static directory from a suitable HTTPS origin, open it, then choose Share → Add to Home Screen. Plain HTTP at a computer's LAN IP is not a suitable secure origin for service workers; `localhost` on iPad refers to the iPad itself. Installation should be checked on the target iPad. Browser storage may be evicted, so an installed PWA is not a substitute for backups.

For app updates, bump `CACHE` in `sw.js` whenever shell files change. The new worker precaches the new shell before activation, removes only old Bella's Diary shell caches, and never touches diary storage. Reload after the update activates. Only optional authentication loads the pinned Supabase library and contacts Supabase/Google. The service worker handles same-origin files only; it does not intercept or cache CDN or Supabase requests.

## Google sign-in (Stage 4B)

Replace `__SUPABASE_URL__` and `__SUPABASE_PUBLISHABLE_KEY__` in `supabase-config.js` with the Supabase **Project URL** and **publishable key** from the project dashboard. Use the `sb_publishable_...` key, not a legacy JWT key. The Project URL must be the HTTPS origin only, without `/rest/v1`, `/auth/v1`, query parameters or a fragment; API paths are rejected before client initialization. A root trailing slash is normalized away. These values are browser-safe configuration; authorization relies on Stage 4A RLS. Never commit a database password, service-role/secret credential or Google client secret. Until configured, authentication is disabled and the local diary remains available.

The **··· > Cloud account** section offers Google sign-in, name/email and sign-out. Sync state and the manual Sync now action appear in the same area. `auth.js` independently loads the official UMD client pinned at `@supabase/supabase-js@2.117.2` from jsDelivr. The SDK manages persisted sessions, token refresh and PKCE callback detection. No Google provider tokens are separately stored and cloud discovery uses that same client independently of diary startup. See [Supabase initialization](https://supabase.com/docs/reference/javascript/initializing) and [OAuth sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithoauth).

The redirect is the same-origin directory containing `auth.js`, with a trailing slash and no query/hash: normally `https://chrislark1.github.io/bella-diary/` for GitHub Pages and `http://localhost:8080/` for development. Custom domains/paths are derived automatically; an HTTP `index.html` URL redirects to its directory too. Supabase must allow the exact roots in use (`localhost` and `127.0.0.1` are separate origins). After SDK callback processing, auth parameters are cleaned from the URL. Raw provider/SDK errors are never displayed or logged.

Auth failures and bounded startup/action waits never delay IndexedDB startup. Offline account actions and refresh pause, while a known identity stays visible in the current window with **Offline · session not checked**. On an offline cold launch without a loaded CDN client, status is unavailable rather than assumed signed out. There is no separate identity/token cache: reconnect to load/check the SDK session. The local auth/config files join the static shell cache; the CDN bundle and Supabase API responses do not.

Sign-out uses Supabase's local session scope, leaving other devices signed in. It does not clear IndexedDB, legacy diary storage, demo state, preferences or downloaded backups. **IndexedDB remains shared by the browser profile and is now linked to at most one household.** Chris and Louise can use the same cache when authorized for that household. Signed-out/offline use still reads local data; this binding is sync scoping, not a local access-control boundary. A different discovered household is refused rather than switching or erasing data; a locally displayed identity is not proof of server authorization.

Manual sign-in check:

1. Replace the two placeholders and deploy/serve the files. If configuration was already cached, bump the service-worker cache version again and reload online after activation.
2. Confirm the actual app-root redirect is allowed in Supabase. Choose **··· > Cloud account > Sign in with Google**, finish Google sign-in and verify return to the same root with name/email and **Signed in · household diary sync**. Check callback code/error parameters disappear.
3. Reload and close/reopen in the same origin/browser profile; verify session restoration where persistence permits. Test localhost and production, iPad Safari and the Home Screen app. OAuth can open Safari in a different storage context; PKCE needs the initiating context's verifier. If Safari and the installed PWA have separate storage, complete sign-in in the same context and do not assume session transfer.
4. Go offline after caching. Record, edit and delete entries, reload and confirm persistence. Account controls must explain offline status; a session cannot be verified offline.
5. Reconnect and sign out; confirm diary/demo state remains after reload. Sign-out must not change local diary data. Signed-in household discovery reads cloud tables; the sync cycle automatically links an unbound diary after successful single-household discovery.

Bella has been created manually with Chris as its owner. This stage does not create households, memberships or additional users. Stage 5B excludes demo records and warns about non-UUID legacy/imported IDs, which remain local.

## Cloud connection diagnostic (Stage 4C)

Inside **... > Cloud account**, a signed-in account discovers its own RLS-authorized membership, requires exactly one household, reads its name and checks event SELECT access. Zero or multiple memberships stop the diagnostic with a clear message; no IDs or household names are hard-coded for authorization. `bellaAuth.getClient()` and `getUser()` let the diagnostic reuse the sole client owned by `auth.js`; no session/token accessor is exposed.

**Run cloud connection test** explicitly creates one unique `demo:true` wee with local wall-clock datetime and canonical UTC client metadata. It verifies the insert, reads it, updates note and mutation metadata, tombstones and reads it again, verifies database-assigned `server_updated_at` changes on both updates, then physically deletes that disposable row and verifies absence. Every mutation targets only this generated ID and household; update/delete also require `demo:true`. No test rows are created on startup. Failed or interrupted tests can leave a disposable row; a safe stage message and diagnostic ID identify an uncertain outcome when available. Later tests use fresh IDs and never bulk-delete earlier diagnostics.

The diagnostic itself never syncs diary data: its cloud reads stay in memory and its test does not access IndexedDB. The separate Stage 5B engine may run when signed in and linked. The diagnostic is unavailable offline, cancels in-flight requests on offline/account changes, and never blocks diary startup or queues retries. Its success proves the browser Auth / RLS / database path for this household, not foreign-household isolation or full sync correctness. **The cache now has a single household binding**, while local use remains available offline/signed out. Stage 5B enforces this scope before every reconciliation and uses conditional server-version updates.

Manual browser check (real Google sign-in is not automated):

1. Serve/deploy and reload online after shell cache v15 activates. Sign in to the actual PWA as Chris; open Cloud account and check **Household: Bella / Cloud access: Ready**.
2. Click **Run cloud connection test** once. Expect Authenticated access, Insert, Read, Update, Tombstone and Cleanup all **OK**. Verify your local diary is unchanged. Only a completed real-browser run proves live RLS connectivity.
3. Repeat: each run creates a new disposable ID and removes only that row. If a stage fails, check membership/RLS/connectivity and inspect the reported diagnostic ID manually; never delete real diary rows to resolve a test.
4. Go offline: the test button disables, the session stays visible, and local recording/editing/deleting still work. Reconnect and retry explicitly. Sign out: the diagnostic hides and local data remains.
5. Test iPad Safari and the Home Screen storage context. A second nonmember account should see a safe no-membership message; foreign-household isolation still requires the Stage 4A SQL/RLS checks.

## Sync preparation (Stage 5A)

Stage 5A adds only model preparation: cloud `server_version`, nullable local `serverVersion`, secure UUIDs for new local IDs and one nullable `householdId` in IndexedDB metadata. Newly recorded events use `crypto.randomUUID()` or a version-4 UUID built from `crypto.getRandomValues`; there is no timestamp/Math.random fallback. Existing legacy/imported IDs remain untouched to preserve references and backups. Test fixtures intentionally exercise non-UUID legacy IDs; before uploading an older import, Stage 5B must detect any such IDs. No real diary upload has occurred.

After successful authenticated discovery of exactly one household, Stage 5B automatically links an unbound local diary before syncing. Binding writes metadata only. The same household is idempotent; a different household shows a mismatch and cannot replace the binding. Offline, sign-out, normal saves, imports and stale windows preserve it. Stage 5A did not add automatic push/pull or conflict state; Stage 5B now supplies these below. No household selector or account-specific cache is added. Chris and Louise can share this cache when they belong to the same Bella household. See Stage 5B below for conflict handling and optimistic-concurrency updates.

Supabase steps (SQL has not been applied by this agent):

1. In the SQL Editor as admin, run **only** `supabase/migrations/20261007010000_stage5a_server_version.sql` once. Do not rerun/rewrite Stage 4A. Existing cloud rows receive version 1. The existing trigger forces insert version 1, increments the old version on every update, regenerates `server_updated_at`, and rejects changes to `id`, `household_id` or `client_created_at`. No RLS policies or grants change.
2. Run the complete `supabase/manual/verify-stage5a.sql` block. Expect the PASS notice for versions/timestamps/immutable fields; its disposable fixtures roll back. This admin test verifies the trigger, not RLS.
3. Reload the PWA online after shell v15 activates, sign in, and run the Stage 4C connection test. It deliberately submits `server_version:999` on insert and both updates and accepts only returned versions **1, 2, 3**, while continuing to verify server timestamps and delete the disposable row. An unmigrated cloud database fails safely; the local diary remains available.
4. Confirm the local diary automatically links to the discovered Bella household. Verify the binding survives reload, sign-out and offline entry recording. The browser test suite covers mismatch refusal; foreign-household RLS isolation remains the Stage 4A test's responsibility.

Stage 5B updates an event only when its cloud version still equals the last accepted local `serverVersion`, then stores the returned next version. Cloud bigint versions are accepted locally only as positive safe integers; `null` means no accepted cloud version yet. Local edits and tombstones retain that value. JSON stays format version 2 with this extra event field; CSV stays unchanged.

## Household diary sync (Stage 5B)

IndexedDB drives every view and receives each local mutation before any network work. Sync uses the sole Supabase Auth client and verifies the current session, exactly one RLS-authorized household and the existing local binding before fetching the complete non-demo household snapshot (explicitly paged to avoid the server row cap). An unbound diary is automatically linked after successful single-household discovery, and that same cycle continues with sync. Zero/multiple households never bind. Signed-out, offline and mismatched diaries never push or pull normal events. The independent diagnostic still works without a binding.

The sole event baseline is `syncBaseMutationId: null | string`. New events have null baseline/version. An accepted insert/update records the returned server version and accepted mutation ID. Equality with `mutationId` means clean; normal edits/tombstones mint a new mutation and preserve baseline/version. Mutation IDs are compared only for equality, never ordered. IndexedDB schema 4 atomically migrates existing records with a null baseline; an older/imported versioned record is treated as unknown until its entire mapped payload proves equivalent to cloud. JSON remains backup format 2 and retains these fields; CSV is unchanged.

Unsynced UUID events insert without server-generated fields. Dirty events update only with matching ID, household and expected `server_version`. Deletes are UPDATE tombstones, never normal SQL DELETEs. Clean local copies accept cloud payloads and their mutation/version baseline, including tombstones. Local samples are purged; cloud diagnostic demos remain excluded. Non-UUID IDs stay unchanged and produce a warning while other entries can sync.

A dirty event with an advanced cloud version, a zero-row conditional update or an ambiguous same-ID collision becomes a conflict. Local edits remain intact. A tiny cloud-copy snapshot is retained in IndexedDB metadata (`syncConflicts`) and included alongside local events in JSON backups. The Cloud account status shows the number of entries needing attention. Conflicted entries stop automatic writes while other entries continue; subsequent snapshots refresh their retained cloud copies. **Resolution is deferred to Stage 5C**; editing or importing alone does not clear an existing conflict. No timestamps choose a winner. Missing cloud rows for previously synced local events also remain conservative conflicts.

Cloud merges read and transform the latest diary in one native read/write transaction. A later local edit keeps its content and new mutation even if an older attempted write succeeds; only that older accepted baseline advances, and the queued cycle can push the later edit. Failed transactions roll back all local changes. Existing BroadcastChannel/focus refreshes notify other windows. Cloud and IndexedDB cannot commit as one distributed transaction: if a cloud update succeeds but its local acknowledgment fails, a later cycle may conservatively flag a conflict; both copies remain available.

Sync runs on online authenticated startup, sign-in, reconnect, completed local saves, window focus and returning to a visible tab, plus **... > Cloud account > Sync now**. One in-flight cycle and one queued flag serialize triggers in each window; different windows remain protected by server-version conditions and transactional merges. Failures keep local data/session intact and show a safe issue; the next trigger/manual action retries. No durable retry queue, realtime or service-worker background sync is used. Shell v15 includes `sync.js`; external SDK/API responses are never cached. No SQL/RLS changes are needed beyond the completed Stage 5A migration.

Live acceptance uses two browser profiles/devices signed into the same household, with each unbound local diary automatically linked after discovery. Use disposable **real** entries:

1. A records an entry; wait for Synced and verify its non-demo cloud row/version 1.
2. B uses Sync now; verify the entry appears with the same ID.
3. B edits it and syncs; A syncs and sees the edit and incremented version.
4. Take B offline, add/edit an entry and reload: UI and persistence must work immediately. Reconnect; A syncs and receives it.
5. Delete a test entry normally; sync both devices and verify a retained cloud tombstone and no active mark/table row.
6. Sync both to the same version, take B offline, edit the same event differently on both, sync A, then reconnect B. Expect an attention status, B's local edit retained and A's cloud version retained in B's JSON backup; neither silently wins.
7. Sign out and exercise local recording. Reconnect/sign in and repeat on iPad Safari/Home Screen. Verify mismatch/no-membership errors safely prevent normal event sync.

Clean up test entries through ordinary diary tombstones, not SQL deletes. These live checks are not automated by the SDK-stub suite. Adding Louise requires her existing RLS membership in the same household after live validation; no household provisioning or membership changes are implemented here. Resolve/understand the Stage 5C conflict limitation before relying on simultaneous edits.

## Persistence acceptance checks

Run `python -m http.server 8137 --bind 127.0.0.1` in this directory, then open `http://127.0.0.1:8137/tests/indexeddb.html` and run the checks. The browser suite has 215 checks, no test dependencies, and uses real IndexedDB and the production app. It preserves the 85 persistence checks and adds SDK-stub tests for CDN failures, auth outages/pending requests, account UI, client options, offline behavior and sign-out/data isolation. Stage 5A adds native version-2-to-4 migration/rollback, UUID fallback, serverVersion preservation, household binding/mismatch and server-version diagnostic checks. Stage 4C adds SDK-stub checks for membership selection, the disposable CRUD/tombstone/cleanup sequence, unchanged/missing server timestamps, cloud failures, offline cancellation and client/data isolation. Stage 5B adds native transactional sync checks with an SDK transport stub, including baseline semantics, optimistic races, concurrent edits, pagination and rollback. Earlier auth/diagnostic tests run with sync disabled to verify their independent behavior. It does not automate Google or contact a live auth project. It resets only that disposable test origin and refuses to run elsewhere. After the online checks pass, stop the server with Ctrl+C and use the offline-check button in the already open test page. The suite covers migration and rollback retention, empty first-run initialization and automatic sample cleanup, recording/editing/deleting, backups, failures, multiple windows and cached offline creation/editing/deletion/reloads. It also checks version-1 IndexedDB upgrades and rollback, strict metadata validation, immutable creation metadata, retained tombstones across views and JSON restores, version-1 backup compatibility, and physical demo purging. Test files are not part of the service-worker shell. For an optional regression using the exact pinned CDN bundle, run `node tests/oauth-sdk.cjs` with network access. It uses a fake publishable key and `skipBrowserRedirect`, verifies separate Auth/REST endpoints and both redirect URLs, and makes no Supabase/Google requests. Run these checks in Safari on the target iPad as well as a desktop browser.

## Statistics rules

- **Days tracked:** unique dates containing any event.
- **Accident-free streak:** from the most recent recorded date, count consecutive calendar dates with entries and no inside wee/poo. A gap or accident ends it. Unrecorded days are not inferred.
- **Frequency:** total events / tracked dates, requiring at least three tracked dates.
- **Wee intervals:** elapsed minutes between consecutive wees; exclude zero gaps and gaps over 24 hours. Median requires three valid intervals.
- **Daytime:** both endpoints on the same date within 06:00–22:00. **Overnight:** endpoints on consecutive dates, the first at/after 22:00 and the next at/before 06:00. Other gaps count only towards the overall median. Longest daytime/overnight gaps each require three qualifying intervals.
- **First wee/poo:** median first-event wall-clock time across at least three dates.
- **Meals:** median of the first, second and third meals on dates with exactly three meals, requiring three dates per position.
- **Meal → toilet:** next strictly later wee within six hours or poo within twelve hours. Median requires three qualifying meals. A toilet event can be the next event for multiple meals.
- Insufficient samples display **—**. These are transparent house-training heuristics.

## Limits

No reminders or prediction engine. No horizontal scrolling, pagination or extra event lanes. Colliding marks can obscure one another; use Data for exact inspection. Offline caching needs a successful initial load from a secure origin. Real iPad Home Screen installation and OS storage retention must be verified on the device.
