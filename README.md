# Bella's Diary

A small offline-first puppy house-training diary for Bella. Vanilla HTML, CSS and JavaScript; no build system, analytics or diary sync. Optional Google sign-in uses Supabase; diary data stays local.

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
- `cloud-diagnostic.js`: explicit temporary cloud test using the same authenticated client.
- `manifest.json`: standalone installation metadata.
- `sw.js`: complete offline app-shell cache.
- `icons/`: 192px and 512px PNG icons and SVG favicon.

## Using the diary

First launch saves seven dates of **illustrative demo data**, ending today. The example includes a full day today, so some illustrative times may be later than the current time. Clear demo data before recording Bella's own diary. This removes only marked demo entries (including edited demo entries), keeps entries you added yourself, and never re-seeds on reload.

Quick Wee/Poo/Meal buttons save immediately using local date and time. Wee and poo default to Outside; the dedicated **Inside wee / Inside poo** buttons record an inside accident immediately, without opening an editor. Poo defaults to Normal. Meal details start empty. Use Custom entry or tap a timeline mark / table row to edit, change location, add details, or delete. Both views share the same editor. The five filters apply only to Timeline and Data; switching views preserves the filter. Summary and statistics always use the whole diary. All recorded dates stay visible in the timeline, including dates with zero matches under a filter.

The **Diary / Stats** tabs at the top right switch between the diary and its separate Patterns & statistics panel. The top-right **···** menu holds JSON/CSV backups, demo clearing and the local/offline status. Quick recording remains available in both views. Returning to Diary preserves the Timeline/Data choice and current filter. Diary filters sit next to the Diary heading and apply to Timeline and Data. The likelihood buckets always describe the full diary.

**When things usually happen** has separate Wee/Poo/Meal rows of 24 one-hour buckets, aligned with the timeline's 00–24 axis. Choose the last 7, 14 or 30 calendar days, or all time; the choice is saved on this device. Each bucket's share is its portion of all logged events of that type in the chosen window. Shading is scaled to that type's busiest hour in the same window, so the most active bucket always stands out even as the routine changes. For example, five of twenty recorded wees at 08:00 gives a 25% event share; its shading also reflects how that compares with the busiest wee hour. Tap a bucket for the event share and count, its distinct diary-day count, and its relative shading; keyboard focus and the tooltip expose the same detail. Event shares for each row total 100% (allowing rounding). Empty types/buckets stay uncoloured. It describes recorded events, not a forecast; sparse or incomplete logging can skew it. Demo entries contribute until cleared.

Overlapping marks intentionally share one central lane at their actual times, with larger invisible tap targets. The Data tab lets you inspect and edit any obscured events. Historical rows retain a fixed 38px height and grow vertically. Timeline rows show dates without per-day event counts.

## Storage and backups

The app reads and writes the complete diary through the asynchronous `diaryRepository` interface in `storage.js`. Active diary data lives in this browser's native IndexedDB database `bellaDiary`, version 3 (previously 2). The `events` object store has one event record per `id`, including deleted records; the `meta` object store is keyed by `key` and holds `schemaVersion`, `demoCleared`, `initialized`, `eventOrder` and `householdId`. The order metadata preserves the existing event sequence, including JSON export order. Each save replaces events and metadata in a single transaction and is successful only when that transaction completes.

Diary schema version 3 requires `createdAt`, `updatedAt`, `deletedAt`, `mutationId` and nullable `serverVersion` on every event. The version-2 upgrade atomically adds only `serverVersion:null` and `householdId:null`, preserving all existing content, metadata and event ordering. Failure leaves version 2 recoverable. On upgrading a Stage 2 database, the native versionchange transaction validates the old diary, adds metadata and updates the schema marker atomically. Legacy records receive one shared migration instant for creation/update, null deletion and a locally generated change ID. IDs, diary times, event sequence, fields and demo provenance are retained. Failure aborts the database version upgrade too, leaving version 1 recoverable. Old database connections close on versionchange; previous app code cannot reopen the upgraded database at an older version.

On first use of IndexedDB, an existing `bellaDiary.store` localStorage diary is parsed and passed through the app's existing validation before migration. Only a successful transaction marks IndexedDB initialized. Later launches use IndexedDB directly. The original localStorage value is deliberately left untouched as a rollback snapshot: new events, edits and imports do not update it. A fresh browser with neither diary seeds the usual demo through the repository once; clearing demo data remains permanent across reloads. Initialization checks inside the write transaction prevent two starting windows from overwriting each other's first diary.

The separate `bellaDiary.aggregateWindow` preference remains in localStorage. Other diary windows refresh after BroadcastChannel save notifications when available, and when focused or made visible. Saves within one window are queued so rapid recording keeps each entry. Whole-diary replacement still means simultaneous edits in different windows can overwrite one another; conflict handling belongs to a later sync stage. Google authentication is separate from diary persistence; cloud sync is not implemented.

`createdAt` and `updatedAt` are canonical UTC ISO instants from `new Date().toISOString()`. Creation sets them equal; edits preserve creation and replace update time. `deletedAt` is null while active. Every create/edit/delete also mints a local opaque `mutationId` without user identity. Rendering and loading do not change metadata. Stage 5B will use cloud `server_version` for optimistic concurrency rather than treating device timestamps as authority. The earlier timestamp/mutation ordering is metadata only; no conflict algorithm is implemented. Identical mutation IDs represent the same change; conflicting payloads with the same timestamp and mutation ID should be treated as corrupt rather than ordered arbitrarily. No merge engine is implemented here. Device clock skew and simultaneous whole-diary writes must be addressed before cloud sync.

Delete retains the record as a tombstone, setting `deletedAt` and `updatedAt` to the same current instant. One active-event boundary excludes tombstones from timeline dates, tables, filters, counts, streaks, buckets, statistics, meal relationships and CSV. Tombstones survive reloads and JSON restoration; there is no automatic tombstone expiry. Clearing demo is the deliberate exception: it physically purges every `demo:true` record, including edited/deleted demo records, while retaining real records and their tombstones.

An event's datetime is a local wall-clock ISO string `YYYY-MM-DDTHH:mm`; existing events keep their recorded calendar time if you later change timezone. Storage survives normal refresh, close/reopen and Home Screen relaunch in the same browser storage context. Browser profiles, devices and some installation contexts may have separate storage. Private browsing or clearing site data can remove the diary: JSON export remains the supported user backup, so export regularly. The retained legacy snapshot becomes stale after migration and is not a current backup.

Export JSON format version 2 includes an export timestamp, `demoCleared`, and every record in storage order, including metadata and tombstones. Import version 2 strictly validates UTC timestamps, modification order (`updatedAt >= createdAt`, `deletedAt <= updatedAt`), change IDs and existing event fields; it preserves metadata unchanged, including `serverVersion` when present. Older version-2 backups without that field restore it as null. Household binding is not exported or imported: restoring events keeps the current device binding. Version 1 backups remain supported through an explicit upgrade that assigns current migration metadata and retains IDs/order/demo provenance. Version 1 timezone-qualified ISO datetimes retain the existing compatibility conversion to this device's local calendar time; local strings keep their wall-clock time. Import **replaces the whole diary after confirmation**; invalid files leave it intact. CSV includes only active events regardless of filters, with the existing columns, quoted values, UTF-8 BOM and formula-safe text. JSON is the lossless restore format; CSV is for analysis and cannot restore the diary.

Failed writes and transaction aborts leave both the committed database and current in-memory diary unchanged and show an error. IndexedDB open failures, unavailable storage, corrupt diaries and migration failures block mutations without seeding demo data or overwriting the legacy snapshot. An incomplete database is treated as an error. Export before changing browser storage settings; for recovery, preserve the IndexedDB data and any raw `bellaDiary.store` rollback value through browser developer tools before clearing storage.

## Offline and iPad installation

On wide, short screens such as the iPad mini in landscape, a compact layout reduces header, entry-control, bucket, and timeline spacing to keep more of the current week visible. The timeline still scrolls vertically as more dates are recorded.

After the first successful online load, wait for **Ready for offline use**. The service worker has then cached the entire static shell. Reload, entry creation, editing, deleting, filtering, statistics and JSON/CSV backups work without a network. No server persistence is required. The web server is only for initial loading and updates.

On iPad Safari, serve the static directory from a suitable HTTPS origin, open it, then choose Share → Add to Home Screen. Plain HTTP at a computer's LAN IP is not a suitable secure origin for service workers; `localhost` on iPad refers to the iPad itself. Installation should be checked on the target iPad. Browser storage may be evicted, so an installed PWA is not a substitute for backups.

For app updates, bump `CACHE` in `sw.js` whenever shell files change. The new worker precaches the new shell before activation, removes only old Bella's Diary shell caches, and never touches diary storage. Reload after the update activates. Only optional authentication loads the pinned Supabase library and contacts Supabase/Google. The service worker handles same-origin files only; it does not intercept or cache CDN or Supabase requests.

## Google sign-in (Stage 4B)

Replace `__SUPABASE_URL__` and `__SUPABASE_PUBLISHABLE_KEY__` in `supabase-config.js` with the Supabase **Project URL** and **publishable key** from the project dashboard. Use the `sb_publishable_...` key, not a legacy JWT key. The Project URL must be the HTTPS origin only, without `/rest/v1`, `/auth/v1`, query parameters or a fragment; API paths are rejected before client initialization. A root trailing slash is normalized away. These values are browser-safe configuration; authorization relies on Stage 4A RLS. Never commit a database password, service-role/secret credential or Google client secret. Until configured, authentication is disabled and the local diary remains available.

The **··· > Cloud account** section offers Google sign-in, name/email and sign-out. It always explains that cloud sync is not enabled. `auth.js` independently loads the official UMD client pinned at `@supabase/supabase-js@2.117.2` from jsDelivr. The SDK manages persisted sessions, token refresh and PKCE callback detection. No Google provider tokens are separately stored and cloud discovery uses that same client independently of diary startup. See [Supabase initialization](https://supabase.com/docs/reference/javascript/initializing) and [OAuth sign-in](https://supabase.com/docs/reference/javascript/auth-signinwithoauth).

The redirect is the same-origin directory containing `auth.js`, with a trailing slash and no query/hash: normally `https://chrislark1.github.io/bella-diary/` for GitHub Pages and `http://localhost:8080/` for development. Custom domains/paths are derived automatically; an HTTP `index.html` URL redirects to its directory too. Supabase must allow the exact roots in use (`localhost` and `127.0.0.1` are separate origins). After SDK callback processing, auth parameters are cleaned from the URL. Raw provider/SDK errors are never displayed or logged.

Auth failures and bounded startup/action waits never delay IndexedDB startup. Offline account actions and refresh pause, while a known identity stays visible in the current window with **Offline · session not checked**. On an offline cold launch without a loaded CDN client, status is unavailable rather than assumed signed out. There is no separate identity/token cache: reconnect to load/check the SDK session. The local auth/config files join the static shell cache; the CDN bundle and Supabase API responses do not.

Sign-out uses Supabase's local session scope, leaving other devices signed in. It does not clear IndexedDB, legacy diary storage, demo state, preferences or downloaded backups. **IndexedDB remains shared by the browser profile and is now linked to at most one household.** Chris and Louise can use the same cache when authorized for that household. Signed-out/offline use still reads local data; this binding is future sync scoping, not a local access-control boundary. A different discovered household is refused rather than switching or erasing data; a locally displayed identity is not proof of server authorization.

Manual sign-in check:

1. Replace the two placeholders and deploy/serve the files. If configuration was already cached, bump the service-worker cache version again and reload online after activation.
2. Confirm the actual app-root redirect is allowed in Supabase. Choose **··· > Cloud account > Sign in with Google**, finish Google sign-in and verify return to the same root with name/email and **Signed in · cloud sync not enabled yet**. Check callback code/error parameters disappear.
3. Reload and close/reopen in the same origin/browser profile; verify session restoration where persistence permits. Test localhost and production, iPad Safari and the Home Screen app. OAuth can open Safari in a different storage context; PKCE needs the initiating context's verifier. If Safari and the installed PWA have separate storage, complete sign-in in the same context and do not assume session transfer.
4. Go offline after caching. Record, edit and delete entries, reload and confirm persistence. Account controls must explain offline status; a session cannot be verified offline.
5. Reconnect and sign out; confirm diary/demo state remains after reload. Sign-out must not change local diary data. Signed-in household discovery reads cloud tables; only the explicit Link local diary action writes the binding metadata.

Bella has been created manually with Chris as its owner. This stage does not create households, memberships or additional users. Before upload/sync, audit any non-UUID legacy/imported IDs, exclude demo records and implement household-scoped optimistic concurrency and tombstone handling in Stage 5B.

## Cloud connection diagnostic (Stage 4C)

Inside **... > Cloud account**, a signed-in account discovers its own RLS-authorized membership, requires exactly one household, reads its name and checks event SELECT access. Zero or multiple memberships stop the diagnostic with a clear message; no IDs or household names are hard-coded for authorization. `bellaAuth.getClient()` and `getUser()` let the diagnostic reuse the sole client owned by `auth.js`; no session/token accessor is exposed.

**Run cloud connection test** explicitly creates one unique `demo:true` wee with local wall-clock datetime and canonical UTC client metadata. It verifies the insert, reads it, updates note and mutation metadata, tombstones and reads it again, verifies database-assigned `server_updated_at` changes on both updates, then physically deletes that disposable row and verifies absence. Every mutation targets only this generated ID and household; update/delete also require `demo:true`. No test rows are created on startup. Failed or interrupted tests can leave a disposable row; a safe stage message and diagnostic ID identify an uncertain outcome when available. Later tests use fresh IDs and never bulk-delete earlier diagnostics.

No diary sync exists. IndexedDB remains the local source of truth; cloud reads stay in memory and no local records are uploaded or modified. The diagnostic is unavailable offline, cancels in-flight requests on offline/account changes, and never blocks diary startup or queues retries. Its success proves the browser Auth / RLS / database path for this household, not foreign-household isolation or full sync correctness. **The cache now has a single household binding**, while local use remains available offline/signed out. Stage 5B must enforce this scope on every cloud operation and implement optimistic concurrency; no sync is present here.

Manual browser check (real Google sign-in is not automated):

1. Serve/deploy and reload online after shell cache v11 activates. Sign in to the actual PWA as Chris; open Cloud account and check **Household: Bella / Cloud access: Ready**.
2. Click **Run cloud connection test** once. Expect Authenticated access, Insert, Read, Update, Tombstone and Cleanup all **OK**. Verify your local diary is unchanged. Only a completed real-browser run proves live RLS connectivity.
3. Repeat: each run creates a new disposable ID and removes only that row. If a stage fails, check membership/RLS/connectivity and inspect the reported diagnostic ID manually; never delete real diary rows to resolve a test.
4. Go offline: the test button disables, the session stays visible, and local recording/editing/deleting still work. Reconnect and retry explicitly. Sign out: the diagnostic hides and local data remains.
5. Test iPad Safari and the Home Screen storage context. A second nonmember account should see a safe no-membership message; foreign-household isolation still requires the Stage 4A SQL/RLS checks.

## Sync preparation (Stage 5A)

Stage 5A adds only model preparation: cloud `server_version`, nullable local `serverVersion`, secure UUIDs for new local IDs and one nullable `householdId` in IndexedDB metadata. Newly recorded/demo events use `crypto.randomUUID()` or a version-4 UUID built from `crypto.getRandomValues`; there is no timestamp/Math.random fallback. Existing legacy/imported IDs remain untouched to preserve references and backups. Test fixtures intentionally exercise non-UUID legacy IDs; before uploading an older import, Stage 5B must detect any such IDs. No real diary upload has occurred.

In **Cloud account**, wait for successful authenticated discovery of exactly one household, then click **Link local diary to this household** once. This writes metadata only. The same household is idempotent; a different household shows a mismatch and cannot replace the binding. Offline, sign-out, normal saves, imports and stale windows preserve it. No household selector, account-specific cache, automatic push/pull, sync queue or conflict state was added. Chris and Louise can share this cache when they belong to the same Bella household. Conflict handling and optimistic-concurrency updates are deferred to Stage 5B.

Supabase steps (SQL has not been applied by this agent):

1. In the SQL Editor as admin, run **only** `supabase/migrations/20261007010000_stage5a_server_version.sql` once. Do not rerun/rewrite Stage 4A. Existing cloud rows receive version 1. The existing trigger forces insert version 1, increments the old version on every update, regenerates `server_updated_at`, and rejects changes to `id`, `household_id` or `client_created_at`. No RLS policies or grants change.
2. Run the complete `supabase/manual/verify-stage5a.sql` block. Expect the PASS notice for versions/timestamps/immutable fields; its disposable fixtures roll back. This admin test verifies the trigger, not RLS.
3. Reload the PWA online after shell v11 activates, sign in, and run the Stage 4C connection test. It deliberately submits `server_version:999` on insert and both updates and accepts only returned versions **1, 2, 3**, while continuing to verify server timestamps and delete the disposable row. An unmigrated cloud database fails safely; the local diary remains available.
4. Link the local diary to the discovered Bella household. Verify the binding survives reload, sign-out and offline entry recording. The browser test suite covers mismatch refusal; foreign-household RLS isolation remains the Stage 4A test's responsibility.

Future sync should update an event only when its cloud version still equals the last accepted local `serverVersion`, then store the returned next version. That conditional update and conflict handling are not implemented. Cloud bigint versions are accepted locally only as positive safe integers; `null` means no accepted cloud version yet. Local edits and tombstones retain that value. JSON stays format version 2 with this extra event field; CSV stays unchanged.

## Persistence acceptance checks

Run `python -m http.server 8137 --bind 127.0.0.1` in this directory, then open `http://127.0.0.1:8137/tests/indexeddb.html` and run the checks. The browser suite has no test dependencies and uses real IndexedDB and the production app. It preserves the 85 persistence checks and adds SDK-stub tests for CDN failures, auth outages/pending requests, account UI, client options, offline behavior and sign-out/data isolation. Stage 5A adds native version-2-to-3 migration/rollback, UUID fallback, serverVersion preservation, household binding/mismatch and server-version diagnostic checks. Stage 4C adds SDK-stub checks for membership selection, the disposable CRUD/tombstone/cleanup sequence, unchanged/missing server timestamps, cloud failures, offline cancellation and client/data isolation. It does not automate Google or contact a live auth project. It resets only that disposable test origin and refuses to run elsewhere. After the online checks pass, stop the server with Ctrl+C and use the offline-check button in the already open test page. The suite covers migration and rollback retention, first-run demo behavior, recording/editing/deleting, backups, failures, multiple windows and cached offline creation/editing/deletion/reloads. It also checks version-1 IndexedDB upgrades and rollback, strict metadata validation, immutable creation metadata, retained tombstones across views and JSON restores, version-1 backup compatibility, and physical demo purging. Test files are not part of the service-worker shell. For an optional regression using the exact pinned CDN bundle, run `node tests/oauth-sdk.cjs` with network access. It uses a fake publishable key and `skipBrowserRedirect`, verifies separate Auth/REST endpoints and both redirect URLs, and makes no Supabase/Google requests. Run these checks in Safari on the target iPad as well as a desktop browser.

## Statistics rules

- **Days tracked:** unique dates containing any event.
- **Accident-free streak:** from the most recent recorded date, count consecutive calendar dates with entries and no inside wee/poo. A gap or accident ends it. Unrecorded days are not inferred.
- **Frequency:** total events / tracked dates, requiring at least three tracked dates.
- **Wee intervals:** elapsed minutes between consecutive wees; exclude zero gaps and gaps over 24 hours. Median requires three valid intervals.
- **Daytime:** both endpoints on the same date within 06:00–22:00. **Overnight:** endpoints on consecutive dates, the first at/after 22:00 and the next at/before 06:00. Other gaps count only towards the overall median. Longest daytime/overnight gaps each require three qualifying intervals.
- **First wee/poo:** median first-event wall-clock time across at least three dates.
- **Meals:** median of the first, second and third meals on dates with exactly three meals, requiring three dates per position.
- **Meal → toilet:** next strictly later wee within six hours or poo within twelve hours. Median requires three qualifying meals. A toilet event can be the next event for multiple meals.
- Insufficient samples display **—**. Demo events contribute until cleared. These are transparent house-training heuristics.

## Limits

No device sync, reminders or prediction engine. No horizontal scrolling, pagination or extra event lanes. Colliding marks can obscure one another; use Data for exact inspection. Offline caching needs a successful initial load from a secure origin. Real iPad Home Screen installation and OS storage retention must be verified on the device.
