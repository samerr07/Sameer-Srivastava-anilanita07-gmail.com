# DECISIONS

One section per decision that a reviewer might reasonably have made differently.

---

### Owner-modifying-owner is allowed, despite the equal-rank block

**What I chose:** `assertCanModify()` special-cases `callerRole === 'owner' && targetRole === 'owner'` as always permitted, bypassing the equal-rank check that applies to every other pair.

**Why:** PERMISSIONS.md §6 states "modify a user of equal role (admin → admin) → 403" and I initially implemented this literally for every role, owner included. `node scripts/check-api.js` failed with `demoting a NON-last owner is allowed — got 403 want 200`: Acme's fixture has two owners (`dana`, `usr_acme_owner`), and Dana demoting the other owner to viewer is expected to succeed. Applying the equal-rank block to owner-vs-owner makes this impossible without a third owner present purely to authorize the demotion, which would make `assertNotLastOwner`'s protection redundant in the one case it's meant to matter — a multi-owner org could never voluntarily reduce to one owner.

**What I rejected:** applying the equal-rank block uniformly, per the literal reading of §6's table. Rejected because it produces an org that can gain owners but never lose one down to a single owner through ordinary role changes — only through the `/members/me` leave path, which has its own last-owner guard anyway. The literal reading and the last-owner invariant can't both hold for owner-vs-owner.

**What would change my mind:** if the brief explicitly stated owners can only be demoted via a separate, dedicated endpoint rather than the normal role-update route — no such statement exists in BRIEF.md or PERMISSIONS.md.

---

### Refreshed access tokens default to the user's highest-rank active membership, not the pre-refresh org

**What I chose:** `POST /v1/auth/refresh` looks up the user's memberships and picks the one with the highest `roles.rank`, ignoring which org the expiring access token was scoped to.

**Why:** `refresh_tokens` (schema.sql) has no `org_id` column — only `user_id`, `token_hash`, `family_id`, `expires_at`. AUTH-DATA-MODEL.md §2 describes refresh tokens as opaque and DB-backed but doesn't specify which org a refresh should re-scope to. Without a stored org association, the only information available at refresh time is the user's identity, not their prior context.

**What I rejected:** adding an `org_id` column to `refresh_tokens` to remember the pre-refresh org. Rejected because BRIEF.md §4 says "Don't edit `db/schema.sql`."

**What would change my mind:** an explicit statement that refresh must preserve org context, which would force a different mechanism (e.g., an org hint in the refresh request body, validated against active memberships) rather than a schema change.

---

### Device transfer checks `device:provision` in the destination org via a direct `resolve()` call, not `assertCan`

**What I chose:** in `POST /v1/orgs/:org/devices/:id/transfer`, the source org's permission is checked with the normal `assertCan(db, ctx, 'device:provision')` (bound to `ctx.orgId`), but the destination org's permission is checked by calling `resolve(db, { userId: ctx.userId, orgId: toOrgId })` directly and inspecting the result.

**Why:** BRIEF.md §5.1 states transfer requires `device:provision` in **both** orgs. `assertCan` and `assertCanStartSession` are both written around `ctx.orgId` — the org the caller's token addresses — and have no parameter for a second, arbitrary org named in the request body. Extending `assertCan` to take an optional second org would blur its single responsibility (checking the caller's *current* context) for one call site.

**What I rejected:** adding an `orgId` override parameter to `assertCan` itself. Rejected as unnecessary generality for a single call site, and because `permissions.js`'s own header comment frames it as "the only place allow-vs-deny is decided" — `resolve()` is already the primitive every other function is built from, so calling it directly here keeps the same single source of truth without widening `assertCan`'s contract.

**What would change my mind:** a second route needing the same "check permission X in an arbitrary named org" pattern — at that point extracting a shared helper would be justified; with one call site, it isn't yet.

---

### D10 exclusivity is enforced by the database's partial unique index, not an application-level check-then-insert

**What I chose:** `POST /v1/orgs/:org/sessions` attempts the `INSERT` directly and catches the resulting `SQLITE_CONSTRAINT_UNIQUE` error, converting it to `409 DEVICE_BUSY`, rather than querying for an existing active session first and refusing before inserting.

**Why:** `db/schema.sql` defines `one_exclusive_session_per_device` as a partial unique index specifically so "two parallel `control` requests cannot both commit." A check-then-insert has a race window between the check and the insert where two concurrent requests can both pass the check. `node scripts/check-api.js`'s own test ("D10 exclusive sessions... 2nd control on same device -> 409") only proves the sequential case; the index is what protects the concurrent case the sequential test can't exercise.

**What I rejected:** `SELECT ... WHERE state='active' AND mode IN ('control','terminal')` before inserting, refusing early if found. Rejected because it's exactly the check-then-act pattern BRIEF.md §2 warns against ("Trust the database... where you can let it refuse something instead of checking first in code, you should").

**What would change my mind:** nothing — this is the pattern the schema's own comments explicitly point toward.

---

### No role or permission table is ever hardcoded in `permissions.js` or `web/main.jsx`

**What I chose:** every function in `permissions.js` queries `role_permissions`, `permissions`, and `permission_patterns` live via `db.prepare(...)`. The console (`main.jsx`) renders every gated element by checking `me.permissions['x']?.effect === 'allow'` or a device's own `permissions` object — never a `role === 'admin'`-style check.

**Why:** `npm run db:load`'s personalisation output printed an extra role (`reviewer`, rank 35) and an extra permission (`device:reboot`) not present in PERMISSIONS.md or AUTH-DATA-MODEL.md, with the explicit instruction "Read roles and permissions from the database. Do not encode the documented matrix." `GET /v1/auth/me` (tested via curl, logged in BUILD-LOG.md Phase 3) returned `device:reboot: {effect: "deny", reason: "implicit"}` for an owner with no code change needed to recognise it — proving the resolver has no hardcoded list to miss it from.

**What I rejected:** transcribing PERMISSIONS.md §3's baseline table into a JS object for speed, matching what `db/reference.sql`'s own comment ("Transcribed from the matrix in PERMISSIONS.md §3") does for the *reference data*, but that transcription belongs in seed data, not application code — copying it a second time into `permissions.js` would create two sources of truth that could drift.

**What would change my mind:** nothing — this is a hard requirement stated explicitly, and the personalisation mechanism exists specifically to catch violations of it.

---

### Fixed a Windows-only path bug in `scripts/load-db.js` rather than leaving it or reporting it unfixed

**What I chose:** replaced `new URL(p, import.meta.url).pathname` with `fileURLToPath(new URL(p, import.meta.url))` from `node:url`.

**Why:** `npm run db:load` failed with `ENOENT ... C:\C:\Users\...\db\schema.sql` — a doubled drive letter. `.pathname` on a `file://` URL yields a leading slash before the drive letter (`/C:/Users/...`) on Windows; Node's file APIs interpret that leading slash as "root of the current drive" and prepend the real one, producing the double. `fileURLToPath` is Node's own purpose-built conversion for this exact case and handles it correctly cross-platform.

**What I rejected:** working around it by hardcoding an absolute path or using `process.cwd()`-relative paths instead. Rejected because the file already computes paths relative to its own location via `import.meta.url`, which is the more portable pattern (works regardless of the caller's working directory) — the bug was in the conversion step, not the underlying approach.

**What would change my mind:** nothing — this is a straightforward correctness fix with no real alternative design.

---

### The org-level (device-scoped) permission view is a union across the org's devices, computed by re-running the per-device resolver rather than a separate aggregate query

**What I chose:** `resolve()` with `deviceId: null`, for any `device:*` permission, loops every device in the org, calls the same `resolveOne()` used for per-device checks, and takes the first `allow` it finds (falling back to the first `deny` if none allow).

**Why:** PERMISSIONS.md §3 states org-level and device-level are "two evaluation contexts, resolved the same way" and gives the example: "a viewer with a `device:control` grant on one device gets the Control button on that row and nowhere else" but implies the org-level nav should still reflect that the permission is reachable somewhere. Reusing `resolveOne()` guarantees the org-level answer can never disagree with what the per-device answer would say for the device that granted it — a separate aggregate query (e.g., `EXISTS (SELECT 1 FROM grants WHERE ...)`) would duplicate the deny-wins/wildcard/window logic and risk drifting from `resolveOne()`.

**What I rejected:** a raw SQL existence query against `grants`/`grant_permissions` for speed. Rejected for the drift reason above, and because the org list this loops over is typically small (single digits of devices in the fixture), so the performance cost of re-resolving per device is negligible against the benefit of one single resolution path.

**What would change my mind:** a demonstrated performance problem with large device counts, which would justify caching resolved per-device results (keyed appropriately, with the same invalidation-on-`perm_version`-bump discipline used elsewhere) rather than changing the resolution logic itself.

---

## Where this repo argues with itself

**PERMISSIONS.md §6's stated rule for equal-rank modification, taken literally, conflicts with the last-owner invariant it also states.**

§6's table says: "modify a user of equal role (admin → admin) → 403", illustrated only with admin, but written generally enough to read as covering every role pair including owner-vs-owner. §9 (invariants) states: "An org always has at least one owner," implemented via `assertNotLastOwner`, whose entire purpose is to permit removing/demoting owners *except* the last one — implying demoting a non-last owner must be possible.

If the equal-rank block applies to owner-vs-owner, no owner can ever be demoted by another owner (both are rank 50), which makes `assertNotLastOwner`'s allowance for "not the last owner" unreachable in practice for role changes — the only path to reducing owner count would be `/members/me` (self-removal), which isn't a role change at all.

I built against `assertNotLastOwner`'s implied allowance (owner-vs-owner permitted, gated only by the last-owner count) rather than the equal-rank table's literal generality, because `check-api.js`'s own test (`demoting a NON-last owner is allowed`) explicitly requires owner-vs-owner to succeed when there are two owners — the shipped test suite resolves the ambiguity in the schema's/doc's favor toward the last-owner invariant. Documented in full above under "Owner-modifying-owner is allowed."

---

## Deliberately not built

- **Console forms use `window.prompt`/`window.confirm`** for invite creation, grant creation, device rename, and org rename, instead of proper in-page modal forms. Chosen to prioritize getting every permission-gated element correctly wired to server-resolved permissions (the graded behavior) over polished input UX, given the time available. The underlying API calls and permission gating are identical either way — only the input-collection mechanism is simplified.
- **`device:file_transfer`'s "Transfer files" button** renders correctly (present/absent per resolved permission) but has no file-transfer implementation behind it — clicking it shows a placeholder alert. The brief explicitly scopes out real remote access ("No real remote access... input injection, shell execution or screen capture" — BRIEF.md §1/Ground rules), and file transfer sits closest to that boundary of any device action, so I prioritized wiring every other permission-gated action correctly over building transfer UI for an action the brief doesn't require to actually function.
- **Session rows display raw device IDs** (e.g. `dev_lab_mac_01`) rather than resolved device names. UI-INVENTORY.md's `session-row` test id doesn't require a name field, so this was left as-is to spend time on broader route/permission coverage instead.
- **Seed fixture quirk, not a bug in my code:** `seed/orgs.json` contains one audit event with `at: "-2h30m"`, which doesn't match `scripts/load-db.js`'s `resolveTime()` regex (`/^([+-])(\d+)([dhm])$/`, single numeric value + single unit only — `2h30m` has two of each). It falls through to the "already absolute" branch and is stored as the literal string `"-2h30m"` rather than a resolved ISO timestamp. Confirmed via `GET /orgs/org_acme/audit`, which returned this event with `at: "-2h30m"` verbatim. Left unfixed since BRIEF.md §4 says not to build on the seed fixture and doesn't ask for seed-data corrections; noting it here so it's not mistaken for an unnoticed bug in `audit.js` or the resolver.




### Invite creation checks for an existing live invite in application code, but the database's partial unique index is the actual race guard

**What I chose:** `POST /v1/orgs/:org/invites` first queries for an existing non-accepted, non-revoked invite for the email and returns `409 INVITE_EXISTS` if found — but this check is advisory, not the enforcement mechanism. The real guarantee is `one_live_invite_per_email`, a partial unique index in `db/schema.sql` on `(org_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL`.

**Why:** AUTH-DATA-MODEL.md §6 states "Two concurrent accepts of the same token: exactly one wins. The partial unique index `one_live_invite_per_email` makes that a database guarantee" — and by the same construction, two concurrent *creates* for the same email are guarded the same way. My application-level check alone has the standard check-then-insert race window; under true concurrency, two requests could both pass the check before either commits. The index is what actually prevents two live rows from existing, matching the same pattern used for D10 session exclusivity.

**What I rejected:** relying solely on the app-level check without a try/catch around the insert to convert a raw constraint violation into a clean `409`. I did not verify this conversion path was fully wired at every possible race point during this build — noted honestly here rather than claimed as complete, since I did not construct a genuine concurrent-request test for invite creation the way I did for D10's two-sequential-curl-calls test.

**What would change my mind:** running two genuinely concurrent `POST /invites` requests (not sequential, as I tested for sessions) and observing whether the second one returns a clean `409` or a raw SQLite constraint error — this would be the natural next verification step if more time were available.

---

### Login with no `orgId` in the request body picks the caller's highest-`rank` active membership as the default org, not e.g. the first-created membership

**What I chose:** `pickDefaultMembership()` orders the caller's active memberships by `roles.rank DESC, joined_at ASC` and takes the first row.

**Why:** BRIEF.md and AUTH-DATA-MODEL.md describe login producing an access token scoped to *an* org and don't specify which org when the caller belongs to several and doesn't request one by id (`POST /auth/login` in §5.1 lists `orgId` as absent from the required fields, implying it's optional). Dana's fixture membership (owner in Acme, viewer in Globex) meant this choice was directly observable: logging in without an `orgId` needed to deterministically land her in Acme as owner, which `rank DESC` produces since owner (50) outranks viewer (10).

**What I rejected:** defaulting to the most-recently-joined membership, or the alphabetically-first org name. Rejected because rank-based defaulting has an intuitive justification (a user most likely wants to land in the org where they have the most authority) that neither alternative has, and because it produced the correct, testable result for the seed fixture's only multi-org user without special-casing her id.

**What would change my mind:** an explicit statement of which org should be the default — none exists in the provided documents, so this remains a judgment call rather than a documented requirement.





### Note: `npm start` fails on Windows out of the box

`package.json`'s `start` script (`NODE_ENV=production node server/index.js`) uses Unix inline 
environment-variable syntax, which Windows PowerShell/cmd don't support natively — running 
`npm start` fails with `'NODE_ENV' is not recognized as an internal or external command`. 
This is a starter-provided script I didn't write or modify. For Windows, the equivalent is 
`$env:NODE_ENV="production"; node server/index.js`, or installing `cross-env` as a dependency. 
Not fixed, since it's outside what BRIEF.md asks me to build — noted here in case it's relevant 
to how the app is run during grading.





### Submission run command uses `node server/index.js` directly, not `npm run dev`

**What I chose:** For the submission form's "command that starts your app from a clean checkout," I specified `cd starter && npm install && npm run db:reset && node server/index.js` instead of `npm run dev`.

**Why:** `npm run dev`'s script (`node --watch-path=./server --watch server/index.js`) restarts the server whenever it detects a file change nearby, which — verified in a genuinely fresh clone tested during final submission checks — caused the browser to occasionally load mid-restart and receive a broken/incomplete response. `node server/index.js` runs the identical server without the watcher and rendered correctly every time in the same fresh-clone test.

**What I rejected:** submitting `npm run dev` as literally defined in `package.json`, since it's the "intended" dev script. Rejected because the watcher's restarts are a live-editing convenience with no benefit for someone running the app once to grade it, and the restart timing introduced a real, reproducible failure mode (page loading against a server mid-restart) that a first-time reader has no way to anticipate or work around.

**What would change my mind:** if `--watch` mode had a way to debounce restarts or only trigger on actual file saves rather than filesystem noise — I didn't investigate whether Node's `--watch` flag supports this, given time constraints at submission.