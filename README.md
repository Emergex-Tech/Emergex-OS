# EmergeX OS — Stage 1 (PRD v2.0)

This supersedes the earlier `emergex-os/` package entirely. That build mixed
capabilities from every stage into one Vite/React app with client-side
Supabase writes. This one is Stage 1 only, built to the actual PRD: Next.js +
TypeScript, every write going through a real service layer, org-scoped
multi-tenancy, the two-level property/item inventory model, category-driven
re-confirmation, route scoring, and universal versioning.

## What has and hasn't been verified

**Verified by execution, on a real PostgreSQL 16 plus a real PostgREST server:**
- All SQL (schema, policies, functions, migrations 002–007, category seed) runs cleanly in order.
- **An end-to-end suite (`tests/e2e`, 96 checks)** runs the *real route handlers* → real `supabase-js` → real PostgREST → real Postgres, acting as Team, Manager and CEO. It covers record creation, the whole pricing/approval/export/version/share flow, every permission boundary (Team refused where it should be), share conflicts and overrides, CSV import, user-management permission gates and the role-change/CEO-protection logic, the pipeline/won-lost/CEO-view permission boundaries (including the CEO-only `ceo_view.access` check), contracts/deliverables/notifications, agent access and contract files, an all-routes access sweep, the whole finance flow (schedules, payments, overdue, chasing, payables, CSV export), and `/api/health`. It is also what proves that every `select(... embed ...)` string the app uses resolves against the real schema.
- **17 conflict-check scenarios** (`supabase/tests/conflicts.sql`), including the cases where it must *not* fire.
- **Row-level security tested as four different signed-in users**, plus every insert shape the code uses.
- `tsc --noEmit` is clean, `next build` succeeds, and 91 pure-logic checks pass (`npm run test:logic`). The finance SQL guarantees (overpayment trigger, void guard, constraints, RLS) are 12 more checks in `supabase/tests/finance.sql`.
- **The tests were themselves tested.** After the finance tests passed first time, I deliberately broke the code four ways — leftover cents on the wrong instalment, the overpayment trigger dropped, a permission check removed from `/finance/overdue`, and Team given finance notifications — and confirmed each break was caught by exactly the test meant to catch it (47 of 49 passed with the two permission breaks in; the other two were caught by the pure and SQL suites). A suite that passes first time proves nothing until it's shown it can fail.

**Not verified — there was no environment for it. Treat these as untested until you've seen them work:**
- **The browser-to-server session cookie hand-off.** The end-to-end suite replaces only the "who is signed in" lookup with a mock; everything after it is real. If sign-in works but the app behaves as signed-out, this is where to look (`/api/health` shows it).
- **Account creation, password reset, and disable/enable — Supabase's Auth Admin API itself** (`auth.admin.createUser`, `updateUserById`, `deleteUser`). These call Supabase's Auth (GoTrue) service, which has no equivalent running in this sandbox (only PostgREST does), so only the code *around* them was tested: permission checks (which reject before ever reaching these calls) and the role-change endpoint (which doesn't call them at all). **Create your own first account and confirm you can sign in before relying on this for real users** — see the deploy guide's step 4.
- **Vercel's runtime itself** (cold starts and function limits beyond the settings already made).
- Google Drive against a real Shared Drive; the Anthropic call; the UI in a browser; Excel opening the export in Excel itself.

### Bugs found by actually executing the SQL (all fixed)
Earlier passes only checked SQL by counting quotes and `$$` pairs. Running it for real found three bugs that would have broken first use:
1. `schema.sql` seeded Management's permissions with `select ..., permission_key from permissions` — that table's column is `key`. **The whole schema would have failed at that line.**
2. `current_role()` is a reserved SQL keyword and can't be a function name. Renamed to `current_role_key()` (schema, policies, migration 002).
3. `createRecord()` forced a `created_by` column onto every insert, but 6 of the 10 tables it writes to don't have one (vendors, brands, agents, price records, intel notes, shares use different or no actor columns). It now uses a per-table map, checked against the real schema.

**If you already ran an earlier version of these files:** items 1–2 mean the schema could not have applied, so a partial state is unlikely — but drop and recreate rather than patching.

### Running the database tests
```bash
docker run -d --name exos-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
PG_BASE_URL=postgresql://postgres:postgres@localhost:5432 supabase/tests/run.sh
```
Use a throwaway Postgres, never your Supabase project (the script refuses Supabase URLs).

## ⚠️ categories.json is a draft

The PRD names `categories.json` as the actual source of truth for the 12
category field schemas — we don't have that file. `categories.json` here is
reconstructed from Appendix C's category names, groups, and re-confirmation
rules only; the specific fields per category (`property_fields`,
`item_fields`, `price_unit_options`) are our best judgment. **Review this
file before relying on the dynamic forms it drives** — it's the single
biggest assumption in this build.

## Sign-in: a deliberate deviation from the PRD

PRD 6.1 specifies Google Workspace sign-in. This build uses **email/password accounts created by Management/CEO** instead — requested directly, not assumed. `migrations/007_admin_managed_users.sql` and the `/api/users*` routes are the whole change; nothing about the permission model needed to change, since `user.manage` already existed and was already held by Manager and CEO.

What this means in practice: no self-signup, ever. An account exists only because a Manager or CEO created it from the **Users** page (name, email, role — a temporary password is generated and shown once). The user changes it themselves afterward from **Change password** in the sidebar. A CEO can only be demoted or disabled by another CEO, so a Manager can't lock out the CEO. Disabling a user bans them at the Auth level, not just in the app, which also cuts off an active session immediately.

## What's actually built

| Area | Status |
|---|---|
| Org-scoped schema, roles as data (`team`/`management` only) | Done |
| Service layer (`serviceLayer.ts`) — permission check → write → audit → version | Done |
| Property/item two-level inventory | Done |
| Category-driven re-confirmation engine (sponsorship taper / 60-day / 90-day) | Done, with override precedence (item > property > category) |
| Reconfirmation overrides (shorten = immediate, lengthen = pending Management approval) | Done |
| Route scoring (Team proposes, Management approves; agents — Stage 2B — never see their own scores) | Done |
| Vendors, Brands, Routes | Done |
| Intel notes (agent-isolation policy written now, dormant until Stage 2B) | Done |
| Simple share log (no conflict checks — those are explicitly Stage 2A) | Done |
| Capture: raw text → AI draft → user edits → confirm (only point anything saves) | Done |
| Universal versioning + audit log | Done |
| Duplicate flagging (pg_trgm similarity on vendors/properties) | Done |
| Dashboard (stale/due counts, pending approvals) | Done |
| Search (properties/items/vendors/brands/intel) | Done |
| Google Drive folder creation, file imports, Management review screen (M2 route-review UI), CEO permission tables 6.14-style dashboard | **Partially built** — see below |

## Gaps closed since the first pass

- **Google Drive** (`src/lib/googleDrive.ts`): service-account folder creation, wired into `createRecord` for vendors, brands, agents and properties via an optional `driveFolder` param — best-effort (never blocks or rolls back the record on Drive failure; failures are written to `audit_events` as `drive_folder_failed`). `/api/drive-folders` covers retry and lookup. Inventory and Vendors pages show "Open in Drive" or "Create folder."
- **Item creation form**: Inventory page now has a real "+ Add item" flow per property, rendering `item_fields` from the category schema via a shared `DynamicFields` component (also used for property creation, so the two forms can't drift apart). A "+ Record price" action per item captures type/amount/currency/unit/source and shows the latest recorded price inline.
- **CSV import** (`/import`): two modes — Vendors, and Inventory (property + item + first price in one row). Vendor/property resolution is exact case-insensitive name match against both the DB and the current batch, so re-running an import or importing overlapping sheets doesn't create duplicates the way the trigram-based flagging elsewhere is deliberately looser about. Fixed column headers for now (shown in the UI) — no drag-and-drop column mapping.
- **Agents**: `/api/agents` existed as a schema table but had no write path; now it does, and Brands & Routes lets you create an agent and attach it to a route.
- **Approvals page** (`/approvals`): Management's actual review queue for pending route score changes and pending lengthening overrides — approve or reject each, with rejection reasons written to the audit log. Added `GET` list endpoints and `[id]/reject` routes alongside the existing `[id]/approve` ones. The page itself shows a warning banner to Team users rather than hiding the queue outright, since seeing what's pending is useful even if only Management's clicks will actually take effect — the server enforces that regardless of what this page renders.
- **CSV column mapping** (`/import`): upload any CSV — headers no longer need to match our field names exactly. A mapping step auto-matches columns where it can (by field key or label, normalized for case/spacing/punctuation) and always lets you finish the rest manually via dropdowns; required fields are flagged in red and block submission until mapped. The auto-match logic was tested directly (not just compiled) against three cases — exact keys, human-friendly headers, and a sheet with nothing matching — to confirm it degrades to "not mapped" rather than guessing wrong or crashing.

## What's still missing

- Nothing has been run against real Supabase Auth, Google Drive, Anthropic, or a browser yet (see "Not verified" above) — the first deploy is where those get proven. Creating your own first account is the specific first thing to confirm.
- **PowerPoint export (A17) is not built, on purpose.** The PRD's own "what to cut if time is short" table says to cut it to Excel-only, which already exists — so this isn't a gap, it's the PRD's own sanctioned scope reduction.
- **Stage 2B is complete except B21** (matching suggestions from a brief — cut on purpose, see the benchmarks section). **Stage 3 is partly built** (L1–L11, L13–L14, L26–L29 — see its sections); L12, L15–L25 and L30, and all of Stage 4, are not started. The PRD's own rule is that each stage should be in daily use before the next begins; real use of projects will show what the remaining reporting and case-study pieces should look like. Not modelled in finance: tax/VAT, credit notes, refunds or payment reversals, editing an invoice after it's created, and multi-currency.
- No UI yet for setting a route-level agent-cut override (the API exists).
- No self-service "forgot password" — a locked-out user needs a Manager/CEO to reset it from the Users page, not an email link. Simple to add later (Supabase supports it) but wasn't asked for.
- No audit-log UI — every admin action (user created, role changed, disabled) is written to `audit_events`, but there's no page to browse it yet, only direct SQL.
- Test coverage is backend-focused: there are no automated browser/UI tests.

## Deploying (GitHub + Supabase + Vercel — no local machine needed)

Do these in order. Everything is done in web dashboards.

### 1. Put the code on GitHub
Upload the **contents** of this folder so that `package.json` sits at the top level of the repo (or, if you upload the folder itself, set Vercel's *Root Directory* to that folder in step 3). Hidden files matter: make sure `.gitignore` and `.env.example` are included. Never upload a real `.env` file.
> GitHub's browser uploader accepts about 100 files per drop, and this project has more than that, so upload in two or three batches (or use GitHub Desktop, which has no limit).

### 2. Set up Supabase (free tier is fine)
1. Create a project. In the **SQL editor**, run each of these one at a time, in a fresh tab, waiting for "Success" each time:
   1. `supabase/schema.sql`
   2. `supabase/policies.sql`
   3. `supabase/functions.sql`
   4. `supabase/migrations/002_stage2a_role_split.sql`
   5. `supabase/migrations/003_stage2a_block1_proposals.sql`
   6. `supabase/migrations/004_stage2a_block2.sql`
   7. `supabase/migrations/005_stage2a_block3.sql`
   8. `supabase/migrations/006_stage2a_block4_conflicts.sql`
   9. `supabase/migrations/007_admin_managed_users.sql`
   10. `supabase/migrations/008_stage2a_block5.sql`
   11. `supabase/migrations/009_stage2b_contracts.sql`
   12. `supabase/migrations/010_stage2b_finance.sql`
   13. `supabase/migrations/011_stage2b_agent_access.sql` — **read its header first**: it tightens every existing policy so a future agent role cannot read staff data
   14. `supabase/migrations/012_stage2b_benchmarks_shortlists.sql`
   15. `supabase/migrations/013_stage3_projects.sql` — **changes existing deliverable statuses** (pending → planned, done → delivered)
   16. `supabase/migrations/014_stage3_proof_metrics.sql`
   17. `supabase/seed_categories.sql` — loads the 12 inventory categories

   If you ever paste a file twice into the same editor tab, or reuse a tab from a previous file without clearing it, Supabase will report an error from the *previous* file's content, not the one you meant to run — always paste into a fresh tab.

2. **Project Settings → API**: you'll copy the *Project URL*, the *anon* key and the *service_role* key into Vercel next.

There's no Google OAuth setup here — sign-in is email + password, with every account created by a Manager or CEO from the app's Users page (see step 4).

### 3. Deploy on Vercel
Import the GitHub repo (the framework auto-detects as Next.js). Under **Environment Variables** add:

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Public. **Must be set before the first build** (baked in at build time). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key | Public. Same: needed at build time. |
| `SUPABASE_URL` | Project URL again | Server-only |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **Server-only secret. Never prefix with `NEXT_PUBLIC_`.** This key is what creates and manages user accounts — treat it like a master password. |
| `ANTHROPIC_API_KEY` | your key | Only for Capture. `ANTHROPIC_MODEL` is optional. |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | the whole JSON key, on one line | Only for Drive filing (unrelated to sign-in) |
| `GOOGLE_SHARED_DRIVE_ID` | the Shared Drive's ID (from its URL) | Only for Drive filing and contract files |
| `AGENT_ACCESS_ENABLED` | leave **unset** | The agent-portal release switch. Set to `1` only after a security review (see the Agent access section). |

Deploy. If you change an env var later, **redeploy**: Vercel doesn't apply changes to existing deployments. Also confirm **Root Directory** (Settings → General) points at the folder containing `package.json`, and **Framework Preset** shows **Next.js** — if the build succeeds but the app fails at runtime with "Configure the Output Directory," this is almost always why.

### 4. First run: create your account, then everyone else's
1. Open **`https://<your-app>/api/health`** first. It lists every environment variable (true/false, never the value), whether each migration has run, whether categories are loaded, and whether an organisation/profile exist. Anything false tells you which step above to redo.
2. **Create your own account** — the very first one has no Manager/CEO yet to create it, so this one step uses the Supabase dashboard directly: **Authentication → Users → Add user**. Set your email and a password, and turn on **Auto Confirm User** (so it doesn't wait on an email you haven't configured sending for).
3. Go back to the SQL editor and run, with your real email and the user's UUID from the Users list you just created:
   ```sql
   with org as (insert into organisations (name) values ('EmergeX') returning id)
   insert into profiles (id, org_id, full_name, email, role_key)
   select '<paste the UUID>', id, '<your name>', '<your email>', 'ceo' from org;
   ```
4. Sign in at `https://<your-app>/login` with that email and password. You're now CEO.
5. Everyone else: **Users** page in the app (visible to Manager/CEO only) → **+ New user** → name, email, role. A temporary password is generated and shown once — copy it and send it to them however you'd send any password. They can change it themselves after signing in (**Change password** at the bottom of the sidebar).

### 5. Google Drive (optional — unrelated to sign-in, everything works without it)
Google Cloud Console → enable the **Drive API** → create a **service account** → create a JSON key. In Google Drive, open the Shared Drive → *Manage members* → add the service account's email as **Content Manager**. Put the JSON in `GOOGLE_SERVICE_ACCOUNT_KEY` and the drive ID in `GOOGLE_SHARED_DRIVE_ID`, redeploy, then check `/api/health?deep=1`. Without Drive, records and exports still work; exports just aren't filed, and the app tells you so.

### If something goes wrong
| You see | Most likely cause |
|---|---|
| Build fails on Vercel | Read the last red lines of the build log. Most often a missing `NEXT_PUBLIC_*` variable, or files missing from the upload (check every batch landed). |
| Build succeeds, but the deployed app errors immediately | Check Root Directory / Framework Preset (step 3) if it's a "configure the output directory" message; check env vars if it's a Supabase client error in the browser console. |
| `/api/health` says a migration check is false | That SQL file wasn't run, or errored. Run it and re-check. Files must go in the order above, each in a fresh SQL editor tab. |
| Signed in, but `/api/health` says `signedIn: false` | The server can't read your session cookie. Check the two `NEXT_PUBLIC_SUPABASE_*` values match your project, then redeploy. **This is the one flow that couldn't be tested before shipping — see "What hasn't been verified" below.** |
| "Signed in, but not set up yet" | Expected only for the very first account. Run the SQL snippet in step 4.3. Everyone after that gets a profile automatically when created from the Users page. |
| Login says "Unsupported provider" | Leftover from trying Google sign-in — this build doesn't use it. Use the email/password form. |
| Every action returns 403 | The user has no `profiles` row, or the wrong role for that action. |
| "Unsupported provider: provider is not enabled" | Same as above — not applicable to this build. |
| Capture says the AI call failed | `ANTHROPIC_API_KEY` is missing or invalid. |

| Export works but "Not filed in Drive" | Drive isn't configured, or the service account isn't a member of the Shared Drive. See `/api/health?deep=1`. |
| A CSV import stops partway | It's sent in batches of 20 and the message says where it stopped. Re-running is safe: existing vendors/properties are matched by name. |

## Stage 2A progress

All 6 blocks are built. (Stage 2A is now complete — see Stage 2B below for what comes after it.)

**Block 1**: A1 (Manager/CEO split), A2 (margin bands per tier), A3 (proposal record), A4 (add items), A6 (best valid cost), A9 (margin stack), A12 (approval chain).

**Block 2**:
- ✅ **A7 — agent cut methods per route, not just per agent**: found this gap while building it — Block 1 had cut config living only on `agents`, but the PRD specifically says "per route." Fixed via `004_stage2a_block2.sql`: `routes` now has its own nullable `cut_method/cut_pct/fixed_fee` that override the agent's default when set (`resolveAgentConfig()` in `pricing.ts` handles the fallback). API exists (`PATCH /api/routes/[id]`); no dedicated UI yet beyond the agent-level default editor on the Brands page.
- ✅ **A8 — pricing mechanic (fee/commission/markup)**: previously a column that did nothing. `computeMarginStack()` now branches on it — markup is cost-plus (rate% of cost), commission is revenue-share (rate% of the resulting *sell* price, solved algebraically so that actually holds), fee is a flat amount independent of cost entirely. Verified numerically: same nominal 20% rate produces a different (higher) sell price under commission than markup, and a fee mechanic gives the exact same margin on a $10k cost as a $500k cost.
- ✅ **A10 — warnings**: below/above tier band, above known market price (compared against the latest `market_intel` price record — the one legitimate use of market intel data per PRD 6.6, just not as *cost*), and edge-property exemption. Verified as a specific interaction, not just each rule alone: a 30% margin against an 18-24% band correctly suppresses the band warning when the property is flagged edge, and shows *only* the edge note.
- ✅ **A11 — other-brand prices shown internally for Media/IP items**: gated the same way as margin visibility (D10) since it's the same class of internal-commercial-sensitivity information. Only fires for Media/IP-and-content category groups, not sponsorship/talent (which are typically exclusive per deal anyway).
- ✅ **A13 — block sending until priced at Manager level**: `/api/proposals/[id]/stage` checks every line has at least one `manager`/`ceo`-layer approval action before allowing a move to Approved/Sent — returns the specific unpriced item names in the error, not just a generic rejection.
- ✅ **A14 — proposal stages and stage history**: `proposal_stage_history` is append-only, one row per transition, with a required reason enforced for Lost.
- ✅ **A29 — won proposal creates the deal record**: idempotent — a duplicate call doesn't create a second deal.

**Block 3**:
- ✅ **A15 — proposal versions with a change record**: each version is a snapshot of the *brand-facing* lines (item, quantity, sell price — never cost or margin, which is what lets every internal role read the history without undoing D10) plus a human-readable diff against the previous version ("LED: price 1,000 → 1,200; Added Signage; Removed Mats"). A version is only created when something actually changed, so exporting twice doesn't mint a new one. Unique `(proposal, version_number)` is enforced by the database.
- ✅ **A16 — negotiated prices saved back as price records**: recorded against the item, brand, route, proposal and exact line. A `reusable` flag says whether the vendor will extend the rate to other brands. **This required a fix to cost selection**: `bestValidCost` now excludes a non-reusable negotiated rate for every brand except the one it was negotiated for (tested), otherwise a rate won for one brand would have silently become another brand's cost. Recording a negotiated cost needs only `price.record_cost` (Team can); *applying* it to a line changes the brand-facing price, so it also needs `margin.set`, and is checked before anything is written.
- ✅ **A18 — Excel export, brand-facing only**: `src/lib/proposalExcel.ts`. The builder's input type has no cost/margin/agent/vendor fields at all. Line totals and the grand total are live formulas with cached values.
- ✅ **A19 — filed to the proposal's Drive folder**: folders are created per proposal at creation (best effort) and the export is uploaded into it. Exports are chained per proposal with exactly one marked current. Drive is best effort: if it fails you still get the file, the share is still logged, and the failure is audited and shown to you.
- ✅ **A20 — export logs a share**: one share row per line, tied to the exact proposal version sent, channel "Proposal export". The share is logged *before* the Drive upload.

**Decisions I made that you should review:**
- **D9 (export layout) was not decided in the PRD — the layout is a draft** I designed (title block, meta rows, `# / Property / Item / Basis / Qty / Unit price / Total`, grand total). It's isolated in one file so a real template is a one-file change. Note it deliberately omits the route/agent name and any terms/validity text — I didn't want to invent client-facing wording.
- **Exporting is only allowed from Approved onward.** "Manager approves sending" is enforced at the stage change (every line must be priced by a Manager/CEO first), so Team can then export an approved proposal without needing `proposal.approve_send`. Export re-checks that no unpriced line slipped in after approval. Export does **not** move the stage to Sent — that stays a Manager action.
- **Export and share-logging are one action** ("Export & log share"). There's no separate "preview" export.
- **No currency conversion exists.** A cost in a different currency from the proposal is rejected when adding a line (and again at export) rather than silently mislabelling the client's price.

**Block 4** (share conflict checks):
- ✅ **A21–A24** in one tested SQL function, `check_share_conflicts()`: (A21) already reached this brand via a *different* route or contact; (A22) the recipient agent already has it for another of their brands; (A23) already reached another brand in the same brand group; (A24) already reached a *competing* brand in the same market. Re-sending to the same brand via the same route is deliberately **not** a conflict.
- ✅ **A25 overrides**: anyone building proposals can *request* an override (reason required); a Manager/CEO approves it on the Approvals page; a Manager/CEO's own request is approved on the spot. An override covers exactly one (item, brand, route) and is **single-use**, so re-sending an updated proposal that still conflicts needs a new one.
- ✅ **Enforced at both places a share happens**: exporting a proposal and the manual share log. A blocked export leaves no version, no share and no file.
- ✅ **A5**: everything already shared with a brand is shown when starting a proposal and on the proposal page.
- ✅ Brand groups and the competing-brands list now have UI (Brands page).

**Decisions I made that you should review:**
- **D8 (which brands compete) is data you maintain, empty by default.** With nothing listed, the competing-brand check never fires. Links work brand↔brand or group↔brand, in either direction.
- **My reading of A24** ("a competing route in the same market"): the item was already sent to a *competing brand* in the same market. If either side's market isn't recorded it's flagged (conservative) and says so.
- **Shares logged after the fact** (pasted from a chat) are never blocked, since it already happened. They're recorded with the conflict flagged.
- **A fix from this pass:** the add-line response was returning the tier's margin band and market-intel prices to Team (in the "warnings" text), quietly undoing the D10 rule. It's now margin-permission only, and the end-to-end suite asserts it.

**Block 5** (pipeline, won/lost, CEO view):
- ✅ **A26 — items move out of `available` on Sent**: the first time a proposal reaches Sent (not on later re-saves), each line's item flips to `proposed`. A second move through Sent (e.g. Sent → Negotiating → Sent again) doesn't re-touch it.
- ✅ **A30 — transacted prices written back on Won**: the actual cost used becomes a `transacted` price record on the item, which now correctly outranks `rack`/`quote`/`negotiated` for the next `bestValidCost()` lookup — verified directly: added the same item to a second proposal afterward and confirmed the resolved cost source was specifically the new `transacted` record, not the older `rack` record that happened to have the same amount (a coincidental-equal-amount check wouldn't have proven this; tracing `cost_source_price_record_id` back to its `type` does).
- ✅ **Items also move to `sold` on Won.** Not explicitly named in the PRD's A-list, but a reasonable completion of the lifecycle (`available → proposed → sold`) — otherwise a won item stays marked `proposed` forever. Flagging this as inference, not PRD text.
- **Two real bugs, caught only by running this against real Postgres, not by review:** the transacted-price write-back was missing `org_id` (a `NOT NULL` violation that failed *silently* until I added error-checking — it would have shipped broken); and my first idempotency approach used `upsert` targeting a partial unique index, which Postgres won't match unless the `ON CONFLICT` clause itself repeats the partial index's `WHERE` condition — something `supabase-js`'s `upsert` can't express. Replaced with an explicit check-then-insert, which also IS the idempotency guarantee now, not just a fast path in front of one.
- ✅ **A27 — pipeline view** (`/pipeline`): Kanban by stage. `value` (brand-facing total) is visible to everyone; `net_margin_pct` is `null` unless the caller holds `margin.view` — tested as an explicit assertion (Team's response has every `net_margin_pct` as `null`; Manager's doesn't), not just "the endpoint returns 200."
- ✅ **A28 — won/lost analysis**: by brand, agent, market, category, and loss reason, all on the same pipeline page.
- ✅ **A32 — CEO sign-off queue**: a line appears once a Manager has set its margin and disappears once a CEO has confirmed or overridden it — defined as "the most recent pricing action on this line was a Manager's, not a CEO's," not a static flag. Tested as a real before/after state change (line present → CEO confirms → line gone), not just that the endpoint returns something.
- ✅ **A33 — CEO View** (`/ceo-view`): all four PRD 6.14 quadrants — inventory (value/expiring/edge/stale), brands & agents (route mix, conflict counts), pricing (the sign-off queue + recent vendor rate changes), team (recent `audit_events` + pending-approval counts).
- ✅ **`ceo_view.access` confirmed CEO-only, not Manager** — this was the one permission boundary in the whole build most likely to get fat-fingered (Manager already holds almost every other permission via the additive role design), so it got its own explicit test: Manager gets 403 from `/api/ceo-view`, same as Team.

**Block 6**:
- ✅ **A34 — notifications, built as the PRD's own fallback** ("Dashboard lists plus a weekly email" when time is short): `/notifications` aggregates due/stale records, pending approvals, stalled proposals (no stage change in 7+ days), upcoming contract renewals, and overdue deliverables into one triaged feed. The email half isn't built — no SMTP is configured anywhere in this project, and adding one wasn't asked for.
- ⬜ **A17 (PowerPoint export) — deliberately not built**, per the PRD's own cut-list: Excel-only, which already exists.

## Stage 2B — contracts, deliverables & finance

Built: **B1** (a contract per Won deal, `final_amount` computed from the proposal's own brand-facing line totals rather than re-entered by hand), **B2** (deliverables with due dates, owners, and a pending/done status), **B4** (renewal dates feed straight into the Notifications page).

**A real bug, caught only by running it, not by review:** `deliverables` has two foreign keys into `profiles` (`owner_id` and `created_by`). A bare `profiles(full_name)` embed is ambiguous to PostgREST — it has to be told which relationship via the constraint name (`profiles!deliverables_owner_id_fkey(...)`). The query was erroring, and because the error wasn't checked, it silently looked like "this contract has no deliverables" instead of "this query failed" — a newly-created deliverable would have appeared to vanish. After finding it, I searched the rest of the codebase for the same unqualified pattern against any table with more than one FK into `profiles` (`share_conflict_overrides`, `reconfirmation_overrides`, `route_score_changes` all have two) — those were already correctly disambiguated from earlier passes; `deliverables` was the one actual miss.

**Decisions made here:**
- **Creating a contract and adding/editing deliverables needs `contract.manage`** (Manager/CEO) — but **marking a deliverable done only needs `record.update`**, which Team already holds. Ticking off completed work is operational, not a contract-terms change.
- **One contract per deal**, enforced by a unique constraint, not just application logic.
- **`final_amount` is the brand-facing total**, same visibility rule as the pipeline's `value` column (D10) — it's not margin, so there's no permission gate on reading it.

**Finance is documented in its own section below; the rest of 2B (B3, B12–B22) is listed under "What's still missing" above.**


### Finance: billing, payments, payables, overdue, export (B6–B11)

- ✅ **B6/B7 — billing schedule → receivables.** From a contract, generate N draft invoices that sum to **exactly** the contract total. All money maths is done in integer cents; leftover cents go on the last instalment; each due date is computed from the *first* date, so a 31 January start stays on month-ends (31 Jan, 29 Feb, 31 Mar). Backed by a 2,000-case property test (instalments always sum to the total, none negative). Billed to the brand by default, or to an agent ("receivables from brands or agents", PRD 6.15). One schedule per contract; void its invoices to regenerate.
- ✅ **B9 — payments.** Partial and full. **The database itself refuses** an overpayment, a payment on a draft/void invoice, and voiding an invoice that has payments — tested directly against Postgres, so a bug or a race in the app can't corrupt the books (a row lock serialises two payments arriving together). "Paid / part paid / overdue" are *derived* from the payments and due date, never stored, so they can't drift.
- ✅ **B10 — overdue list and chase reminders.** Overdue = issued, still owed, past due. Logging a chase clears the reminder for 7 days. The reminder is in-app (Finance page, invoice page, Notifications) — no email, since no SMTP exists in this project.
- ✅ **B8 — payables.** One bill per vendor (the sum of the real cost × quantity of that vendor's lines) plus one to the agent for their commission. A *fixed-fee* agent is paid the fee **once** — their cut is stored on every line, so naively summing it would pay them once per line (caught and unit-tested). Items whose property has no vendor are grouped under "Unassigned vendor" and flagged, never silently dropped.
- ✅ **B11 — CSV export** (receivables, payables, payments). **D11 (which accounting tool, and push vs export) is undecided in the PRD**, so this is a plain tool-agnostic CSV. It neutralises spreadsheet formula injection (a text cell starting `=`, `+`, `-` or `@` gets a leading `'`) — vendor and brand names are typed by users and flow straight into these files.

**Decisions to review:**
- **All finance data is behind one permission, `finance.manage` (Manager/CEO). Team sees none of it** — no RLS policy for them at all (not a hidden column), and money never appears in Team's Notifications (tested). Generating payables additionally needs `margin.view`, since it reads vendor cost and agent cuts — the same margin-side data Team is already kept from (D10). If you'd rather Team could *view* receivables, that's one RLS policy and one permission check.
- **Payments can't be edited or deleted** — only recorded. A mistaken payment currently needs a database fix; a reversal flow wasn't asked for and is a real piece of accounting design, not a quick add.
- **A payable is "approved" with the same Issue action as an invoice**, and needs a due date to be approved.

**Not verified here:** none of this has been clicked through in a browser, and the CSVs haven't been opened in Excel/your accounting tool.

## Stage 2B — agent access (B12–B17) and contract files (B3)

> ### ⚠️ Do not turn the agent portal on until a person has reviewed it
> PRD 6.16: agent access is *"released only after a security review"* (B15). **I can build and run the access tests; I cannot be the independent reviewer, and nothing here claims to be one.** So the portal ships **OFF**: it only works when the `AGENT_ACCESS_ENABLED` environment variable is `1`. You can create agent logins and share items while it's off (to prepare); agents just can't use any data route. `/api/health` shows which state you're in. The review checklist is below.

**What was built**
- **B12 — agent accounts.** A new external role, `agent`, belonging to an *agent company* (`profiles.agent_id`; the database enforces that exactly agent users have one, in the same organisation). Created from **Users** (Manager/CEO). An agent account can never change role — disable it and create a new one. Agents use a separate portal at `/agent`; the staff app redirects them there.
- **B13 — sharing.** **Agent access** page: tick items (or a whole property → its *current* items), optionally set a white-label title and an indicative price. Revoking is immediate and permanent (a revoked grant's id stays dead; re-sharing makes a new one).
- **B14 — the agent's view.** Item name/white-label title, category, market, event dates, offer expiry, availability, a small set of allow-listed attributes, and a price **only if you typed one**. Never vendor, cost, margin, price history, route scores, share logs, other agents, or internal intel.
- **B16 — agent intel.** Lands unrated and pending. A price an agent *claims* creates **no** price record until a reviewer accepts the note (market-intel prices feed the "above market price" warnings, so an unreviewed number must not reach them). Reviewed exactly once. The agent sees a status, never the rating.
- **B17 — activity log.** Every inventory/item/intel view is recorded, append-only in the database (not even the service layer can alter it), and readable on the Agent access page.
- **B3 — contract files.** On each contract: versioned documents in the Shared Drive, one marked current per document, identical re-uploads ignored, roll back with "Make current". **Unlike a proposal export, if Drive can't take the file the upload is refused and nothing is recorded** (a contract exists nowhere else). Content-checked (a renamed `.exe` isn't a `.pdf`), 4 MB limit (the serverless request limit), `contract.manage` only.

**How agents are kept out — three independent layers**
1. **Database (RLS).** Until now every policy only asked "same organisation?". Every existing `SELECT` policy now also requires `is_internal()`; agents can read exactly one row — their own profile. There are no insert/update/delete policies at all.
2. **Server (`requireProfile`).** It now **refuses external users by default**. All ~79 routes call it with no arguments, so a route someone forgets to protect is still closed. Only `/api/agent/*` and `change-password` opt in.
3. **Field allow-list.** What an agent receives is built by one pure function (`src/lib/agentView.ts`) that names every permitted field — an allow-list, so a sensitive field added later is hidden by default.

**B15 — the access tests (this is what *was* verified):**
- **A sweep that auto-discovers every route** (79 routes, 95 handlers) and proves each refuses an agent (403) and an anonymous visitor (401), that agent routes refuse staff, and that the hostile requests wrote nothing except the two views that are logged by design. It fails if it can't find the routes, and a future route is covered automatically.
- **The database, as a real agent login:** 35 populated tables return zero rows; 14 structural guarantees (every select policy requires `is_internal()`, no write policies exist, the only `SECURITY DEFINER` functions are the four known helpers and each pins its `search_path`, an agent can't promote themselves or switch company, the activity log can't be altered, …). `supabase/tests/agent_access.sql` (self-contained) and `agent_rls_sweep.sql` (run it on a database that holds data — on an empty one it proves nothing, and says so).
- **Leak scans:** a planted vendor name, cost, contact, brand names, another agent's name and an internal note must appear nowhere in any agent response; the item view must contain *exactly* the documented keys.
- **Probing:** another agent's grant, a made-up id and a malformed id return identical 404s; revoked grants are 404 on the next request; disabled accounts are refused immediately (a ban doesn't invalidate a token already issued, so `profiles.disabled` is checked too).
- **The tests were themselves tested.** I broke the security six ways and confirmed each was caught by the test meant to catch it: a policy missing `is_internal()` (the all-tables sweep *and* the structural check), `vendor_name` added to the allow-list, the external-user deny removed, the agent scope removed from item lookup, and the revoked-grant check removed. (Four extra e2e failures in that run were honest knock-ons of the revocation break.)
- **Two real defects found by these tests, both fixed:** agents were blocked from changing their *own* password (the sweep had to allow-list that route, so only an explicit check exposed it); and `safeFilePart` let `..` runs and leading dots through into filenames.

**Decisions to review**
- **D12 (what an agent sees) is undecided in the PRD — this is my default, deliberately conservative:** no price unless you type one per item; "proposed", "sold" and "on hold" all show as "Not currently available" (telling an agent *which* would reveal other parties' deals); attributes only from an allow-list that excludes anything naming the source (`vendor_name`, `management_contact`, `fleet_operator`, `league_name`, …). **Item and property names are shown as typed** — set a white-label title if a real name identifies its source.
- Sharing is **per item** (a property expands to its current items; later additions aren't shared automatically). Marking things shareable, reading activity, and reviewing intel are Manager/CEO (`agent.share.manage`, `agent.intel.review`). Contract files are `contract.manage` only — they can contain agent cuts.
- Each agent company is capped at **50 notes awaiting review**; notes are 2,000 characters max.

**Checklist for whoever does the security review — known limits, in plain terms**
1. **Never run against real Supabase Auth or a real Drive.** RLS was tested on a real PostgreSQL 16 using a stand-in for `auth.uid()`; Drive was an in-memory fake. Verify on a staging project: sign in as an agent and try `supabase.from('price_records').select()` in the browser console — it must return nothing.
2. **Creating an agent login** calls Supabase's Auth Admin API, which couldn't run here (only the validation around it was tested).
3. **`SECURITY DEFINER` helpers** (`current_org`, `current_role_key`, `has_permission`, `is_internal`) are assumed to run with RLS bypassed (true for the normal `postgres` owner); they're existing, caller-scoped and pinned.
4. **`/api/account/change-password` doesn't ask for the current password** (pre-existing design); anyone holding a live session can change it. Worth tightening before agents exist.
5. **`/api/health` is public by design** (it must work before anyone can sign in); it exposes only booleans, but consider restricting it after setup.
6. **Reference tables** (`categories`, `roles`, `permissions`, `role_permissions`) have no RLS and are readable with the public key — no business data, but they reveal the permission model.
7. **No general rate limiting** beyond the 50-note cap; consider Vercel's protections for the agent routes.
8. **Fail-closed logging** is proven at the function level (a failed log write rejects with "not shown"); I did not force a database failure through a live route.
9. **Concurrent contract uploads** are safe (tested: distinct versions, one current) but can leave an orphaned copy in Drive.
10. The activity log records *what* was viewed and by whom, not IP address or device.


## Stage 2B — price benchmarks and shortlists (B18–B20, B22)

This completes Stage 2B **except B21 (matching suggestions from a brief), which is deliberately not built**: the PRD says it comes last "once there is enough history", and its own cut-list says to drop it in favour of saved filters and shortlists, because thin data makes suggestions weak.

**What was built**
- **B18 — benchmarks** (`/benchmarks`). Typical cost ranges (low, 25th–75th percentile, median, high) from your own price history, filterable by category, market, vendor, unit, currency, days-to-event and recency. Computed in SQL (`price_benchmark()`, exact percentiles); TypeScript reproduces the same numbers, and a test asserts they agree.
- **B19 — price curve.** Per property: prices against days before the event, with median per band (0–7, 8–30, 31–60, 61–90, 91–180, 181+ days).
- **B20 — brand tier in the range.** Choose a brand and each range gains a **suggested sell range** = the cost quartiles plus that brand's tier margin band. Manager/CEO only (the band is Management-only data): Team asking for it is **refused with a 403, not silently ignored**.
- **B22 — saved filters and shortlists** (`/shortlists`). Search the inventory, save the filter, collect items in named shortlists, and add a whole shortlist to a proposal from the proposal page (it uses the existing add-line endpoint, so every pricing rule still applies and failures are listed with the reason). Private by default; shareable **read-only**; only the owner can change or delete.

**Rules the code enforces — and the tests prove**
- **Like for like.** One result row per *(pricing unit, currency)*. A per-match price is never averaged with a season fee; USD is never mixed with EUR. No currency conversion is attempted.
- **Honest about thin data.** Under 3 prices there is no range — the single value is shown with its sample size and nothing is suggested from it. Confidence is labelled (insufficient / low / moderate / good).
- **Days-to-event is never guessed.** A recorded value is used; otherwise it's derived from the property's event date; a price with neither is left *out* of any days filter (and counted on the curve). A price recorded after the event started is excluded from the curve and counted.
- **Market-intel prices are a separate reference**, never part of the cost range (and never reach best-valid-cost, as before).
- **Advisory only.** Nothing here changes a price, a margin or a proposal.
- **No arbitrary data in saved filters.** Criteria are whitelisted (category, market, vendor, availability, text, stale-only); unknown keys, wrong types, arrays and over-long values are refused with a clear error rather than stored.
- **Access.** Staff only: every table has RLS and no write policies, an agent reads nothing from them, and the all-routes sweep (now 88 routes) proves the new endpoints refuse agents and anonymous visitors without anyone having to remember to add them.

**Testing, including the tests being tested.** 10 SQL checks use hand-computed numbers (10k/20k/30k/40k → quartiles 17,500 / 25,000 / 32,500) and cover unit/currency separation, the derived-days logic, organisation isolation and the shortlist privacy rules; 12 pure checks; 9 end-to-end steps. I then broke it four ways — the SQL mixing currencies, the sell-range arithmetic, the tier permission check, and the owner-only check on shared lists — and each break was caught by exactly the test meant to catch it. Two of my own *expected values* were wrong before the first end-to-end run (a `max_days` filter does not exclude a price recorded *after* the event; I also wrote one nonsense expression); I fixed the tests, not the code, after checking the arithmetic.

**Limits to know about**
- **Thin data gives weak numbers, whatever the maths.** Until you have a few prices per category/market, most groups will show "insufficient". That's the correct answer, not a bug.
- **Every price record counts once**, so an item re-priced often weighs more than one priced once, and a won deal appears twice (its cost and its transacted price). Both are noted on the page. A smarter weighting is a design decision, not a quick change.
- **Item search** applies the text box after fetching up to 500 matches (then shows 200); a very broad search tells you it was truncated.
- A shortlist holds at most 200 items and a person at most 50 shortlists / 100 filters — the caps are in the code but the 200-item cap is not exercised by a test.
- **Not verified in a browser**: the three new screens (including the SVG price curve) have been type-checked and built, not looked at.


## Dependency security — read before opening the agent portal

**Done:** Next.js upgraded from 14.2.5 to **14.2.35**, which fixes CVE-2025-55184 (a request that makes the server hang, high severity) and its incomplete first patch (CVE-2025-67779). This app uses **no middleware and no Server Actions**, so CVE-2025-29927 and CVE-2025-55183 never applied. A safe `npm audit fix` also cleared `source-map-js`. The whole suite passes on the new version.

**Not done, and it matters:** `npm audit --omit=dev` still reports **7 findings (1 critical, 4 high, 2 moderate)**. They come from **Next.js 14 being end-of-life** — advisories published after it was retired were never back-ported, and the only fix npm offers is Next 16 (a major upgrade). Of those:
- **`next` (reported "critical")** — about two dozen advisories, many about features this app doesn't use (middleware, Server Actions, rewrites, i18n, self-hosted or Windows servers, the image optimiser). Hosting on Vercel rather than self-hosting also removes some. **I have not verified that every one is harmless, and I'm not claiming it.**
- **`postcss`, `glob`, `eslint-config-next`** — build-time tooling that travels with Next; cleared by the same major upgrade.
- **`exceljs` → `uuid` (moderate)** — only reachable if code hands uuid a pre-allocated buffer, which this code doesn't. The only "fix" is downgrading exceljs to a 2019 release, which I'd advise against.

**Recommendation:** migrate to a supported Next.js major **before the agent portal is released to outsiders, or before you hold sensitive client data you couldn't afford to expose.** It is a real piece of work, not a version bump: Next 15/16 make `params` and `cookies()` asynchronous (touching ~90 route handlers and the sign-in code) and move to React 19. The end-to-end suite and the all-routes sweep are exactly the safety net for it. Add this to the agent-access review checklist.

## Stage 3 — live projects (first part: L1–L10, L28, L29)

Every Won deal now becomes a **project** with a checklist, parties, a communication log and delivery tracking. **This is the first part of Stage 3, not all of it** — see "Not built yet" below.

**What was built**
- **L1 — automatic projects.** Marking a proposal Won creates its project (once; safe to repeat). The template is chosen by category (D14: league, team, player, celebrity, IP, events → *Full*; influencer, OOH, digital, broadcast, transit, content → *Short*). A deal spanning categories, or with none recognisable, gets *Full* — too many steps is safer than a missing one. Deals won **before** this release have no project: the Projects page shows a banner and a one-click **Create them** (Manager/CEO).
- **L2 — upsells.** A project can be linked as an upsell of the **original** (never of another upsell, never of itself); the parent shows its upsells together with a combined delivery %. The deal-level link is kept in step.
- **L3–L5 — checklists.** Items carry owner, due date, notes and **N/A (which needs a written reason)**; custom items can be added per project and archived. **Brand-side and team-side are tracked separately**, and phase progress leaves N/A out of the denominator.
- **L6 — the paperwork gate ticks itself.** Items can be tied to a rule (*contract created, contract file uploaded, billing schedule created, first invoice issued, first payment received, all invoices paid*) and are ticked from the live contract and invoice records. It is evaluated every time the page loads, so it **reopens** if the records change (void the whole schedule and "Billing schedule set up" un-ticks). A *part* payment is not "payment received". The checklist sees only ticks, never amounts.
- **L28 — parties.** Brand, brand-side route (direct or agent), EmergeX owner, delivery-side agent(s) and vendor(s) are filled in automatically from the deal and can be edited.
- **L29 — communication log.** Requests, approvals, updates and proof, with party, direction, channel, date and what they relate to (a deliverable or a checklist item). A request records **who is waiting on whom** (we sent it → waiting on them; we received it → waiting on us) and the project list shows what is waiting on you. **The log cannot be edited or deleted** — the database refuses, even from the service layer. The only permitted change is resolving an open request, once; corrections are new entries.
- **L7–L10 — delivery tracking.** Deliverables on the contract now have a **planned quantity and unit**; recording a **delivered quantity** sets the status (planned / partial / delivered) — **nobody sets "delivered" directly**, so status and quantity cannot disagree (a database constraint enforces it too). A deliverable can be marked **missed**, then either given a **make-good** (the original becomes *replaced* and drops out of the delivery %, its make-good counts instead) or **flagged for an invoice adjustment** — never both. Flagging only records intent; it touches no invoice.

**Decisions I made that you should review**
- **D13 — delivery % weighting (open in the PRD):** by **count** — every deliverable weighs the same (deliverables carry no value yet). A *missed* deliverable counts what was actually delivered of it (usually 0%, but 2 of 5 delivered then written off is honestly 40%).
- **Who can do what:** *Team* records deliveries, updates the checklist, keeps the log and edits parties. *Manager/CEO* (`project.manage`) create/repair projects, link upsells, change the owner, mark deliverables **missed**, make-goods and invoice adjustments (they have commercial consequences). Changing a deliverable's **terms** (quantity, dates, description) stays `contract.manage`.
- **Existing 2B deliverables were migrated in place:** `pending` → `planned`, `done` → `delivered` (quantity = planned). The old pending/done toggle no longer exists; the contract page now records a delivered quantity.
- **Project creation on Won is best-effort**, like Drive filing: a failure never undoes the Won, it is written to the audit log, and the backfill repairs it. (I did not force that failure path in a test.)

**⚠️ The checklist content is a DRAFT.** L4 says the Full template comes from "the existing execution checklist", which isn't in any document I was given — only the phase names are. I will not pass off my own invented steps as EmergeX's process. The shipped steps follow the PRD's phases and are labelled DRAFT; **Manager/CEO edit them on the Project templates page** (add, rename, retire, set which steps tick themselves). Edits apply to **new** projects only — a live project keeps the checklist it was given.

**Not built yet:** see the end of the next section (proof, metrics and project alerts are now built).

**Testing, including the tests being tested.** 17 pure checks, 10 database checks (status/quantity can't contradict, upsell loops, the log's immutability, make-good rules, row-level security — an agent reads none of it), and 13 end-to-end steps (91 in all, across 103 routes now covered by the agent/anonymous access sweep). I then broke it eight ways and each break was caught by the test meant to catch it: five database guards dropped one at a time, "first payment received" ticking on an *issued* invoice, a replaced deliverable staying in the average, Team allowed to mark deliverables missed, paperwork rules that never tick, and retired template steps still being copied.
**That exercise found two weaknesses in my own tests, both fixed:** the unit test for the paperwork rules only checked the "yes" case, so an over-eager rule survived until I added the "issued but unpaid" case; and my first database mutation run was invalid because it ran on a database the end-to-end suite had edited (a phase 7 had been added to a template), so an exact-match template check failed before reaching the guards — that check is now "required phases exist", which is also what stays true once you edit your own templates.
**Not verified:** none of the new screens (project page, project list, templates page, the contract page's delivery controls) have been opened in a browser — they have been type-checked and built.

## Stage 3 — proof, metrics and project alerts (L11, L13, L14, L26, L27)

**What was built**
- **L11 — proof per deliverable.** Each deliverable takes **uploaded files** (stored in the project's own folder in the Shared Drive) or a **link to an existing Drive file**. Uploads are content-checked (png, jpg, pdf, Office; 4 MB — anything larger goes in Drive and is attached as a link), identical files aren't attached twice, and **if Drive is unavailable the upload is refused and nothing is recorded** (a proof exists nowhere else). A link must be a plain `https` link on `drive.google.com` or `docs.google.com` — exact host match, so look-alikes (`drive.google.com.evil.example`, `evildrive.google.com`), `javascript:` URLs and links with embedded credentials are refused. Proof is archived, never deleted. A deliverable that has been delivered (even partly) with no proof on file is flagged **"No proof yet"**.
- **L13 — metric sets per category.** Every one of the 12 categories has a set (the PRD's examples for influencer, OOH, digital and sponsorship; my own draft for the rest). Manager/CEO edit them on the **Project templates** page (add, rename, retire).
- **L14 — dated metric entries.** A reading per deliverable (or for the whole project) with a date and a **source**. Only a metric from *that project's* categories is accepted. **An entry can never be edited or deleted** (the database refuses): a wrong one is **voided with a reason** and the right figure recorded as a new entry.
- **L26 — CEO view.** A "Live projects" section: active projects, average delivery, open paperwork gates, requests waiting on us, and **delivery at risk** — and every project lists *why*: overdue deliverables; a missed deliverable nobody has resolved (no make-good, no invoice-adjustment flag); a request waiting on **us** for more than 5 days; overdue checklist steps.
- **L27 — notifications** (for **every** staff role — nothing in them is financial): *Waiting on us* (urgent after 5 days), *Deliverables due this week*, *Delivered without proof*, *Overdue project steps*. Each clears itself when the cause is fixed.

**Decisions I made that you should review**
- **D15 — the metric set per category is open in the PRD.** The seeded sets are a **draft**; the page says so.
- **Each metric entry is a running total *as of its date*, not an increment.** The headline uses the **latest** reading per deliverable and metric, so a newer reading *replaces* an older one instead of double-counting (a test asserts 1,500 replaces 1,000, giving 2,100 not 3,100). **Counts are added across deliverables; rates (engagement rate, CTR) are averaged — unweighted**, so a rate over a tiny deliverable counts as much as one over a huge one. A proper weighting needs the underlying counts, which aren't recorded. If your platforms report *per-period* figures rather than running totals, tell me and I'll change this.
- **"At risk" is deliberately a short, explicit list of four reasons** rather than a score — you can always see why a project is flagged. The 5-day threshold is mine.
- **Delivery at risk is CEO-only** (it lives in the CEO view); the notifications go to everyone.
- **Reports aren't built, so "report due" isn't in the notifications and a log entry can't yet be "related to a report".**

**Not built (the rest of Stage 3):** **L12** tracker import (still needs a sample of your real tracker sheet), **L15** reading metrics from screenshots with AI (the PRD's own cut-list allows manual entry instead, and a live AI call can't be tested here), **L16–L21** live reports, snapshots, PDF export and the expiring brand link (the PRD requires a security review before the first external link), **L22–L25** closure, case studies and the repository, **L30** pasting chats into the log.

**Limits**
- **A pasted Drive link is not checked for existence or permissions** — the app never fetches it. Whoever clicks it needs access to that file in Drive.
- Metric entries are by hand; nothing is pulled automatically from a platform.
- **Not verified in a browser:** the proof panel, the Metrics tab, the CEO view's new section and the metric-set editor — type-checked and built only.

**Testing, including the tests being tested.** 11 pure checks, 5 database checks, and 5 end-to-end steps (**96 in all**, across **109 routes** now covered by the agent/anonymous access sweep; an agent reads **zero rows from 44 populated tables**). I broke it nine ways — five database guards (entry immutability, "only a defined metric", no duplicate proof, same-organisation proof, an upload needs its file), the "latest reading" rule, a sloppy Drive-host check, rates summed instead of averaged, a metric from the wrong category accepted, a Drive failure silently recorded as success, a missed-but-flagged deliverable still counted "unresolved", and proof accepted on a closed deliverable — and each was caught by the test meant to catch it. I had to run the proof-on-closed-deliverable break *separately* to show it, because the Drive-outage assertion in the same test step aborted it first.
**Things that went wrong on the way, all fixed:** my own database test had a literal `%` in a notice (`RAISE` read it as a placeholder), set a "voided by" user up too late, and attached a proof to another organisation's deliverable — which the new guard correctly refused; and my test runner printed only the first four lines of a failure, hiding the diff for a real bug (the endpoint that *records* a metric didn't return who recorded it, though the list endpoint did — now the same shape). The runner now prints the whole diff.

## Architecture notes for whoever builds Stage 2A next

- Every new write path should go through `createRecord`/`updateRecord` in
  `serviceLayer.ts`, not a direct `supabase.from(...).insert()` — that's
  what keeps "no direct writes" true as the system grows.
- Adding a role (the Manager/CEO split, done; Agent in 2B; Brand in 4) is a
  `roles`/`role_permissions` data change — see how `002_stage2a_role_split.sql`
  did it. If a new role needs new code (not just new permission rows), that's
  usually a sign a permission is missing, not that the role needs special-casing.
- `price_records.proposal_id`, `price_records.outcome`, and
  `shares.proposal_version_id` are already nullable FKs into the empty
  `proposals`/`proposal_versions` tables — Stage 2A should populate those,
  not add new columns.
