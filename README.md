# EmergeX OS — Stage 1 (PRD v2.0)

This supersedes the earlier `emergex-os/` package entirely. That build mixed
capabilities from every stage into one Vite/React app with client-side
Supabase writes. This one is Stage 1 only, built to the actual PRD: Next.js +
TypeScript, every write going through a real service layer, org-scoped
multi-tenancy, the two-level property/item inventory model, category-driven
re-confirmation, route scoring, and universal versioning.

## What has and hasn't been verified

**Verified by execution, on a real PostgreSQL 16 plus a real PostgREST server:**
- All SQL (schema, policies, functions, migrations 002–006, category seed) runs cleanly in order.
- **An end-to-end suite (`tests/e2e`, 27 checks)** runs the *real route handlers* → real `supabase-js` → real PostgREST → real Postgres, acting as Team, Manager and CEO. It covers record creation, the whole pricing/approval/export/version/share flow, every permission boundary (Team refused where it should be), share conflicts and overrides, CSV import, and `/api/health`. It is also what proves that every `select(... embed ...)` string the app uses resolves against the real schema.
- **17 conflict-check scenarios** (`supabase/tests/conflicts.sql`), including the cases where it must *not* fire.
- **Row-level security tested as four different signed-in users**, plus every insert shape the code uses.
- `tsc --noEmit` is clean, `next build` succeeds, and 13 pure-logic checks pass (`npm run test:logic`).

**Not verified — there was no environment for it. Treat these as untested until you've seen them work:**
- **Google sign-in and the browser-to-server session cookie hand-off.** The end-to-end suite replaces only this one lookup with "the test says who's signed in"; everything after it is real. If sign-in works but the app behaves as signed-out, this is where to look (`/api/health` shows it).
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

- Nothing has been run against real Google, Anthropic, or a browser yet (see "Not verified" above) — the first deploy is where those get proven.
- **Stage 2A blocks 5 and 6** (pipeline view, transacted-price write-back on Won, lost-proposal handling, won/lost analysis, the CEO view, PowerPoint export, notifications) are not built.
- No UI yet for setting a route-level agent-cut override (the API exists).
- Test coverage is backend-focused: there are no automated browser/UI tests.

## Deploying (GitHub + Supabase + Vercel — no local machine needed)

Do these in order. Everything is done in web dashboards.

### 1. Put the code on GitHub
Upload the **contents** of this folder so that `package.json` sits at the top level of the repo (or, if you upload the folder itself, set Vercel's *Root Directory* to that folder in step 3). Hidden files matter: make sure `.gitignore` and `.env.example` are included. Never upload a real `.env` file.
> GitHub's browser uploader accepts about 100 files per drop, and this project has more than that, so upload in two or three batches (or use GitHub Desktop, which has no limit).

### 2. Set up Supabase (free tier is fine)
1. Create a project. In the **SQL editor**, paste and run each file **in this order**, one at a time, waiting for "Success" each time:
   1. `supabase/schema.sql`
   2. `supabase/policies.sql`
   3. `supabase/functions.sql`
   4. `supabase/migrations/002_stage2a_role_split.sql`
   5. `supabase/migrations/003_stage2a_block1_proposals.sql`
   6. `supabase/migrations/004_stage2a_block2.sql`
   7. `supabase/migrations/005_stage2a_block3.sql`
   8. `supabase/migrations/006_stage2a_block4_conflicts.sql`
   9. `supabase/seed_categories.sql` — loads the 12 inventory categories (this replaces the old `npm run load-categories` step)
2. **Authentication → Providers → Google**: enable it. It needs a Google OAuth client (Google Cloud Console → APIs & Services → Credentials → OAuth client ID, type *Web application*). Set its *Authorized redirect URI* to `https://<your-project-ref>.supabase.co/auth/v1/callback`, then paste the client ID and secret into Supabase. To restrict sign-in to your company, set the OAuth consent screen's user type to **Internal** (Google Workspace).
3. **Authentication → URL Configuration**: set *Site URL* to your Vercel URL (you get it in step 3), and add `https://<your-vercel-domain>/**` to *Redirect URLs*. If sign-in bounces you back to the login page or to a localhost URL, this is almost always why.
4. **Project Settings → API**: you'll copy the *Project URL*, the *anon* key and the *service_role* key into Vercel next.

### 3. Deploy on Vercel
Import the GitHub repo (the framework auto-detects as Next.js). Under **Environment Variables** add:

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Public. **Must be set before the first build** (baked in at build time). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key | Public. Same: needed at build time. |
| `SUPABASE_URL` | Project URL again | Server-only |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **Server-only secret. Never prefix with `NEXT_PUBLIC_`.** |
| `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` | e.g. `yourcompany.com` | Optional; login hint and a friendly check |
| `ANTHROPIC_API_KEY` | your key | Only for Capture. `ANTHROPIC_MODEL` is optional. |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | the whole JSON key, on one line | Only for Drive filing |
| `GOOGLE_SHARED_DRIVE_ID` | the Shared Drive's ID (from its URL) | Only for Drive filing |

Deploy. If you change an env var later, **redeploy**: Vercel doesn't apply changes to existing deployments.

### 4. First run: use the diagnostic
1. Open **`https://<your-app>/api/health`**. It lists every environment variable (true/false, never the value), whether each migration has been run, whether categories are loaded, and whether an organisation and profile exist. Anything false tells you which step above to redo.
2. Sign in with Google. You'll land on a **"signed in, but not set up yet"** screen with two ready-to-paste SQL snippets that already contain *your* user id. Run the first (it creates the organisation and makes you CEO), reload, and you're in. Everyone after you uses the second snippet with `'team'`, `'manager'` or `'ceo'`.
3. Re-open `/api/health`: `session` should now show your role. Add **`?deep=1`** to also test real read access to the Google Shared Drive.

### 5. Google Drive (optional — everything works without it)
Google Cloud Console → enable the **Drive API** → create a **service account** → create a JSON key. In Google Drive, open the Shared Drive → *Manage members* → add the service account's email as **Content Manager**. Put the JSON in `GOOGLE_SERVICE_ACCOUNT_KEY` and the drive ID in `GOOGLE_SHARED_DRIVE_ID`, redeploy, then check `/api/health?deep=1`. Without Drive, records and exports still work; exports just aren't filed, and the app tells you so.

### If something goes wrong
| You see | Most likely cause |
|---|---|
| Build fails on Vercel | Read the last red lines of the build log. Most often a missing `NEXT_PUBLIC_*` variable, or files missing from the upload (check every batch landed). |
| `/api/health` says a migration check is false | That SQL file wasn't run, or errored. Run it and re-check. Files must go in the order above. |
| Sign-in loops back to the login page | Supabase *Site URL* / *Redirect URLs* don't match your Vercel domain (step 2.3). |
| Signed in, but `/api/health` says `signedIn: false` | The server can't read your session cookie. Check the two `NEXT_PUBLIC_SUPABASE_*` values match your project, then redeploy. **This is the one flow that couldn't be tested before shipping (see below).** |
| "Signed in, but not set up yet" | Expected on first login. Run the SQL snippet shown. |
| Every action returns 403 | The user has no `profiles` row, or the wrong role. |
| Capture says the AI call failed | `ANTHROPIC_API_KEY` is missing or invalid. |
| Export works but "Not filed in Drive" | Drive isn't configured, or the service account isn't a member of the Shared Drive. See `/api/health?deep=1`. |
| A CSV import stops partway | It's sent in batches of 20 and the message says where it stopped. Re-running is safe: existing vendors/properties are matched by name. |

## Stage 2A progress

Blocks 1, 2, 3 and 4 of 6 are built.

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
