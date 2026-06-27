// session/widget.ts — the desktop-side half of the QR handoff flow.
//
// Usage (vanilla):
//   const widget = new KakushoVerifyWidget(document.getElementById('mount'), {
//     relayerUrl: 'https://relayer.kakusho.xyz',
//     apiKey: 'zkkyc_session_scoped_...',
//     onResult: (r) => console.log('verified?', r.verified),
//   });
//   widget.start();
//   // later: widget.stop() to cancel polling (e.g. on unmount)

import type {
  KakushoWidgetOptions,
  KakushoSessionCreateResponse,
  KakushoSessionStatusResponse,
  SessionStatus,
} from "./types";

export class KakushoSessionError extends Error {
  constructor(message: string, public readonly code: "create_failed" | "poll_failed" | "network_error") {
    super(message);
    this.name = "KakushoSessionError";
  }
}

const DEFAULT_POLL_INTERVAL_MS = 2000;

export class KakushoVerifyWidget {
  private readonly container: HTMLElement;
  private readonly options: KakushoWidgetOptions;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private session: KakushoSessionCreateResponse | null = null;
  private settled = false;
  private lastStatus: SessionStatus | null = null;

  constructor(container: HTMLElement, options: KakushoWidgetOptions) {
    this.container = container;
    this.options = options;
  }

  /** Creates a session, renders the QR code, and begins polling for completion. */
  async start(): Promise<void> {
    this.settled = false;
    this.renderLoading();

    let session: KakushoSessionCreateResponse;
    try {
      const res = await fetch(`${this.options.relayerUrl}/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": this.options.apiKey,
        },
        body: JSON.stringify({
          user_stellar_address: this.options.userStellarAddress ?? null,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new KakushoSessionError(
          (err.detail as string) ?? `Session creation failed: ${res.status}`,
          "create_failed"
        );
      }
      const body = (await res.json()) as {
        session_id: string;
        verify_url: string;
        expires_at: number;
      };
      session = {
        sessionId: body.session_id,
        verifyUrl: body.verify_url,
        expiresAt: body.expires_at,
      };
    } catch (e) {
      this.renderError(e instanceof Error ? e.message : "Could not start verification session.");
      throw e instanceof KakushoSessionError
        ? e
        : new KakushoSessionError("Network error while creating session.", "network_error");
    }

    this.session = session;
    this.options.onSessionCreated?.(session);
    this.renderQr(session);
    this.beginPolling(session);
  }

  /** Stops polling. Call this on component unmount to avoid leaking timers. */
  stop(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private beginPolling(session: KakushoSessionCreateResponse): void {
    const intervalMs = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    this.pollHandle = setInterval(async () => {
      if (this.settled) return;

      // Client-side expiry guard in addition to whatever the relayer enforces server-side.
      if (Date.now() / 1000 > session.expiresAt) {
        this.settle({ verified: false, failureReason: "expired" });
        this.renderExpired();
        return;
      }

      try {
        const res = await fetch(`${this.options.relayerUrl}/sessions/${session.sessionId}`, {
          headers: { "X-API-Key": this.options.apiKey },
        });
        if (!res.ok) return; // transient — keep polling, don't fail the whole flow on one bad poll

        const body = (await res.json()) as {
          status: SessionStatus;
          nullifier?: string;
          tx_hash?: string;
          failure_reason?: string;
        };

        const status: KakushoSessionStatusResponse = {
          status: body.status,
          ...(body.nullifier !== undefined ? { nullifier: body.nullifier } : {}),
          ...(body.tx_hash !== undefined ? { txHash: body.tx_hash } : {}),
          ...(body.failure_reason !== undefined ? { failureReason: body.failure_reason } : {}),
        };

        if (status.status === "scanned" && this.lastStatus !== "scanned") {
          this.options.onScanned?.();
          this.renderScanned();
        }
        this.lastStatus = status.status;

        if (status.status === "completed") {
          this.settle({
            verified: true,
            ...(status.nullifier !== undefined ? { nullifier: status.nullifier } : {}),
            ...(status.txHash !== undefined ? { txHash: status.txHash } : {}),
          });
          this.renderSuccess();
        } else if (status.status === "failed") {
          this.settle({ verified: false, failureReason: status.failureReason ?? "verification_failed" });
          this.renderFailure(status.failureReason);
        } else if (status.status === "expired") {
          this.settle({ verified: false, failureReason: "expired" });
          this.renderExpired();
        }
      } catch {
        // Network blip mid-poll — don't fail the session over one dropped request.
      }
    }, intervalMs);
  }

  private settle(result: { verified: boolean; nullifier?: string; txHash?: string; failureReason?: string }): void {
    if (this.settled) return;
    this.settled = true;
    this.stop();
    this.options.onResult(result);
  }

  // ── Minimal built-in rendering ─────────────────────────────────────────────
  // Integrators are expected to mostly replace this via their own UI bound to
  // the onSessionCreated/onScanned/onResult callbacks. These renderers exist
  // so the widget is still usable with zero custom styling.

  private renderLoading(): void {
    this.container.innerHTML = `<div data-kakusho-state="loading">Starting verification…</div>`;
  }

  private renderQr(session: KakushoSessionCreateResponse): void {
    const qrImgSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
      session.verifyUrl
    )}`;
    this.container.innerHTML = `
      <div data-kakusho-state="pending">
        <img src="${qrImgSrc}" width="240" height="240" alt="Scan with your phone to verify your identity" />
        <p>Scan with your phone to continue</p>
      </div>
    `;
  }

  private renderScanned(): void {
    const el = this.container.querySelector("p");
    if (el) el.textContent = "Scanned — continue on your phone";
  }

  private renderSuccess(): void {
    this.container.innerHTML = `<div data-kakusho-state="completed">Verified</div>`;
  }

  private renderFailure(reason?: string): void {
    this.container.innerHTML = `<div data-kakusho-state="failed">Verification failed${reason ? `: ${reason}` : ""}</div>`;
  }

  private renderExpired(): void {
    this.container.innerHTML = `<div data-kakusho-state="expired">Session expired — please try again</div>`;
  }

  private renderError(message: string): void {
    this.container.innerHTML = `<div data-kakusho-state="error">${message}</div>`;
  }
}