# Stage 4A: database schema and authorization

This directory contains SQL only. It adds no frontend client, authentication flow, invitations or sync engine. The existing local diary and its service worker are unchanged.

## Security model

Supabase Auth supplies `auth.uid()`. The admin-managed `household_members` table authorizes access; both `owner` and `member` can read their households and memberships and perform event CRUD in those households. Neither role can create/update/delete households or memberships through the client. Explicit table grants and six authenticated-only RLS policies enforce this. `anon` and `PUBLIC` have no application-table privileges. Event UPDATE checks both the old and new household, so a member cannot transfer an event into a household they do not belong to. Tombstones remain readable to members for household sync.

`bella_private.is_household_member(uuid)` returns only whether the current caller belongs to the supplied household. Its `postgres` owner bypasses membership RLS, breaking recursive policy evaluation; it does not accept a caller-supplied user ID. It has an empty search path, schema-qualified references and execution granted only to `authenticated`. Keep `bella_private` out of the Data API **Exposed schemas**. Do not change the helper owner to a role that evaluates membership RLS. See [Supabase's RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) and [PostgreSQL's security-definer guidance](https://www.postgresql.org/docs/current/sql-createfunction.html).

## Schema and timestamp choices

All event IDs use UUIDs, matching the normal local `crypto.randomUUID()` path. `datetime` remains local wall-clock text (`2026-10-07T08:30`), with a format/range check that does not validate every calendar date. Optional fields remain nullable, with the requested type/location/consistency/role checks. `mutation_id` uses the local lowercase ASCII format and `C` collation; sync compares mutation IDs only for equality. Finite client timestamps must satisfy `client_updated_at >= client_created_at` and `deleted_at <= client_updated_at` when deleted.

Local `createdAt` maps to `client_created_at`; `updatedAt` to `client_updated_at`; `deletedAt` to `deleted_at`; `mutationId` to `mutation_id`. Other camelCase type fields similarly map to their snake_case columns. No conversion of diary `datetime` is involved. PostgreSQL stores timestamp instants; the client must serialize sync metadata in UTC.

A BEFORE INSERT/UPDATE trigger overwrites `server_updated_at` using `clock_timestamp()`, including when the client supplies it. This records server write time separately from untrusted device times. It does not implement conflict resolution, commit ordering or a guaranteed sync cursor. The four explicit indexes support membership lookup and household/time queries; the composite primary key also supports household membership checks. The standalone household event index is included as requested, although the composite indexes can serve that prefix too.

## Apply and verify

1. Review `migrations/20261007000000_stage4a_household_authorization.sql` and run it once as `postgres` using the Supabase SQL Editor or your migration runner. It is transactional and fails on pre-existing application tables/schema; inspect conflicts rather than suppressing them with `IF NOT EXISTS`.
2. Confirm `bella_private` is not an exposed API schema. Automatic RLS is supplemented by explicit `ENABLE ROW LEVEL SECURITY` statements in the migration.
3. After Chris and Louise have real Auth user rows, replace the two UUID placeholders in `manual/initial-household.sql` and run it once as admin. The returned household UUID is the future household identifier. Duplicate names are allowed; rerunning this seed creates another household. Both memberships are created atomically, and missing user IDs fail the foreign key.
4. Run the catalog section of `manual/verify-stage4a.sql`: expect three RLS-enabled tables, six policies, four named indexes plus primary-key indexes, no anon/PUBLIC grants, and the documented helper/trigger settings.
5. Replace the two UUID placeholders in its behavioral section and run the complete BEGIN-through-ROLLBACK block. It creates disposable fixtures, tests as ordinary `authenticated`/`anon` roles with simulated JWT claims, emits PASS notices and rolls everything back. A FAIL aborts the transaction; issue ROLLBACK if your SQL tool stops before the final line. These role tests, rather than admin/service-role SELECTs, exercise RLS. Once Auth is connected, repeat isolation tests through the Data API with actual user access tokens.

Stage 4A has been applied manually, according to the project status supplied for Stage 4B. These role tests have not been executed by this agent against the project database; run them there to verify actual grants/policies and `auth.uid()` behavior.

## Auth and sync integration

- Stage 4B: configure Google provider/client credentials and exact production/development redirect URLs; verify Chris/Louise user IDs before enrollment. Never put a service-role/secret key in the PWA. Other signed-in users receive no data until an admin enrolls them. Keep Supabase anonymous sign-in disabled for this two-person app.
- Stage 5A: the device-local cache has one household binding; sign-out/offline use preserves local access, and a different discovered household is refused. Stage 5B scopes every normal sync operation to the binding. No household switching is implemented.
- Before upload: older imports and the historical fallback ID generator could produce non-UUID event IDs. Stage 5B warns and leaves these records local without rewriting IDs. Local sample rows are automatically purged; diagnostic/demo records are never uploaded by normal sync.
- Stage 5B implements optimistic concurrency against server_version, household scoping and tombstone propagation. Client creation metadata is immutable from Stage 5A. The timestamp trigger alone does not prevent stale overwrites. SQL DELETE is authorized as requested, but normal sync uses tombstones with no automatic expiry; no real-row garbage collection is implemented.

## Stage 5A additive migration

Stage 4A stays unchanged. Run `migrations/20261007010000_stage5a_server_version.sql` once as admin, then the complete rollback-only `manual/verify-stage5a.sql`. The new `server_version bigint not null default 1` initializes existing rows to 1. The existing trigger function is replaced in place, preserving ownership/permissions and trigger attachment ([PostgreSQL documentation](https://www.postgresql.org/docs/current/sql-createfunction.html)). It generates version 1 on insert and OLD.server_version + 1 on every update, overwriting supplied versions/timestamps and rejecting changes to ID, household or client creation time. RLS and table grants are untouched. The Stage 4A foreign-household move test now accepts the immutable-household guard error as well as the original RLS rejection; its remaining membership/SELECT/INSERT/UPDATE/DELETE isolation checks are retained.

After applying SQL, run the real PWA connection diagnostic: malicious version 999 must return 1 -> 2 -> 3 before cleanup. SQL verification has not been executed against Supabase by this agent. Stage 5B updates in `../sync.js` filter by the previously accepted server version and household. This directory provides SQL only; the frontend sync engine is documented in `../README.md`. Client time/mutation ordering alone is no longer the proposed conflict protocol. The local cache's one-household binding supplies scope, and older non-UUID imports remain local with a sync warning.
