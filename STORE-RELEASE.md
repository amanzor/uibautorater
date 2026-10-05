# MAX by UIB — publishing to the App Store and Google Play

MAX is the consumer lead app. In this repository it is the whole site (served at `/`).
Prospects photograph their driver's license (MAX reads it) and their VIN,
leave a phone number and email, and the
lead is emailed to quotes@universalinsurancebroker.com and logged to the
`max_leads` table. Auto dealers can sign up as referral partners from the
same app.

The web app is the product. The store apps in `native/` are thin native
shells (Capacitor) that open the hosted web app, so every web deploy
updates the store apps instantly with no new store submission.

## 0. Before anything else

1. Deploy the web app: connect this repository to Vercel (Add New Project ▸ import ▸ framework "Other" ▸ no build command). The files assume the default address `https://uibautorater.vercel.app`; if Vercel gives you a different one (or you add your own domain) put it in `native/capacitor.config.json` as `server.url` and in `native/www/index.html`.
2. Deploy the two Supabase functions (sources under `supabase/functions/`) and secrets (see README):
   `claude` (already deployed, reads the photos) and `inquiry` with
   `RESEND_API_KEY` (sends the lead emails). Without `inquiry`, the app
   falls back to opening the phone's mail app.
3. Optional: run `supabase-max-leads.sql` in Supabase ▸ SQL Editor so every
   lead is also stored in a table.
4. Privacy policy URL for both stores: `https://uibautorater.vercel.app/privacy`.

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
npx cap sync android
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

On a Mac with Xcode and CocoaPods:

```bash
cd native
npm install
npx cap sync ios
npx cap open ios            # opens App.xcworkspace in Xcode
```

In Xcode:

1. Select the **App** target ▸ Signing & Capabilities ▸ your Apple team;
   bundle identifier `com.universalinsurancebrokers.max`.
2. Add the camera usage text in `ios/App/App/Info.plist`:
   `NSCameraUsageDescription` = "MAX uses the camera to photograph your
   driver's license and VIN for your quote." (and
   `NSPhotoLibraryUsageDescription` similarly).
3. Product ▸ Archive ▸ Distribute App ▸ App Store Connect ▸ Upload.
4. In App Store Connect: create the app, add screenshots (6.7" and 6.1"
   iPhones), description, keywords, support URL, privacy policy URL, and the
   **App Privacy** answers (name, phone, email, photos, ID documents; linked
   to the user; used for app functionality). Submit for review (1–3 days).

**Apple review note.** Apple rejects apps that are "just a website"
(guideline 4.2). MAX is a camera-driven lead form with a clear native
purpose, which normally passes, but to be safe mention in the review notes
that the app captures documents with the camera and that the agency is a
licensed Florida insurance agency. If Apple still asks for more native
behaviour, the next step is to add the Capacitor Camera plugin so photos are
taken through the native camera API; the web app already works unchanged.

## 4. After launch

- Updating the app's screens, wording or flow is a normal web deploy. Only
  changes to `native/` (icon, name, permissions, plugins) need a new store
  build.
- Leads arrive at quotes@universalinsurancebroker.com with the subject
  "New Lead (MAX app) – <name>" and dealer sign-ups as "New Dealer Sign-up –
  <name>". If the `max_leads` table exists they are stored there as well.
- Share the plain link `https://uibautorater.vercel.app` on social
  media and dealer counters too; it works as a web page and installs as a
  home-screen app without the stores.
