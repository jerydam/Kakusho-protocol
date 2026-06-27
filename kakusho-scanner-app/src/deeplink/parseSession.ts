import { CONFIG } from '../config';
import type { VerificationSession } from '../types';

/**
 * Parses an incoming Universal Link (iOS) / App Link (Android) into a
 * VerificationSession.
 *
 * Expected shape (matches the QR your desktop verify page already renders):
 *
 *   https://kakusho-protocol.vercel.app/verify/mobile/{sessionId}
 *     ?integrator_id=...&callback_url=...&state=...
 *
 * Requires the `react-native-url-polyfill` package — React Native's JS
 * engine (Hermes) does not ship a global `URL` implementation by default.
 * Add `import 'react-native-url-polyfill/auto';` as the first line of
 * index.js.
 */
export function parseSessionFromUrl(url: string): VerificationSession | null {
  try {
    const parsed = new URL(url);

    if (parsed.host !== CONFIG.UNIVERSAL_LINK_HOST) return null;
    if (!parsed.pathname.startsWith(CONFIG.UNIVERSAL_LINK_PATH_PREFIX)) return null;

    const sessionId = parsed.pathname.slice(CONFIG.UNIVERSAL_LINK_PATH_PREFIX.length);
    const integratorId = parsed.searchParams.get('integrator_id');
    const callbackUrl = parsed.searchParams.get('callback_url');
    const state = parsed.searchParams.get('state');

    if (!sessionId || !integratorId || !callbackUrl || !state) {
      return null;
    }

    return {
      sessionId,
      integratorId,
      callbackUrl: decodeURIComponent(callbackUrl),
      state,
    };
  } catch {
    return null;
  }
}
