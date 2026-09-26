# BUILD-LOG

Append to this as you go. Commit it with the code it describes — the timestamps are part of the
evidence, and a log that arrives in one commit at the end reads as what it is.

Five lines is a real entry. Short and dated is better than long and reconstructed.

The categories we look for are listed in `DISCOVERY-BRIEF.md`. The example below shows the
*shape* of a good entry; it is a recreation of something already printed in `README.md`, so it
gives nothing away.

---

<!-- EXAMPLE — delete this block, keep the shape.

## 2026-03-04 · Phase 0 — orientation

Expected the unknown-permission test to fail on my validation code.
Observed: it passed, with foreign_keys ON, and *also* passed with the pragma removed — so the
check was never running, and the "pass" was the schema loading fine while enforcing nothing.
Changed: moved `foreign_keys = ON` to connection open and re-ran; now it raises
`FOREIGN KEY constraint failed` as the README said it would.
Note: this is the failure mode where a passing test is worse than a failing one.

-->

## Phase 0 — orientation - 2026-09-26

_Installed, reset the database, read the documents, ran the suites against the untouched skeleton.

Installed on Windows , ran npm run db:reset  failed bcz the script uses
'rm -f' , a Unix cmnd Powershell does not have. Switch to git bash(also considred rewriting the script, decided not to touch it since i was not told to). Then read Brief.md, AuthData-Model.md, Permissions.md befire writing any code.




## Phase 1 — token verification

_What did you expect each failure mode to look like before you ran it? Which one behaved
differently from your expectation, and what did that tell you?_

Read all 7 failures mode in Auth-Data-Model.md  before writing anything, then went through the TODO commnet in order, writiing the check and testing against check-jwt,s's error as i went. Most were Direct: malformedsegments, bad JSON, wrong iss.aud missing jti.


The moost tricky one was the 5th one , i had to read the docs again and again to understand the error message and the code i wrote for that case. The one i had tothink hardest about was algorithm confusion ($10,"alg:none" and substitution attacks)- the fix is to never let the token;'s own header decide how you verify it. you always verify with HS256
using your own secret , and seperately check that header claims, rejecting if not. Trusting the header to select  the algorithm is the actual vulnerablity.

Verified : All Pass , 43/43   (node scripts/check-jwt.js)

## Phase 2 — caller context and the resolution engine

_This is where most people's first model is wrong. Write down the model you started with, the
observation that broke it, and the model you moved to. Be specific about the observation._


Started by writing one shared resolver (`resolveOne`) that every exported function calls, 
so deny-wins -> grant-allow -> role-baseline -> implicit-deny exists in exactly one place. 
Ran check-permissions.js early and often rather than writing the whole file first.

First real bug wasn't in the resolution logic — it was in cleanup. Removing leftover 
`throw todo(...)` placeholder lines, I commented out the actual modeResult check in 
assertCanStartSession instead of just the todo line below it. Both the "should succeed" 
and "should fail on device permission" compound-session tests broke identically, which 
was the tell: two different test cases producing the same wrong output almost always 
means the code took the same wrong path for both, not two separate logic bugs.

Also had to fix reason-string specificity: I was returning 'implicit' everywhere there 
was no membership, but the tests wanted 'not_a_member' for no membership, 'suspended' 
for a suspended one, and 'missing_device_permission' vs 'missing_permission' depending 
on which half of the compound session check failed. Added a membershipDenyReason() 
helper so that logic lives in one place too.

Verified: `node scripts/check-permissions.js` — ALL PASS, 35/35.

## Phase 3 — orgs, members, invites (auth/me, auth/token, orgs)

_Anything you had to work out that no document states. Invite lifecycle states are a common
source of this._

Discovered server/routes/index.js's registerRoutes() was completely empty (`void db; void secret;`) 
— every /v1/* endpoint had been returning 404 by design, per the file's own comment. Built 
server/routes/auth.js starting with POST /v1/auth/login, since nothing else can be tested 
without it (same principle as auth.js being first overall).

Hit a confusing false alarm: `npm run dev`'s file watcher was restarting the server mid-request, 
producing "connection reset" errors that looked like a code bug. Ran `node server/index.js` 
directly (no watcher) to isolate it — server booted clean and stayed up, confirming the issue 
was the dev-watcher timing, not the route code.

Verified: `curl -X POST /v1/auth/login` with dana@example.test returns a valid token, 
role=owner, and both her org memberships (Acme as owner, Globex as viewer) — matching the 
seed fixture.




Built POST /v1/auth/refresh, POST /v1/auth/token, GET /v1/auth/me, GET+POST /v1/orgs. 
refresh_tokens has no org column, so a refreshed access token defaults to the user's 
highest-rank active membership rather than preserving the pre-refresh org — logged as 
a decision since the docs don't specify this.

Verified via curl: dana@example.test logs in as owner in Acme, GET /auth/me returns her 
full resolved permission set including device:reboot (the personalized hidden permission) 
correctly denied/implicit — confirms the resolver has no hardcoded permission list.

## Phase 4 — devices and grants  (2026-09-26 )

_What happens at the boundary where two grants disagree, or where a grant's scope and the
question's scope differ? Say what you predicted and what you got._


Built devices.js (list/view/create/update/delete/transfer) and grants.js (create/list/revoke). 
Reused resolveDevices() for the list endpoint's per-row permission shape and resolve() for 
single-device view -- no new resolution logic needed here, just wiring.

device:view gates row inclusion, not device:list -- a device the caller can't view is filtered 
out of the list entirely rather than shown with redacted fields. device:list only gates whether 
the endpoint itself is reachable at all.

Transfer needed device:provision in BOTH orgs -- the source org via assertCan() as normal, and 
the destination org checked manually via a direct resolve() call, since assertCan only knows 
about ctx.orgId (the caller's current org), not an arbitrary destination named in the body.

Grants validate every permission string against permission_patterns before touching the DB, so 
an unknown permission is a clean 400 rather than a raw foreign-key constraint error surfacing 
to the client. assertMayGrant() (already built in Phase 2) enforces no-laundering on create.

Verified: GET /orgs/org_acme/devices as owner returns all 5 devices, each with a full resolved 
permission set including device:reboot denied/implicit on every row -- confirms per-device 
resolution has no hardcoded permission list, matching the earlier org-level check.

## Phase 5 — sessions

_Two permissions, one device. What did you have to resolve, and in what order, to keep the two
failure reasons distinguishable?_


Built sessions.js: start (compound check + D10), list, view-one, terminate. Let the database's 
partial unique index (one_exclusive_session_per_device) be the actual race-safety mechanism for 
D10, rather than an app-level check-then-insert -- the route just attempts the insert and catches 
the UNIQUE constraint violation, converting it to a clean 409 DEVICE_BUSY naming the holding 
session's id. This matches the schema's own warning against check-then-act races.

GET/DELETE /v1/sessions/:id take no :org in the path (per BRIEF.md's endpoint table) -- org is 
derived from the session row itself, and cross-org access is still blocked by comparing 
session.org_id against ctx.orgId, same structural-isolation pattern as everywhere else.

Verified via curl, in order:
- viewer starts a 'view' session on lab-mac-01 (device-scoped grant) -> 201
- same viewer tries 'control' on the same device -> 403, reason=missing_device_permission 
  (distinct from missing_permission, confirming the compound check's two failure paths)
- sam (operator) starts 'control' on lab-win-01 -> 201
- sam immediately repeats the same request -> 409 DEVICE_BUSY, naming the exact session 
  holding the device -- exclusivity enforced by the database, not application logic


  Added PATCH/DELETE /v1/orgs/:org, GET /v1/orgs/:org/users/:userId/effective, and 
GET /v1/orgs/:org/audit with limit/offset validation (400 outside 1-200 / >=0).

effective allows self-access even without user:read (checking your own permissions is 
always allowed); otherwise requires user:read on the caller, checked manually via a 
direct resolve() call rather than assertCan(), since assertCan operates on ctx's own 
org/user pair and this route asks about an arbitrary target user.

Verified via curl: Sam (operator, lacks user:read/audit:read) correctly gets 403 asking 
about Dana's effective permissions and the audit log. Dana (owner) gets both successfully. 
Audit log shows real actions from testing plus the seed fixture's own history, including a 
denied attempt with reason_code=missing_permission -- confirms denials are logged, not just 
successes (invariant 9).

Noticed seed/orgs.json has one audit event with at="-2h30m", which doesn't match 
load-db.js's resolveTime() regex (single-unit only) and is stored as a literal string 
rather than resolved to an ISO timestamp. Left as-is -- not asked to touch seed data.

## Phase 6 — audit

_What did you decide counts as an auditable event, and what pushed you to that line?_
Implemented lifecycle.js (roleRanks, assertCanModify, assertNotLastOwner, endActiveSessions, 
snapshotAuthority, sessionExpiry) and audit.js (audit, auditDenials). Kept roles.rank strictly 
to modification authority — assertCanModify never touches permissions.js, and permissions.js 
never touches rank. Split D8 across two places on purpose: assertCanModify only compares rank 
(equal-or-higher target -> 403); "no self-role-change" and "only an owner may confer owner" 
aren't rank questions at all, so those get checked directly in route handlers instead.

audit.js only ever INSERTs, matching the append-only triggers on audit_events. auditDenials() 
wraps a permission-gated action so a 403 gets logged with its reason code before rethrowing, 
without also logging the success case twice.

Server boots clean with both modules wired in — no dedicated check script for these two 
(unlike auth.js/permissions.js), so verified via `node server/index.js` starting without error.

## Phase 7 — the console

_Where did the server's answer and your instinct disagree about what should be on screen?_

## Phase 8 — hardening

_What did you measure, what did you fix, and what did you deliberately leave alone? Anything you
chose not to build belongs here with its reason._

## Open threads

_Things you know are wrong, unfinished, or that you would do differently with another day. Listing
these honestly is worth more than pretending they do not exist — we will find them anyway._
