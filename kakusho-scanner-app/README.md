# Kakushō Scanner — NFC ePassport companion app

Native companion app that fills the gap your desktop verification flow
currently hits ("Scanner app not detected"): Web NFC can't perform the
BAC/PACE handshake or raw ISO 7816 APDU exchange an ePassport chip needs,
so this reads it natively and hands the result to your relayer instead.

**Honesty check on what this is:** this repo is the complete application
source (TypeScript, navigation, NFC integration layer, API client, native
config) and exact setup steps. It was written and reviewed outside of a
device/Xcode/Android Studio environment, so treat the first device build
as where you verify it, not as a step you can skip — there is no
substitute for tapping a real passport against a real phone.

## What's in here

```
App.tsx, index.js, app.json        – RN entry points
src/
  types/                            – shared TS types
  config.ts                         – relayer URL + universal link config
  deeplink/                         – parses the QR/link into a session
  context/SessionContext.tsx        – exposes the session app-wide
  native/passportReader.ts          – adapter over the NFC library (swap libs here only)
  api/relayerClient.ts              – talks to your FastAPI relayer
  utils/mrz.ts                      – MRZ field validation
  screens/                          – MrzEntry -> NfcScan -> Result
  navigation/                       – stack navigator + route types
native-setup/
  ios/                              – Info.plist + entitlements additions
  android/                          – AndroidManifest additions + gradle notes
  dependencies-to-add.json          – exact npm packages to add
well-known/                         – files to host on kakusho-protocol.vercel.app
```

## Setup, start to finish

### 1. Prerequisites

- Node 18+, Xcode (latest), Android Studio + SDK, CocoaPods, JDK 17
- Apple Developer account (needed for the NFC entitlement + Universal
  Links — both require a paid account, not a free personal team)
- A physical iPhone and a physical Android device with NFC, plus an
  ICAO-compliant passport/eID to test against — there is no emulator
  path for any of this

### 2. Scaffold the base RN project

```bash
npx react-native init KakushoScanner --template react-native-template-typescript
cd KakushoScanner
```

### 3. Drop in this scaffold's source

Copy `App.tsx`, `index.js`, `app.json`, and the entire `src/` directory
from this package into the generated project, overwriting the
placeholders react-native init created.

### 4. Install dependencies

```bash
npm install @react-navigation/native @react-navigation/native-stack react-native-screens react-native-safe-area-context react-native-url-polyfill axios react-native-nfc-passport-info
cd ios && pod install && cd ..
```

(See `native-setup/dependencies-to-add.json` if you want the exact list
without the explanation.)

### 5. iOS native config

- Open `ios/KakushoScanner.xcworkspace` in Xcode.
- Target -> Signing & Capabilities -> **+ Capability** -> add
  **Near Field Communication Tag Reading** and **Associated Domains**.
  Under Associated Domains, add `applinks:kakusho-protocol.vercel.app`.
  Xcode will write/update `ios/KakushoScanner/KakushoScanner.entitlements`
  for you — compare against `native-setup/ios/KakushoScanner.entitlements`
  to confirm it matches.
- Merge the keys in `native-setup/ios/Info.plist.additions.xml` into
  `ios/KakushoScanner/Info.plist`.
- Set your real bundle identifier (used in the `appID` of
  `apple-app-site-association` later) under target -> General.

### 6. Android native config

- Merge `native-setup/android/AndroidManifest.xml.additions.xml` into
  `android/app/src/main/AndroidManifest.xml` (permission/feature as
  siblings of `<application>`, the intent-filter inside your main
  activity).
- Read `native-setup/android/build.gradle.notes.md` — covers
  `minSdkVersion`, JMRTD/SpongyCastle dependency conflicts, and ProGuard
  keep rules before your first release build.
- Confirm `applicationId` in `android/app/build.gradle` — this is your
  Android package name, needed in `assetlinks.json`.

### 7. Deploy the domain verification files

Follow `well-known/README.md` to host `apple-app-site-association` and
`assetlinks.json` on `kakusho-protocol.vercel.app`, with your real Team
ID, bundle ID, package name, and release cert SHA-256 fingerprint filled
in. Without this step the QR/link will open a browser instead of the app.

### 8. Point the app at your relayer

Edit `src/config.ts` — at minimum `RELAYER_BASE_URL`. For a real release
build, switch this to `react-native-config` (`.env.production` /
`.env.development`) so a staging build can never accidentally point at
production, or vice versa.

Then open `src/api/relayerClient.ts` and adjust `NFC_SUBMIT_PATH`,
`SESSION_STATUS_PATH`, and the payload field names in
`SubmitNfcProofPayload` to match your actual FastAPI request models —
the names here are a reasonable guess at the shape, not a confirmed
contract with your backend.

### 9. Passive authentication master list

`react-native-nfc-passport-info` (and the libraries it's built on)
support Passive Authentication — verifying the chip's SOD signature
against a CSCA certificate chain, which is what actually catches a
cloned or tampered chip rather than just an unlocked one. This needs a
master list of CSCA certs in PEM format. Get one from either:

- A country that publishes its own master list, or
- The ICAO Public Key Directory (PKD)

Wire the resulting PEM file in per the library's own setup docs — check
its README/example app for exactly where it expects the file, since this
detail varies between forks and may have changed since this was written.

### 10. Run it on a physical device

```bash
npx react-native run-ios --device       # NFC needs a real device, not the simulator
npx react-native run-android            # plug in a physical Android phone with NFC on
```

### 11. Manual QA checklist before shipping

- [ ] Tapping the QR/link on the desktop verify page opens the app
      directly on both a fresh-install iPhone and Android device (tests
      the universal link / app link setup end to end)
- [ ] A genuine, in-date passport reads successfully on both platforms
- [ ] Wrong MRZ details (typo'd document number) fails BAC with a
      message the user can act on, not a raw native error
- [ ] Pulling the passport away mid-read is handled without a crash
- [ ] A release (not debug) Android build still reads a passport — this
      is where ProGuard/R8 stripping issues with JMRTD show up
- [ ] Passive authentication actually reports `true` against a real
      passport with your master list installed, not just `undefined`
      silently treated as success
