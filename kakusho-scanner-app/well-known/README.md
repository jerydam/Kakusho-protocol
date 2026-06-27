# Hosting these on kakusho-protocol.vercel.app

Both files need to be reachable, unauthenticated, over HTTPS, at the exact
paths below — this is what lets iOS/Android verify you actually own the
domain before turning the QR link into a direct app-open instead of a
browser hit.

- `https://kakusho-protocol.vercel.app/.well-known/apple-app-site-association`
- `https://kakusho-protocol.vercel.app/.well-known/assetlinks.json`

## Option A — static files (simplest)

In your Next.js app, drop both files into `public/.well-known/`:

```
public/.well-known/apple-app-site-association   <- no file extension
public/.well-known/assetlinks.json
```

Next.js serves anything under `public/` at the site root, so these will
resolve at the URLs above with no routing code needed. The only catch is
`apple-app-site-association` has no extension, so Next may serve it with a
generic content type — Apple tolerates this in practice (it doesn't
strictly enforce `Content-Type: application/json`), but if you want to be
precise, use Option B for that one file specifically.

## Option B — route handlers (precise content type)

```ts
// app/.well-known/apple-app-site-association/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    applinks: {
      apps: [],
      details: [
        {
          appID: 'TEAMID.com.kakusho.scanner',
          paths: ['/verify/mobile/*'],
        },
      ],
    },
  });
}
```

```ts
// app/.well-known/assetlinks.json/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.kakusho.scanner',
        sha256_cert_fingerprints: ['REPLACE:WITH:YOUR:CERT:FINGERPRINT'],
      },
    },
  ]);
}
```

## Filling in the placeholders

- **`TEAMID.com.kakusho.scanner`** — replace `TEAMID` with your Apple
  Developer Team ID (Apple Developer portal -> Membership), and
  `com.kakusho.scanner` with whatever bundle identifier you actually set
  in Xcode for the app target.
- **`com.kakusho.scanner`** (Android `package_name`) — must exactly match
  the `applicationId` in `android/app/build.gradle`.
- **SHA256 fingerprint** — get this from your release signing
  certificate, NOT your debug keystore, since the app users actually
  install (Play Store, internal distribution, etc.) is what App Links
  verification checks against:
  - If Play App Signing is enabled: Play Console -> your app -> Setup ->
    App integrity -> App signing key certificate -> SHA-256.
  - Otherwise: `keytool -list -v -keystore your-release.keystore` and copy
    the SHA256 line.

## Verifying it worked

- iOS: install the app on a device, open Notes, type/paste a
  `https://kakusho-protocol.vercel.app/verify/mobile/...` link, tap it —
  it should open your app directly, not Safari.
- Android: `adb shell pm get-app-links com.kakusho.scanner` after install
  should show the domain as `verified`. If it shows `legacy_failure` or
  similar, re-check the assetlinks.json content and fingerprint, then
  reinstall (Android caches verification results aggressively).
