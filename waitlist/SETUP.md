# Persat Finance setup

This file is written for a first-time Supabase, GitHub, and Netlify user. Follow the steps in order. Do not commit any access token, database password, service-role key, or other credential.

## 0. What is already in this repository

- `index.html` — the rebuilt landing page and client-side waitlist form.
- `assets/persatlogo.png` — the supplied Persat logo used by the public site and admin console.
- `admin/index.html` — the authenticated dashboard with charts, filters, latest-signup table, and Realtime updates.
- `admin/config.js` — browser-safe Supabase URL and anon/publishable-key placeholders for the admin console.
- `supabase/schema.sql` — the waitlist table, INSERT-only public policy, admin allowlist policies, Realtime publication, and data-free keep-alive RPC.
- `supabase/functions/waitlist/index.ts` — the public server-side validation and duplicate-safe insert function.
- `supabase/config.toml` — Edge Function deployment configuration.
- `netlify.toml` — static hosting configuration and `/api/waitlist` proxy. It contains a project-reference placeholder that must be replaced.
- `.github/workflows/keep-alive.yml` — the scheduled Supabase activity request.

No paid service, email provider, or service-role key is required by this implementation. The read-only custom admin console is included for realtime monitoring; Supabase Studio remains the source for full table management and CSV export.

## 1. Accounts and credentials needed

Create or use these accounts:

1. **Supabase** — one Free project for Postgres and the Edge Function.
2. **GitHub** — a repository for this directory and the keep-alive workflow.
3. **Netlify** — one Free site connected to the GitHub repository.
4. **A domain registrar** — optional, only if a custom domain is already owned.

Credentials and values used:

| Value | Where it comes from | Where it is used |
| --- | --- | --- |
| Supabase project URL, e.g. `https://PROJECT_REF.supabase.co` | Supabase Dashboard → Project Settings → API | GitHub Actions secret `SUPABASE_URL`; Edge Function runtime; identify the project reference |
| Supabase `anon` / publishable key | Supabase Dashboard → Project Settings → API | GitHub Actions secret `SUPABASE_ANON_KEY`; Edge Function runtime. This key is designed for public clients and is restricted by RLS. |
| Supabase CLI access token | Supabase Dashboard → Account → Access Tokens | Only in the local `supabase login` command. Never commit it. |
| Supabase project reference | The first hostname segment in the project URL | Replace `YOUR_PROJECT_REF` in `supabase/config.toml` and `netlify.toml` |
| GitHub repository secrets | GitHub repository → Settings → Secrets and variables → Actions | The keep-alive workflow only |
| Netlify account login | Netlify signup/login | Connect the repository and deploy. No application secret is required by the static frontend. |

There is intentionally no `SUPABASE_SERVICE_ROLE_KEY` in the frontend, workflow, or repository. The public anon key plus the table's INSERT-only RLS policy is enough for this waitlist.

## 2. Create the Supabase Free project

1. Go to [Supabase](https://supabase.com/) and create an account or sign in.
2. Choose **New project**.
3. Select the **Free** plan.
4. Choose a project name such as `persat-finance-waitlist` and a strong database password. Keep the database password in a password manager; this setup does not require pasting it into the repository.
5. Wait for the project to finish provisioning.
6. Open **Project Settings → API**. Copy the **Project URL**, the **anon/publishable key**, and the project reference (the first part of the hostname).

### Important current-plan note

The live [Supabase pricing page](https://supabase.com/pricing), checked 2026-08-16, lists Free at $0/month with unlimited API requests, 50,000 MAUs, 500 MB database size, 5 GB egress, 5 GB cached egress, 1 GB file storage, and a limit of 2 active projects. It says Free projects can pause after 1 week of inactivity. The pricing page does not explicitly state “no credit card required” or “forever,” although it lists a $0/month Free plan and no time-boxed trial. If Supabase's current signup flow asks for a payment method, do not continue: that would not satisfy the no-card requirement.

## 3. Create the table and RLS policy

1. In the Supabase dashboard, open **SQL Editor**.
2. Create a new query.
3. Copy the entire contents of `supabase/schema.sql` into the query.
4. Click **Run**.
5. Open **Table Editor** and confirm `public.waitlist_signups` exists with:
   - `id` uuid primary key with an automatic default.
   - `full_name` text not null.
   - `email` text not null and unique.
   - `role_type` text not null.
   - `region` text nullable.
   - `referral_source` text nullable.
   - `created_at` timestamp with a `now()` default.
6. Open the table's **Policies** view and confirm the public policy is INSERT only. There should be no public SELECT, UPDATE, or DELETE policy.

The `keep_alive()` function returns only `{ "ok": true }`; it does not select from the waitlist table.

## 4. Deploy the Supabase Edge Function

Install the Supabase CLI if it is not already available. The commands below use `npx`, so a global install is not required.

1. In a terminal, change into the repository root (the directory containing `index.html`).
2. Replace `YOUR_PROJECT_REF` in `supabase/config.toml` with the real project reference.
3. Log the CLI in:

   ```bash
   npx supabase login
   ```

   When prompted, create a temporary CLI access token at **Supabase Dashboard → Account → Access Tokens**. This token is for the local CLI only; do not put it in GitHub or a source file.

4. Link the local folder to the project:

   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   ```

5. Set the standard runtime values for the function. Paste the values from Project Settings → API in your shell, not in a committed file:

   ```bash
   npx supabase secrets set \
     SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co" \
     SUPABASE_ANON_KEY="PASTE_YOUR_ANON_KEY_HERE"
   ```

6. Deploy the public waitlist function. JWT verification is disabled because the landing page is intentionally public; the function performs its own validation and the database still enforces RLS:

   ```bash
   npx supabase functions deploy waitlist --no-verify-jwt
   ```

7. Check **Edge Functions** in the Supabase dashboard and confirm `waitlist` is deployed.

The function behavior is:

- Empty name, invalid email, invalid role, or invalid option values are rejected server-side.
- A non-empty `website` honeypot is returned as a normal success-shaped response and is not inserted.
- New emails insert one row.
- A unique-email conflict returns success with a duplicate marker, so the browser can show “You're already on the list — we've got you.”
- Other database or server failures return a generic error, without exposing database details.

## 5. Point the Netlify proxy at the function

1. Open `netlify.toml`.
2. Replace the `YOUR_PROJECT_REF` placeholder in the `to =` URL (and the comment if desired):

   ```toml
   to = "https://YOUR_PROJECT_REF.supabase.co/functions/v1/waitlist"
   ```

   For example, if the project URL is `https://abc123.supabase.co`, the final value is:

   ```toml
   to = "https://abc123.supabase.co/functions/v1/waitlist"
   ```

3. Commit this change. The browser still calls `/api/waitlist` on the same origin; Netlify proxies it to the Supabase function.

## 6. Create the GitHub repository and secret values

1. Create a new GitHub repository. A public repository keeps standard GitHub-hosted Actions usage free. A private personal GitHub Free repository currently includes 2,000 Actions minutes per month; this daily two-minute job uses very little of that allowance.
2. Push the repository contents, including `.github/workflows/keep-alive.yml`.
3. In the repository, open **Settings → Secrets and variables → Actions**.
4. Click **New repository secret** and create:
   - `SUPABASE_URL` = the full project URL, such as `https://abc123.supabase.co`.
   - `SUPABASE_ANON_KEY` = the Supabase anon/publishable key.
5. Open **Actions**, select **Supabase keep-alive**, and use **Run workflow** once to verify it.
6. Confirm the run prints `Supabase keep-alive succeeded.`

The workflow calls `GET /rest/v1/rpc/keep_alive` with both the `apikey` and `Authorization` headers. No secret is hardcoded. It is scheduled daily because Supabase's current pausing guide says a few database requests each day typically keep a low-activity Free project active; a single weekly request is not guaranteed to be enough.

## 7. Deploy the frontend to Netlify Free

1. Create or sign in to [Netlify](https://app.netlify.com/).
2. Choose **Add new project → Import an existing project**.
3. Connect GitHub and choose this repository.
4. Keep the **Free** plan.
5. The committed `netlify.toml` supplies the publish directory and proxy. If Netlify asks for overrides, use:
   - Build command: leave blank.
   - Publish directory: `.`
6. Deploy the site.
7. Open the generated Netlify URL and scroll to the waitlist form.

Netlify's current [Free pricing](https://www.netlify.com/pricing/) is $0 forever with a 300-credit monthly hard limit. Production deploys use 15 credits, compute uses 10 credits per GB-hour, bandwidth uses 20 credits per GB, and web requests use 2 credits per 10,000 requests. If the Free credit balance is exhausted, projects pause until the next cycle rather than creating a surprise charge. The site does not use Netlify Functions or Netlify Database; the form's dynamic operation runs in Supabase.

### Optional custom domain

If a domain is already owned, open the Netlify site → **Domain management → Add a domain** and follow the DNS instructions Netlify shows for that domain. Netlify supplies HTTPS. No rebuild is required; the same static site and `/api/waitlist` path continue to work. If no domain is owned, the generated Netlify subdomain works without any additional account or payment.

## 8. Create and use the admin dashboard

The admin console is available at `/admin/` after deployment. It uses Supabase Auth email/password sessions, the browser-safe anon/publishable key, the `public.admin_users` allowlist, RLS, and Supabase Realtime. There is no public admin registration form.

### Create the first administrator

1. In Supabase Dashboard, open **Authentication → Providers** and make sure the **Email** provider is enabled.
2. Open **Authentication → Users → Add user**.
3. Create the administrator's email and password. Use **Auto Confirm User** if the dashboard offers that option; otherwise confirm the email before logging in.
4. Copy the user's UUID from the Users table.
5. In **SQL Editor**, run this query after replacing the email with the exact administrator email:

   ```sql
   insert into public.admin_users (user_id)
   select id
   from auth.users
   where lower(email) = lower('YOUR_ADMIN_EMAIL@example.com')
   on conflict (user_id) do nothing;
   ```

6. Confirm that the query inserted one row into `public.admin_users`.

To add another administrator, create another Auth user and repeat the allowlist insert. To revoke admin access without deleting the Auth account, delete that user's row from `public.admin_users`:

```sql
delete from public.admin_users
where user_id = 'USER_UUID_HERE';
```

### Configure the browser client

1. Open `admin/config.js`.
2. Replace the two placeholders:

   ```js
   window.PERSAT_SUPABASE_CONFIG = {
     url: "https://YOUR_PROJECT_REF.supabase.co",
     anonKey: "YOUR_SUPABASE_ANON_KEY"
   };
   ```

3. Use the Supabase Project URL and anon/publishable key from **Project Settings → API**. The anon/publishable key is intended for browser use when RLS is enabled. **Never paste a service-role or secret key into this file.**
4. Commit and deploy the change.

### Open the dashboard

1. Visit `https://YOUR_NETLIFY_SITE/admin/`.
2. Log in with the Auth user created above.
3. The dashboard loads all waitlist rows in 1,000-row pages, up to the planned 10,000-signup capacity.
4. It displays total signups, today, rolling seven-day activity, latest contact, a 14-day signup timeline, role distribution, geography, referral sources, and a searchable/filterable latest-signups table.
5. Keep the page open to receive new INSERT notifications through Supabase Realtime. The status badge changes to `Realtime_Live` when the subscription is connected; use `Refresh_Data` for a manual reload.

The updated `supabase/schema.sql` adds the Realtime publication and policies. If the database was created from an older copy of the schema, rerun the updated file or run its admin/Realtime section in SQL Editor. In Supabase Dashboard, confirm `waitlist_signups` is enabled for Realtime under the database replication settings if INSERT notifications do not arrive.

The custom dashboard is read-only. For complete table search, filtering, and CSV export, use Supabase Studio → **Table Editor → `public.waitlist_signups`**. Public visitors and authenticated users who are not allowlisted cannot read signup rows.

## 9. Replace the X placeholder when confirmed

The repository intentionally uses `[X_HANDLE]` and does not invent a handle. When the handle is confirmed, replace the placeholder in `index.html` in both X links:

- The success-state link.
- The footer X link.

Replace both the visible text and the `https://x.com/[X_HANDLE]` URL. No other copy needs to change.

## 10. Verification checklist

Run these tests against the deployed Netlify URL after the Edge Function and proxy are deployed:

- [ ] Submit with all required fields valid and a new email. Confirm the success state and one new row in Supabase Table Editor.
- [ ] Submit the exact same email again. Confirm the success state says “You're already on the list — we've got you.” Confirm there is still only one row.
- [ ] Submit with an empty name. Confirm an inline error appears below Full Name; no browser alert appears.
- [ ] Submit with an invalid email such as `not-an-email`. Confirm an inline error appears below Email Address.
- [ ] Submit without choosing a role. Confirm an inline error appears below I am a...
- [ ] Fill the off-screen `website` field through browser developer tools, then submit a unique test email. Confirm the browser gets the normal success-shaped state but no row is created in Supabase. The response must not tell the sender it was classified as spam.
- [ ] Use **Actions → Supabase keep-alive → Run workflow** and confirm a 200 response.
- [ ] Attempt a public `GET` against the waitlist table REST endpoint. Confirm it is denied; do not add a SELECT policy just to make a health check work.
- [ ] Search the deployed copy and repository for the old brand or prohibited geographic/currency references before launch.

## 11. Viewing and exporting signups

Use Supabase's own dashboard for full table management and export:

1. Supabase Dashboard → **Table Editor** → `public.waitlist_signups`.
2. Search or filter directly in the table viewer.
3. Use the viewer's export control for a CSV download.

Only the project owner/admin should use the dashboard. The public page has no read path for signup data.
