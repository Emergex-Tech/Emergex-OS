# Deploying everything at once — the checklist

Everything built since the last deployment, in the order to do it. Nothing here is optional unless it says so.

## 1. Database (Supabase → SQL Editor). Run each file once, in this order
Run only the ones you have not run before. If you are not sure, run `/api/health` first (step 5): every migration has a named check and a `false` tells you exactly which is missing.

| # | File | What it adds |
|---|---|---|
| 1 | `015_stage3_closure_casestudies.sql` | Closing a project, the delivery-record lock, renewal proposals, case studies |
| 2 | `016_stage3_reports.sql` | Brand reports: links, view log, snapshots, settings, which proof the brand sees |
| 3 | `017_delivery_log.sql` | The delivery log, "waived by the brand", social proof links, periods, the vendor guarantee, metric segments |
| 4 | `018_running_deals.sql` | Marks deals entered as already running |
| 5 | `019_revenue.sql` | Revenue plan, forecast weights, a contract's signing date |

Each is safe to run once. Running one twice will stop with an "already exists" error and change nothing.

## 2. Vercel → Settings → Environment Variables (Production)
**Required — the app cannot read or write data without these two** (your last health check showed them missing):
- `SUPABASE_URL` — the same value as `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Project Settings → API Keys → the `service_role` key. Tick **Sensitive**. Never give it a `NEXT_PUBLIC_` name.

**Needed for specific features:**
- `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_SHARED_DRIVE_ID` — uploading contract files and proof FILES. Without them those uploads are refused with a clear message; proof LINKS still work.
- `ANTHROPIC_API_KEY` — the AI capture screen.
- `CRON_SECRET` (32+ random characters) — daily report snapshots. Without it the daily job does nothing.

**Leave OFF until its review is done:**
- `REPORT_LINKS_ENABLED=1` — only after `docs/REPORT_LINK_SECURITY_REVIEW.md` is completed and signed.
- `AGENT_ACCESS_ENABLED=1` — only after the agent-portal review.

Also: **Settings → General → Node.js Version must be 20 or newer** (Next.js 16 requires it).

## 3. Code (GitHub) — upload in THIS order, committing each
1. **`…-database-tests-config.zip` FIRST** — unzip, select everything inside, drag it to the repository's **root**. It carries `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.js` and `vercel.json`; uploading the others first would build new code on the old Next.js.
2. Each `…-api-routes-…` and `…-pages-and-libs-…` zip — unzip, then drag **the `src` folder itself** (not what is inside it).
   **Before each commit, check the list GitHub shows: every path must start with `src/`.** If any starts with `app/`, `lib/` or `components/`, stop — that is what caused the 404 last time.
3. Afterwards the repository root must show **no** `app`, `lib` or `components` folder.

Builds triggered while files are half-uploaded may fail. Only the last one matters.

## 4. The build (Vercel → Deployments → the newest one → Build Logs)
It should say **`Next.js 16.4.6`**, "Compiled successfully", and list about 175 routes including `/dashboard`, `/revenue`, `/case-studies` and `/r/[token]`. If the route list is short, a stray folder is at the repository root (step 3).

## 5. Check it is alive
Open `/api/health` while signed in. `ready` must be `true` and every `migration 0xx` line `true`.

## 6. Click through (nothing below has ever been opened in a browser by its author)
Sign in → Dashboard → open a proposal → open a project and each of its tabs (Checklist, Deliverables, Metrics, Parties, Communication log, Brand report, Case study, Import tracker) → Projects → "Enter a deal that is already running" → Case studies → Revenue → CEO View → Notifications. For anything blank or broken, note the page and the message in the browser console.

## 7. If it goes wrong
Vercel → Deployments → the last working deployment → **Promote to Production**. That restores the previous code instantly. The database changes are additive and the previous code ignores them.
