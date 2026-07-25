"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { authApi, type Me, type MfaStatus } from "@/lib/api/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

/** Recovery codes exist only in this response — once dismissed they are gone. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  function copy() {
    void navigator.clipboard?.writeText(codes.join("\n"));
    toast.success("Recovery codes copied");
  }

  return (
    <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="text-sm font-semibold">Save your recovery codes</p>
      <p className="mt-1 text-xs text-muted">
        Each code signs you in once if you lose your authenticator. They are shown now
        and never again — store them somewhere safe before closing this.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-1.5 font-mono text-xs">
        {codes.map((code) => (
          <li key={code} className="rounded bg-background px-2 py-1">
            {code}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" onClick={copy}>
          Copy all
        </Button>
        <Button size="sm" onClick={onDone}>
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}

export function SecurityCard() {
  const [me, setMe] = useState<Me | null>(null);
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [secret, setSecret] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [profile, mfa] = await Promise.all([authApi.me(), authApi.mfaStatus()]);
    setMe(profile);
    setStatus(mfa);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resendVerification() {
    setBusy(true);
    const result = await authApi.requestEmailVerification();
    setBusy(false);
    toast[result.ok ? "success" : "error"](
      result.ok ? "Confirmation email sent" : "Couldn't send the email",
    );
  }

  async function startEnroll() {
    setBusy(true);
    const enrollment = await authApi.mfaEnroll();
    setBusy(false);
    if (!enrollment) {
      toast.error("Couldn't start MFA setup");
      return;
    }
    setSecret(enrollment.secret);
  }

  async function confirmEnroll() {
    setBusy(true);
    const issued = await authApi.mfaVerify(totp.trim());
    setBusy(false);
    if (!issued) {
      toast.error("That code wasn't accepted");
      return;
    }
    setSecret(null);
    setTotp("");
    setCodes(issued);
    await load();
  }

  async function regenerate() {
    setBusy(true);
    const issued = await authApi.regenerateRecoveryCodes();
    setBusy(false);
    if (!issued) {
      toast.error("Couldn't generate new codes");
      return;
    }
    setCodes(issued);
    await load();
  }

  if (loading) return <Skeleton className="h-32" />;

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <h2 className="text-base font-bold tracking-tight">Security</h2>
      <p className="text-sm text-muted">
        Email confirmation and two-factor authentication.
      </p>

      {/* Email verification */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{me?.email}</p>
          <p className="text-xs text-muted">
            {me?.email_verified
              ? "Confirmed — password resets and alerts can reach you."
              : "Unconfirmed. Confirm it now, or you won't be able to reset your password."}
          </p>
        </div>
        {me?.email_verified ? (
          <Badge variant="success">Verified</Badge>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={resendVerification}>
            Send confirmation
          </Button>
        )}
      </div>

      {/* MFA */}
      <div className="mt-3 border-t border-border pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Two-factor authentication</p>
            <p className="text-xs text-muted">
              {status?.mfa_enabled
                ? `On · ${status.unused_recovery_codes} recovery codes left`
                : "Off. Adds a one-time code from your authenticator app at sign-in."}
            </p>
          </div>
          {status?.mfa_enabled ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={regenerate}>
              New recovery codes
            </Button>
          ) : secret ? null : (
            <Button size="sm" disabled={busy} onClick={startEnroll}>
              Turn on
            </Button>
          )}
        </div>

        {secret && (
          <div className="mt-3 rounded-lg border border-border p-3">
            <p className="text-xs text-muted">
              Add this secret to your authenticator app, then enter the 6-digit code it
              shows to finish.
            </p>
            <code className="mt-2 block break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">
              {secret}
            </code>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="mfa-totp">Authenticator code</Label>
              <Input
                id="mfa-totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
              />
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={busy || !totp.trim()} onClick={confirmEnroll}>
                Confirm
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSecret(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}
      </div>
    </div>
  );
}
