# Bella Diary

Bella Diary is a deliberately small offline-first PWA for tracking puppy
house-training events.

## Architecture

Use only:
- vanilla HTML
- vanilla CSS
- vanilla JavaScript
- localStorage
- service worker
- web app manifest

Do not introduce frameworks, package managers, build systems, backends,
databases, accounts, analytics or external runtime dependencies unless
explicitly requested.

## Product priorities

In order:

1. Fast one-tap recording
2. Readable 24-hour timeline
3. Pattern recognition
4. iPad usability
5. Simple editing
6. Offline reliability
7. Maintainability

## Constraints

- Must work on iPad Safari.
- Must work offline once cached.
- Must not require horizontal scrolling.
- Diary data must remain local to the device.
- Timeline and Data views use the same event store and editor.
- Most recent dates/events appear first.
- Keep implementation small and understandable.

## PWA updates

When changing cached application-shell files, consider whether the service
worker cache version in `sw.js` needs incrementing.

Do not change storage schemas incompatibly without providing migration logic.
