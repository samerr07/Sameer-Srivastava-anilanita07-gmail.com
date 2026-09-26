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

## Phase 3 — orgs, members, invites

_Anything you had to work out that no document states. Invite lifecycle states are a common
source of this._

## Phase 4 — devices and grants

_What happens at the boundary where two grants disagree, or where a grant's scope and the
question's scope differ? Say what you predicted and what you got._

## Phase 5 — sessions

_Two permissions, one device. What did you have to resolve, and in what order, to keep the two
failure reasons distinguishable?_

## Phase 6 — audit

_What did you decide counts as an auditable event, and what pushed you to that line?_

## Phase 7 — the console

_Where did the server's answer and your instinct disagree about what should be on screen?_

## Phase 8 — hardening

_What did you measure, what did you fix, and what did you deliberately leave alone? Anything you
chose not to build belongs here with its reason._

## Open threads

_Things you know are wrong, unfinished, or that you would do differently with another day. Listing
these honestly is worth more than pretending they do not exist — we will find them anyway._
