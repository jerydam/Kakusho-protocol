import React, { createContext, useContext, type ReactNode } from 'react';
import { useDeepLinkSession } from '../deeplink/useDeepLink';
import type { VerificationSession } from '../types';

interface SessionContextValue {
  session: VerificationSession | null;
  linkError: string | null;
  clearSession: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { session, linkError, setSession } = useDeepLinkSession();

  const value: SessionContextValue = {
    session,
    linkError,
    clearSession: () => setSession(null),
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
