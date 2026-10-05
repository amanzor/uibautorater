# MAX by UIB — publishing to the App Store and Google Play

MAX is the consumer lead app. In this repository it is the whole site (served at `/`).
Prospects photograph their driver's license (MAX reads it) and their VIN,
leave a phone number and email, and the
lead is emailed to quotes@universalinsurancebroker.com and logged to the
`max_leads` table. Auto dealers can sign up as referral partners from the
same app.

The store apps in `native/` are Capacitor apps with the web app **bundled
inside** them (not a wrapper that loads the website), plus native features
that Apple's guideline 4.2 "Minimum Functionality" looks for:

- the phone's own camera and photo picker (`@capacitor/camera`) for the
  license and VIN, orientation-corrected, nothing saved to the gallery;
- haptic feedback when a document is read and when the lead is sent;
- native splash screen and status bar, portrait lock, safe-area layout,
  Android back-button handling;
- opens offline (shows an offline notice; photos and sending need a
  connection);
- camera-permission texts in `Info.plist` and the Android manifest.

Because the app is bundled, a store build is needed when `index.html`,
`max.js` or `privacy.html` change (run `npm run build`, below, then
archive again). The website at the same repository keeps deploying on its
own and stays identical in behaviour.

## 0. Before anything else

1. Deploy the web app: connect this repository to Vercel (Add New Project ▸ import ▸ framework "Other" ▸ no build command). The store apps do not depend on this address (the app is bundled), but the privacy policy URL below does.
2. Deploy the two Supabase functions (sources under `supabase/functions/`) and secrets (see README):
   `claude` (already deployed, reads the photos) and `inquiry` with
   `RESEND_API_KEY` (sends the lead emails). Without `inquiry`, the app
   falls back to opening the phone's mail app.
3. Optional: run `supabase-max-leads.sql` in Supabase ▸ SQL Editor so every
   lead is also stored in a table.
4. Privacy policy URL for both stores: `https://uibautorater.vercel.app/privacy`.

5. **Demo account for the reviewers.** The app requires a dealer login, and
   both stores reject login-gated apps that come without test credentials.
   In Supabase ▸ Authentication ▸ Users ▸ *Add user* create e.g.
   `reviewer@universalinsurancebroker.com` with a password and tick
   *Auto confirm user*; enter that email and password in App Store Connect
   (App Review Information ▸ Sign-in required) and in Play Console (App
   content ▸ App access ▸ "All or some functionality is restricted").

## 1. One-time accounts

| Store | Account | Cost | Needs |
|---|---|---|---|
| Google Play | Play Console developer account | $25 once | Any computer with Android Studio |
| Apple App Store | Apple Developer Program | $99 / year | A Mac with Xcode |

Both stores verify the business. Use the agency's legal name and the
quotes@ mailbox for the accounts so notices reach the office.

## 2. Build the Android app (Google Play)

On a computer with [Android Studio](https://developer.android.com/studio) and Node.js:

```bash
cd native
npm install
npm run build               # copies the web app into native/www and syncs the plugins
npx cap open android        # opens the project in Android Studio
```

In Android Studio:

1. **Build ▸ Generate Signed Bundle / APK ▸ Android App Bundle.** Create a
   new keystore the first time and **back it up** (you cannot update the app
   without it). Keep the keystore out of git (it is ignored).
2. Build the release `.aab` (`android/app/release/app-release.aab`).
3. In Play Console: Create app ▸ "MAX by UIB" ▸ upload the bundle to
   **Production** (or Internal testing first), fill in the store listing
   (name, short/long description, screenshots from a phone, the 512×512 icon
   `icons/rater-512.png`, feature graphic 1024×500), the **Data safety** form
   (collects name, phone, email, photos/ID documents; used for app
   functionality; shared with service providers; not sold), the privacy
   policy URL, and content rating. Review usually takes 1–7 days.

App icon and splash: `npx @capacitor/assets generate --iconBackgroundColor '#0d1f3c' --splashBackgroundColor '#0d1f3c'`
with a 1024×1024 `native/assets/icon.png` (a copy of `icon.png` works) and
`native/assets/splash.png` regenerates all sizes for both platforms.

## 3. Build the iOS app (App Store)

On a Mac with Xcode 15 or newer (the project uses Swift Package Manager,
no CocoaPods needed):

```bash
cd native
npm install
npm run build               # copies the web app into native/www and syncs the plugins
npx cap open ios            # opens App.xcodeproj in Xcode
```

In Xcode:

1. Select the **App** target ▸ Signing & Capabilities ▸ your Apple team;
   bundle identifier `com.universalinsurancebrokers.max`.
2. The camera and photo-library usage texts are already in
   `ios/App/App/Info.plist`; edit the wording there if you like.
3. Product ▸ Archive ▸ Distribute App ▸ App Store Connect ▸ Upload.
4. In App Store Connect: create the app, add screenshots (6.7" and 6.1"
   iPhones), description, keywords, support URL, privacy policy URL, and the
   **App Privacy** answers (name, phone, email, photos, ID documents; linked
   to the user; used for app functionality). Submit for review (1–3 days).

**Apple review notes (paste into App Store Connect ▸ App Review
Information ▸ Notes).** Apple rejects apps that are only a repackaged
website (guideline 4.2). Say this plainly: "MAX by UIB is a native
Capacitor app for a licensed Florida insurance agency. It is bundled in the
app (not a web wrapper), uses the device camera through the native camera
API to capture a driver's license and VIN, provides haptic feedback and a
native splash/status bar, and works offline. It collects a quote request
that a licensed agent follows up by phone; no purchases are made in the
app. Dealer partners log in with the demo account provided." Give the
reviewer a test path: log in with the demo account, photograph any card and
any VIN plate, enter a phone and email, send. The lead reaches the quotes@
mailbox; reviewers' test leads can be ignored.

## 4. After launch

- The website updates on every deploy. The store apps carry their own copy
  of the screens, so after changing `index.html`, `max.js` or
  `privacy.html` run `npm run build` in `native/`, bump the version/build
  number in Android Studio and Xcode, and upload a new build.
- Leads arrive at quotes@universalinsurancebroker.com with the subject
  "New Lead (MAX app) – <name>" and dealer sign-ups as "New Dealer Sign-up –
  <name>". If the `max_leads` table exists they are stored there as well.
- Share the plain link `https://uibautorater.vercel.app` on social
  media and dealer counters too; it works as a web page and installs as a
  home-screen app without the stores.
