# Stage 4A: database schema and authorization

This directory contains SQL only. It adds no frontend client, authentication flow, invitations or sync engine. The existing local diary and its service worker are unchanged.

## Security model

Supabase Auth supplies `auth.uid()`. The admin-managed `household_members` table authorizes access; both `owner` and `member` can read their households and memberships and perform event CRUD in those households. Neither role can create/update/delete households or memberships through the client. Explicit table grants and six authenticated-only RLS policies enforce this. `anon` and `PUBLIC` have no application-table privileges. Event UPDATE checks both the old and new household, so a member cannot transfer an event into a household they do not belong to. Tombstones remain readable to members for future sync.

`bella_private.is_household_member(uuid)` returns only whether the current caller belongs to the supplied household. Its `postgres` owner bypasses membership RLS, breaking recursive policy evaluation; it does not accept a caller-supplied user ID. It has an empty search path, schema-qualified references and execution granted only to `authenticated`. Keep `bella_private` out of the Data API **Exposed schemas**. Do not change the helper owner to a role that evaluates membership RLS. See [Supabase's RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) and [PostgreSQL's security-definer guidance](https://www.postgresql.org/docs/current/sql-createfunction.html).

## Schema and timestamp choices

All event IDs use UUIDs, matching the normal local `crypto.randomUUID()` path. `datetime` remains local wall-clock text (`2026-10-07T08:30`), with a format/range check that does not validate every calendar date. Optional fields remain nullable, with the requested type/location/consistency/role checks. `mutation_id` uses the local lowercase ASCII format and `C` collation for deterministic future comparisons. Finite client timestamps must satisfy `client_updated_at >= client_created_at` and `deleted_at <= client_updated_at` when deleted.

Local `createdAt` maps to `client_created_at`; `updatedAt` to `client_updated_at`; `deletedAt` to `deleted_at`; `mutationId` to `mutation_id`. Other camelCase type fields similarly map to their snake_case columns. No conversion of diary `datetime` is involved. PostgreSQL stores timestamp instants; the client must serialize sync metadata in UTC.

A BEFORE INSERT/UPDATE trigger overwrites `server_updated_at` using `clock_timestamp()`, including when the client supplies it. This records server write time separately from untrusted device times. It does not implement conflict resolution, commit ordering or a guaranteed sync cursor. The four explicit indexes support membership lookup and household/time queries; the composite primary key also supports household membership checks. The standalone household event index is included as requested, although the composite indexes can serve that prefix too.

## Apply and verify

1. Review `migrations/20261007000000_stage4a_household_authorization.sql` and run it once as `postgres` using the Supabase SQL Editor or your migration runner. It is transactional and fails on pre-existing application tables/schema; inspect conflicts rather than suppressing them with `IF NOT EXISTS`.
2. Confirm `bella_private` is not an exposed API schema. Automatic RLS is supplemented by explicit `ENABLE ROW LEVEL SECURITY` statements in the migration.
3. After Chris and Louise have real Auth user rows, replace the two UUID placeholders in `manual/initial-household.sql` and run it once as admin. The returned household UUID is the future household identifier. Duplicate names are allowed; rerunning this seed creates another household. Both memberships are created atomically, and missing user IDs fail the foreign key.
4. Run the catalog section of `manual/verify-stage4a.sql`: expect three RLS-enabled tables, six policies, four named indexes plus primary-key indexes, no anon/PUBLIC grants, and the documented helper/trigger settings.
5. Replace the two UUID placeholders in its behavioral section and run the complete BEGIN-through-ROLLBACK block. It creates disposable fixtures, tests as ordinary `authenticated`/`anon` roles with simulated JWT claims, emits PASS notices and rolls everything back. A FAIL aborts the transaction; issue ROLLBACK if your SQL tool stops before the final line. These role tests, rather than admin/service-role SELECTs, exercise RLS. Once Auth is connected, repeat isolation tests through the Data API with actual user access tokens.

Stage 4A has been applied manually, according to the project status supplied for Stage 4B. These role tests have not been executed by this agent against the project database; run them there to verify actual grants/policies and `auth.uid()` behavior.

## Resolve before Auth and sync

- Stage 4B: configure Google provider/client credentials and exact production/development redirect URLs; verify Chris/Louise user IDs before enrollment. Never put a service-role/secret key in the PWA. Other signed-in users receive no data until an admin enrolls them. Keep Supabase anonymous sign-in disabled for this two-person app.
- Stage 4B: decide how sign-out or account/household switching isolates the existing IndexedDB diary; it is currently device-local and has no household/user partition. Do not expose one user's cached records to another account.
- Before upload: older imports and the frontend's fallback ID generator can contain non-UUID event IDs. Audit and provide a stable migration/mapping before uploading; this stage deliberately leaves local IDs alone. Demo records should never be uploaded.
- Before sync: implement atomic conflict handling (client update instant, then binary ASCII mutation ID), clock-skew handling, immutable creation metadata if required, safe retry/cursor behavior and household scoping. The timestamp trigger alone does not prevent stale overwrites. SQL DELETE is authorized as requested, but normal sync should use tombstones; agree on their retention and backup-restore semantics before garbage collection.
