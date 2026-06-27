// Centralized runtime config.
//
// For a real production build, don't hardcode RELAYER_BASE_URL — wire this up
// with `react-native-config` (.env.development / .env.production) so the
// staging relayer and prod relayer never get crossed in a build.
//
//   npm install react-native-config
//   then replace the fallback string below with Config.RELAYER_BASE_URL
//
// Left as plain constants here so the scaffold runs out of the box.

export const CONFIG = {
  // Your FastAPI relayer base URL.
  RELAYER_BASE_URL: 'https://api.kakusho-protocol.com',

  // Adjust to match your actual relayer routes (see src/api/relayerClient.ts).
  NFC_SUBMIT_PATH: '/verify/nfc-submit',
  SESSION_STATUS_PATH: '/verify/session-status',

  // Must match the domain that hosts apple-app-site-association /
  // assetlinks.json (see well-known/) and the domain your desktop
  // verification page's QR code points at.
  UNIVERSAL_LINK_HOST: 'kakusho-protocol.vercel.app',
  UNIVERSAL_LINK_PATH_PREFIX: '/verify/mobile/',
};
