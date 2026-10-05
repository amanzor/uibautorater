# MAX by UIB

MAX is Universal Insurance Brokers' consumer lead app: a prospect enters
their name, phone and email, photographs their driver's license and VIN,
answers whether they are insured today, gives consent, and the lead is
emailed to quotes@universalinsurancebroker.com (and stored in Supabase
when the `max_leads` table exists). Auto dealers can sign up as referral
partners from the same app. MAX reads the photos with Claude Haiku 4.5.

It is a web app (installable on phones from the browser) and the source
of the App Store / Google Play apps in `native/`, which open the hosted
site so every web deploy updates the store apps.

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

## Publish to the stores

See `STORE-RELEASE.md`.

## Files

| File | Purpose |
|---|---|
| `index.html`, `max.js` | the app (guided chat flow + dealer sign-up) |
| `manifest.webmanifest`, `sw.js`, `icons/`, `icon.png` | installable app shell |
| `privacy.html` | privacy policy |
| `supabase/functions/claude`, `supabase/functions/inquiry` | photo reading and lead email functions |
| `supabase-max-leads.sql` | optional leads table |
| `native/` | Capacitor Android + iOS projects |
| `vercel.json`, `.vercelignore` | hosting config |
| `rater.html`, `rater.js`, `RATER-SETUP.md` | the agent Auto Rater at `/rater` |

## The agent Auto Rater

The same site also serves the agents' multi-carrier **Auto Rater** at
`/rater` (sign-in required, same look and Supabase sync as the Binder Book).
Its setup guide is `RATER-SETUP.md`; its files are `rater.html`, `rater.js`,
`rater-sw.js`, `rater.webmanifest` and `supabase/functions/rate`.
