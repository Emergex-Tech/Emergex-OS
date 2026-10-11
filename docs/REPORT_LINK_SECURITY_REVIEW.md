# Brand report links — security review pack (L21)

**Status: NOT YET REVIEWED.** `REPORT_LINKS_ENABLED` is unset by default. Until a named person has completed the checklist at the bottom and
signed it off, no link can be created and every public route answers like an unknown link. This document is the preparation for that
review; it is **not** the review. The PRD (6.21, L21) requires the review before the first external link.

## What is exposed, and to whom
A brand contact opens `https://<app>/r/<token>` with **no login**. The page fetches `/api/public/report/<token>` (JSON), optionally a proof file
(`.../proof/<id>`) and a PDF (`.../pdf`). The token is a 256-bit random value. Nothing else about the application is reachable by that
person: every other route requires a staff session, and an agent session is refused on all staff routes (access sweep, 132 routes).

## What a report may contain — and the control that enforces it
| Must never appear | Control | Test that proves it |
|---|---|---|
| Money of any kind (costs, margins, prices, invoices, balances, the invoice-adjustment flag) | The report is **constructed field by field** from an allow-list (`reportBuilder.ts`); a database row is never copied or spread | pure: "EXACTLY the allow-listed shape"; "NONE of the planted secrets"; e2e: key scan `/cost\|margin\|price\|amount\|invoice…/` over every key of the public response |
| Vendors / talent, delivery-side agents (D18) | Not in the allow-list **and** a fail-closed name check: if any such name (in full or by distinctive word) is readable anywhere in the report, nothing is served | pure: leak-check tests; e2e: link refused (409) while a name shows; public view returns 404 if one appears later; snapshot that held one is never shown |
| Internal notes, checklist, communication log, who recorded what, a metric's free-text source, proof notes | Not in the allow-list | planted-secret tests (e2e + PDF text) |
| Proof the team did not mean to share | `report_visible` defaults to **false**; ticked per proof; re-checked on every file request; archived/hidden = 404 | e2e: hidden / archived / link-kind / unknown / malformed proof all 404 with the identical body |
| Another project's data or files | Every query is scoped to the link's project; proof is matched to the link's deal | e2e: a ticked proof of a different project is unreachable through this link; a snapshot of another project is unreachable |

## The link itself
* **Token**: 32 random bytes, base64url (43 chars). Only its **SHA-256** is stored; the token is shown once at creation and is in no table, no audit row and no list response (tests assert this).
* **Lifetime**: 1–365 days (default 30), enforced by the application **and** a database check (≤ 366 days). An expiry or hash can never be edited (trigger) — a link can only be **revoked** (once, with a person; cannot be undone).
* **Revocation** takes effect on the very next request: the link is looked up on every request, never cached.
* **Indistinguishable failure**: unknown, malformed, oversized, injected, expired, revoked, switched off, forbidden-name-blocked and broken all return the **same** `404` body and headers. (e2e compares them byte for byte.)
* **View log**: every successful view (report, snapshot, proof, PDF) is logged **before** anything is served, append-only (trigger), with a **per-link hash** of the viewer address (the raw address is stored nowhere) and a truncated user-agent. If logging fails, nothing is served (fail closed) — **verified at unit level only**, not end to end.
* **Release switch**: `REPORT_LINKS_ENABLED=1`. Unsetting it disables every public route instantly (rollback = remove the variable, redeploy/restart).
* **Limits**: at most 20 active links per project.

## Browser-side hardening
`/r/*`: `Referrer-Policy: no-referrer` (the secret address is never sent to another site), `X-Robots-Tag: noindex, nofollow`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`. The public page loads **no third-party** scripts, fonts, images or analytics. Public JSON / files carry `default-src 'none'` and `Cross-Origin-Resource-Policy: same-origin`. Link-kind proof is opened only if it is `https` on `drive.google.com` / `docs.google.com` (checked when saved, when built and when rendered), with `rel="noopener noreferrer"`. Uploaded images are shown inline; **everything else is a forced download**, never rendered in our origin.

## The daily snapshot job
`GET /api/cron/report-snapshots`, authorised **only** by `Authorization: Bearer $CRON_SECRET` (constant-time compare). With no secret, a secret under 16 characters, or a wrong one: `401`. One automatic snapshot per project per day (unique index) so it is safe to run twice. Skips closed projects.

## Known limits and residual risks — read these
1. **Free text the team types** (a deliverable description, a proof file name) goes into the report. The name check catches *known* vendor and delivery-agent names; it cannot catch a secret it was not told about. The staff **"Preview — exactly what the brand sees"** is the human check; encourage using it before creating a link.
2. **A valid link is a bearer credential.** Anyone who has the URL can read the report until it expires or is revoked. There is no per-person login (that is Stage 4). Keep expiries short for sensitive reports.
3. **No rate limiting.** Tokens are 256-bit so guessing is infeasible, but a holder of a valid link can generate unlimited views (each logged). Vercel's platform protections apply; add application rate limiting if you expect abuse.
4. **Proof files are served through the server's Drive credentials.** Anything ticked "show to the brand" becomes readable by anyone with a valid link, regardless of the file's own Drive permissions.
5. **Fail-closed view logging** is covered by a unit test, not by an end-to-end test.
6. **PDFs** use built-in fonts: non-Latin text prints as "?". They list proof by name; they do not embed images.
7. The check that matters most is the **allow-list**. Any future change to `src/lib/reportBuilder.ts` is a security change and must be reviewed as one (the tests plant secrets in every forbidden field and will fail if one leaks).

## Reviewer checklist (to be completed by a named person before enabling)
- [ ] Read `src/lib/reportBuilder.ts` end to end; confirm every field it emits is something a brand may see.
- [ ] Create a link for a real project and open it in a private window; confirm the **staff preview** and the public page match, and nothing internal is visible (including in the browser's network tab, the PDF, and any proof file).
- [ ] Confirm `REPORT_LINKS_ENABLED` and `CRON_SECRET` are set only in the intended Vercel environment, and `CRON_SECRET` is 32+ random characters.
- [ ] Confirm an expired link, a revoked link and a made-up link look identical in the browser.
- [ ] Confirm the view log records your test views, and that the log shows no raw IP address.
- [ ] Confirm response headers on `/r/<token>` (no-store, no-referrer, noindex) in the browser dev tools.
- [ ] Decide whether limits 1–4 above are acceptable, or whether application rate limiting / shorter default expiry is required.
- [ ] Sign off: name ______________________  date ______________  (then set `REPORT_LINKS_ENABLED=1`).
