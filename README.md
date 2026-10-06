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
- `app.js`: demo, local storage, filtering, rendering, editing, statistics and backups.
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

Everything stays in this browser's localStorage, under `bellaDiary.store` (version, events, demo-cleared flag). An event's datetime is a local wall-clock ISO string `YYYY-MM-DDTHH:mm`; existing events keep their recorded calendar time if you later change timezone. Storage survives normal refresh, close/reopen and Home Screen relaunch in the same browser storage context. Browser profiles, devices and some installation contexts may have separate storage. Private browsing or clearing site data can remove the diary: export backups regularly.

Export JSON includes version 1, an export timestamp and every event. Import validates structure, dates, types, locations, consistency, text limits and unique IDs, then **replaces the whole diary after confirmation**. Bad imports leave the diary intact. Version 1 timezone-qualified ISO datetimes are converted to this device's local calendar time; local strings keep their wall-clock time. Imported demo provenance is retained. Exports include all events regardless of filters. CSV uses quoted values, a UTF-8 BOM and formula-safe text for spreadsheet use. JSON is the lossless restore format; CSV import is not supported.

Failed writes leave the current diary unchanged and show an error. Unreadable existing storage is never overwritten: the app blocks mutations until storage is repaired/accessible. Export before changing browser storage settings; if the saved JSON itself is damaged, recover the raw `bellaDiary.store` value through browser developer tools before clearing it.

## Offline and iPad installation

On wide, short screens such as the iPad mini in landscape, a compact layout reduces header, entry-control, bucket, and timeline spacing to keep more of the current week visible. The timeline still scrolls vertically as more dates are recorded.

After the first successful online load, wait for **Ready for offline use**. The service worker has then cached the entire static shell. Reload, entry creation, editing, deleting, filtering, statistics and JSON/CSV backups work without a network. No server persistence is required. The web server is only for initial loading and updates.

On iPad Safari, serve the static directory from a suitable HTTPS origin, open it, then choose Share → Add to Home Screen. Plain HTTP at a computer's LAN IP is not a suitable secure origin for service workers; `localhost` on iPad refers to the iPad itself. Installation should be checked on the target iPad. Browser storage may be evicted, so an installed PWA is not a substitute for backups.

For app updates, bump `CACHE` in `sw.js` whenever shell files change. The new worker precaches the new shell before activation, removes only old Bella's Diary shell caches, and never touches diary storage. Reload after the update activates. The app makes no external requests.

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
