import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { parseSessionFromUrl } from './parseSession';
import type { VerificationSession } from '../types';

interface UseDeepLinkSessionResult {
  session: VerificationSession | null;
  linkError: string | null;
  setSession: (session: VerificationSession | null) => void;
}

/**
 * Captures the verification session from whichever link opened the app —
 * handles both the cold-start case (app wasn't running, user tapped the
 * QR/link and the OS launched the app) and the warm-start case (app was
 * already open in the background).
 */
export function useDeepLinkSession(): UseDeepLinkSessionResult {
  const [session, setSession] = useState<VerificationSession | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    const handleUrl = (url: string | null) => {
      if (!url) return;

      const parsedSession = parseSessionFromUrl(url);
      if (parsedSession) {
        setSession(parsedSession);
        setLinkError(null);
      } else {
        setLinkError(
          'This link is missing required verification parameters. Please re-scan the QR code from your desktop.'
        );
      }
    };

    // Cold start: app launched directly via the link.
    Linking.getInitialURL()
      .then(handleUrl)
      .catch(() => {
        /* no initial URL — that's fine, user opened the app normally */
      });

    // Warm start: app was already open when the link was tapped.
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));

    return () => subscription.remove();
  }, []);

  return { session, linkError, setSession };
}
