# MAX by UIB

MAX is Universal Insurance Brokers' consumer lead app: a prospect enters
photographs their driver's license (MAX reads the name and details), then
their VIN, leaves a phone number and email, and the lead is
emailed to quotes@universalinsurancebroker.com (and stored in Supabase
when the `max_leads` table exists). Auto dealers can sign up as referral
partners from the same app. MAX reads the photos with Claude Haiku 4.5.

It is a web app (installable on phones from the browser) and the source
of the App Store / Google Play apps in `native/`: Capacitor projects that
bundle the same files and add the native camera, haptics, splash screen,
status bar and offline start (see `STORE-RELEASE.md`). `max.js` detects
the native shell at runtime, so one code base serves the site and both
store apps.

## Deploy the web app

1. Vercel ▸ Add New Project ▸ import this repository ▸ framework "Other",
   no build command ▸ Deploy. Add a custom domain if you have one.
2. Supabase (same project as the Binder Book) ▸ Edge Functions:
   - `claude` (reads the photos): paste `supabase/functions/claude/index.ts`
     and set secret `ANTHROPIC_API_KEY`. Already deployed if the Binder Book
     uses it.
   - `inquiry` (emails the lead): paste `supabase/functions/inquiry/index.ts`
     and set secret `RESEND_API_KEY` from https://resend.com (create the
     Resend account with the quotes@ mailbox; optional `INQUIRY_TO`,
     `INQUIRY_FROM`). Until it exists, the app falls back to the phone's
     mail app.
3. Optional: run `supabase-max-leads.sql` in Supabase ▸ SQL Editor to keep a
   copy of every lead in a table.

The privacy policy for the store listings is served at `/privacy`.

## Marketing partner accounts (login)

Dealer salespeople create an account in the app (full name, dealership,
address, phone, email, password) and must read and tick the **referral
partner disclaimer** (they act as marketing agents, client information is
kept secure and confidential, Gift Card Rewards never affect the client's
premium). They then log in with that email and password; every lead they
send is tagged "Referred by" with their name and dealership, both in the
email and in the `referrer` field of the lead record. Each sign-up still
emails the office as before, with the acknowledgement timestamp.

Accounts live in Supabase Auth (Authentication ▸ Users in the Supabase
dashboard, where you can also add, confirm or delete a salesperson). Two
settings to check once:

1. **Authentication ▸ URL Configuration**: set *Site URL* to the MAX
   address (`https://uibautorater.vercel.app`) and add it to *Redirect
   URLs*, so confirmation and password-reset links open the app.
2. **Authentication ▸ Providers ▸ Email**: *Confirm email* is on by
   default, so a new salesperson must tap the link in the confirmation
   email before the first login. Turn it off if you prefer instant access
   after sign-up (the app handles both).

Password resets use the **Forgot password?** link on the login screen; the
emailed link brings the salesperson back to the app to choose a new
password.

## Publish to the stores

See `STORE-RELEASE.md`.

## Files

| File | Purpose |
|---|---|
| `index.html`, `max.js` | the app (marketing partner login/sign-up, guided chat flow) |
| `manifest.webmanifest`, `sw.js`, `icons/`, `icon.png` | installable app shell |
| `privacy.html` | privacy policy |
| `supabase/functions/claude`, `supabase/functions/inquiry` | photo reading and lead email functions |
| `supabase-max-leads.sql` | optional leads table |
| `native/` | Capacitor Android + iOS projects (`npm run build` bundles the web app into them) |
| `vercel.json`, `.vercelignore` | hosting config |
| `rater.html`, `rater.js`, `RATER-SETUP.md` | the agent Auto Rater at `/rater` |

## The agent Auto Rater

The same site also serves the agents' multi-carrier **Auto Rater** at
`/rater` (sign-in required, same look and Supabase sync as the Binder Book).
Its setup guide is `RATER-SETUP.md`; its files are `rater.html`, `rater.js`,
`rater-sw.js`, `rater.webmanifest` and `supabase/functions/rate`.
