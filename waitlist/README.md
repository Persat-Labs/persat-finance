# Persat Finance waitlist

**Voice:** see `docs/POSITIONING.md` — vision = trust-minimized P2P lending infrastructure; pilot = Bitcoin first collateral.

A single-file, amber sci-fi landing page for Persat Finance. The original page's visual system is kept in `index.html`: the same Tailwind utility classes, fonts, colors, spacing, component patterns, WebGL background, SVG beams, GSAP boot sequence, glow cards, and reveal animations remain in place. Only the copy and the waitlist form were replaced.

## Architecture

- **Frontend:** the static `index.html`, hosted on Netlify Free, using `assets/persatlogo.png` as the logo.
- **Typography:** five self-hosted display faces under `assets/fonts/` form a responsive Persat type system: Sogea for technology headlines, Cuaniex for finance section titles, Rigter for product panels, Detra for compact UI labels, and Gafter for the wordmark and financial figures. The same system is used by `/admin/`, with mobile-specific sizing and iOS-safe 16px form controls. Original font notices are retained under `assets/fonts/licenses/`; commercial/webfont usage rights must be maintained by the site owner.
- **API:** a Supabase Edge Function at `supabase/functions/waitlist/index.ts`.
- **Database:** Supabase Postgres table `public.waitlist_signups`, created by `supabase/schema.sql`.
- **Admin console:** `/admin/`, protected by Supabase Auth email/password login plus the `public.admin_users` allowlist. It includes live signup metrics, charts, filters, a latest-signups table, and Supabase Realtime INSERT updates.
- **Keep-alive:** `.github/workflows/keep-alive.yml` makes an authenticated, data-free GET request to the `keep_alive` RPC every day. It does not read signup rows.
- **Email:** no email service is included. The form stores signups only and displays the requested success state.

See [`SETUP.md`](SETUP.md) for the complete first-time setup order, all credentials, deployment steps, and verification checklist.

## Supabase table viewer

The custom `/admin/` console is for realtime monitoring. For complete table management and CSV export, use Supabase's built-in dashboard:

1. Open the project in Supabase Studio.
2. Open **Table Editor** and select `public.waitlist_signups`.
3. Use the dashboard's search and filters as needed.
4. Use the table viewer's export control to download a CSV.

The public API has INSERT permission only. It has no public SELECT, UPDATE, or DELETE permission. Authenticated users can read waitlist rows only when their UUID is present in `public.admin_users`; the Edge Function never exposes rows.

## Current free-tier verification

Checked against the live provider documentation on **2026-08-16** (America/Los_Angeles).

### Supabase Free

The current [Supabase pricing page](https://supabase.com/pricing) lists Free at **$0/month** with:

- Unlimited API requests.
- 50,000 monthly active users.
- 500 MB database size with shared CPU and 500 MB RAM.
- 5 GB egress and 5 GB cached egress.
- 1 GB file storage.
- Community support.
- A limit of 2 active projects.
- Free projects paused after 1 week of inactivity.

The current [Edge Function usage documentation](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations) lists **500,000 Edge Function invocations** in the Free quota. The pricing page also lists **2 million Realtime messages** and **200 peak Realtime connections** on Free; this dashboard's single-admin monitoring stream is far below those limits. Ten thousand small text rows are comfortably below the 500 MB database limit; actual capacity should still be monitored in the dashboard.

**Difference from the prompt:** the live pricing page now says “after 1 week of inactivity” and lists the additional egress, cached-egress, storage, active-project, and Edge Function limits above. That is consistent with the prompt's 7-day pause statement. The live pricing page does **not** explicitly promise “no credit card required” or use the word “forever”; the Free plan is listed at $0/month and no time-boxed trial is described. The setup must be stopped if the account onboarding asks for a payment method, because this build intentionally uses no paid Supabase feature.

The [current pausing guide](https://supabase.com/docs/guides/platform/free-project-pausing) says a few database requests each day typically keep a low-activity project from being paused. That is why the workflow runs daily instead of relying on a single weekly ping.

### Netlify Free

Netlify is used instead of Vercel because the current [Vercel Hobby documentation](https://vercel.com/docs/plans/hobby) restricts Hobby to non-commercial, personal use. Netlify's current [pricing page](https://www.netlify.com/pricing/) lists Free at **$0 forever** with a **300-credit monthly hard limit**, global CDN, custom domains with SSL, unlimited deploy previews, and Functions. The current [credit documentation](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/) lists:

- Production deploys: 15 credits each.
- Compute: 10 credits per GB-hour.
- Bandwidth: 20 credits per GB.
- Web requests: 2 credits per 10,000 requests.
- Deploy previews and branch deploys: 0 credits.
- When the Free credit balance is exhausted, the web projects pause until the next cycle; there are no free-plan add-on credits.

This site does not use Netlify Functions or Netlify Database; the only dynamic request is proxied to Supabase. The [Netlify Free-plan announcement](https://www.netlify.com/blog/introducing-netlify-free-plan/) states that the plan is commercial-use eligible and requires no credit card. The Netlify 300-credit hard limit is the hosting constraint to monitor; it is not a recurring charge or a time-boxed trial.

### GitHub Actions

The keep-alive workflow is free on public repositories using standard GitHub-hosted runners. For a private repository, the current [GitHub Actions billing documentation](https://docs.github.com/en/billing/concepts/product-billing/github-actions) says usage is covered by the account's plan allowance; GitHub Free personal accounts currently list 2,000 Actions minutes per month. This job has a two-minute timeout and runs once per day, so it uses only a very small fraction of that allowance.

## Local preview

From this directory:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

The form's `/api/waitlist` rewrite is supplied by Netlify, so a local static server can preview the design but cannot submit until the site is deployed to Netlify or the form endpoint is temporarily pointed directly at the deployed Supabase Function. The admin console also requires the real values in `admin/config.js` and a deployed Supabase Auth/RLS setup.
