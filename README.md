# Bella's Diary

A small offline-first puppy house-training diary for Bella. Vanilla HTML, CSS and JavaScript; no build, dependencies, accounts, backend, analytics or remote sync.

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

The app reads and writes the complete diary through the asynchronous `diaryRepository` interface in `storage.js`. Active diary data lives in this browser's native IndexedDB database `bellaDiary`, version 2 (previously 1). The `events` object store has one event record per `id`, including deleted records; the `meta` object store is keyed by `key` and holds `schemaVersion`, `demoCleared`, `initialized` and `eventOrder`. The order metadata preserves the existing event sequence, including JSON export order. Each save replaces events and metadata in a single transaction and is successful only when that transaction completes.

Diary schema version 2 (previously 1) requires `createdAt`, `updatedAt`, `deletedAt` and `mutationId` on every event. On upgrading a Stage 2 database, the native versionchange transaction validates the old diary, adds metadata and updates the schema marker atomically. Legacy records receive one shared migration instant for creation/update, null deletion and a locally generated change ID. IDs, diary times, event sequence, fields and demo provenance are retained. Failure aborts the database version upgrade too, leaving version 1 recoverable. Old version-1 database connections close on versionchange; old app code cannot reopen that database at version 1.

On first use of IndexedDB, an existing `bellaDiary.store` localStorage diary is parsed and passed through the app's existing validation before migration. Only a successful transaction marks IndexedDB initialized. Later launches use IndexedDB directly. The original localStorage value is deliberately left untouched as a rollback snapshot: new events, edits and imports do not update it. A fresh browser with neither diary seeds the usual demo through the repository once; clearing demo data remains permanent across reloads. Initialization checks inside the write transaction prevent two starting windows from overwriting each other's first diary.

The separate `bellaDiary.aggregateWindow` preference remains in localStorage. Other diary windows refresh after BroadcastChannel save notifications when available, and when focused or made visible. Saves within one window are queued so rapid recording keeps each entry. Whole-diary replacement still means simultaneous edits in different windows can overwrite one another; conflict handling belongs to a later sync stage. There is no cloud sync or account system.

`createdAt` and `updatedAt` are canonical UTC ISO instants from `new Date().toISOString()`. Creation sets them equal; edits preserve creation and replace update time. `deletedAt` is null while active. Every create/edit/delete also mints a local opaque `mutationId` without user identity. Rendering and loading do not change metadata. Future reconciliation for the same event ID should prefer greater `updatedAt`, then lexically greater `mutationId` using binary ASCII comparison, never locale or object order. Identical mutation IDs represent the same change; conflicting payloads with the same timestamp and mutation ID should be treated as corrupt rather than ordered arbitrarily. No merge engine is implemented here. Device clock skew and simultaneous whole-diary writes must be addressed before cloud sync.

Delete retains the record as a tombstone, setting `deletedAt` and `updatedAt` to the same current instant. One active-event boundary excludes tombstones from timeline dates, tables, filters, counts, streaks, buckets, statistics, meal relationships and CSV. Tombstones survive reloads and JSON restoration; there is no automatic tombstone expiry. Clearing demo is the deliberate exception: it physically purges every `demo:true` record, including edited/deleted demo records, while retaining real records and their tombstones.

An event's datetime is a local wall-clock ISO string `YYYY-MM-DDTHH:mm`; existing events keep their recorded calendar time if you later change timezone. Storage survives normal refresh, close/reopen and Home Screen relaunch in the same browser storage context. Browser profiles, devices and some installation contexts may have separate storage. Private browsing or clearing site data can remove the diary: JSON export remains the supported user backup, so export regularly. The retained legacy snapshot becomes stale after migration and is not a current backup.

Export JSON format version 2 includes an export timestamp, `demoCleared`, and every record in storage order, including metadata and tombstones. Import version 2 strictly validates UTC timestamps, modification order (`updatedAt >= createdAt`, `deletedAt <= updatedAt`), change IDs and existing event fields; it preserves metadata unchanged. Version 1 backups remain supported through an explicit upgrade that assigns current migration metadata and retains IDs/order/demo provenance. Version 1 timezone-qualified ISO datetimes retain the existing compatibility conversion to this device's local calendar time; local strings keep their wall-clock time. Import **replaces the whole diary after confirmation**; invalid files leave it intact. CSV includes only active events regardless of filters, with the existing columns, quoted values, UTF-8 BOM and formula-safe text. JSON is the lossless restore format; CSV is for analysis and cannot restore the diary.

Failed writes and transaction aborts leave both the committed database and current in-memory diary unchanged and show an error. IndexedDB open failures, unavailable storage, corrupt diaries and migration failures block mutations without seeding demo data or overwriting the legacy snapshot. An incomplete database is treated as an error. Export before changing browser storage settings; for recovery, preserve the IndexedDB data and any raw `bellaDiary.store` rollback value through browser developer tools before clearing storage.

## Offline and iPad installation

On wide, short screens such as the iPad mini in landscape, a compact layout reduces header, entry-control, bucket, and timeline spacing to keep more of the current week visible. The timeline still scrolls vertically as more dates are recorded.

After the first successful online load, wait for **Ready for offline use**. The service worker has then cached the entire static shell. Reload, entry creation, editing, deleting, filtering, statistics and JSON/CSV backups work without a network. No server persistence is required. The web server is only for initial loading and updates.

On iPad Safari, serve the static directory from a suitable HTTPS origin, open it, then choose Share → Add to Home Screen. Plain HTTP at a computer's LAN IP is not a suitable secure origin for service workers; `localhost` on iPad refers to the iPad itself. Installation should be checked on the target iPad. Browser storage may be evicted, so an installed PWA is not a substitute for backups.

For app updates, bump `CACHE` in `sw.js` whenever shell files change. The new worker precaches the new shell before activation, removes only old Bella's Diary shell caches, and never touches diary storage. Reload after the update activates. The app makes no external requests.

## Persistence acceptance checks

Run `python -m http.server 8137 --bind 127.0.0.1` in this directory, then open `http://127.0.0.1:8137/tests/indexeddb.html` and run the checks. The dependency-free browser suite uses real IndexedDB and the production app. It resets only that disposable test origin and refuses to run elsewhere. After the online checks pass, stop the server with Ctrl+C and use the offline-check button in the already open test page. The suite covers migration and rollback retention, first-run demo behavior, recording/editing/deleting, backups, failures, multiple windows and cached offline creation/editing/deletion/reloads. It also checks version-1 IndexedDB upgrades and rollback, strict metadata validation, immutable creation metadata, retained tombstones across views and JSON restores, version-1 backup compatibility, and physical demo purging. Test files are not part of the service-worker shell. Run these checks in Safari on the target iPad as well as a desktop browser.

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
