"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  useDisconnectEmail,
  useDisconnectSms,
  useEmailOAuthStart,
  useEmailSync,
  useRotateSmsToken,
  useSplitwiseOAuthStart,
  useSplitwiseSync,
  useSplitwiseBalances,
  useDisconnectSplitwise,
  netBalance,
  type SmsToken,
  type SplitwiseBalanceRow,
} from "@/lib/api/connections";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConnectionShell } from "./connection-shell";
import { PlaidCard } from "./plaid-card";

export default function ConnectionsPage() {
  useEffect(() => {
    const provider = new URLSearchParams(window.location.search).get("connected");
    if (provider) {
      toast.success(`${provider === "gmail" ? "Gmail" : "Splitwise"} connected`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <PlaidCard />
        <EmailCard />
        <SmsCard />
        <SplitwiseCard />
        <BotCard />
      </div>
    </div>
  );
}

function EmailCard() {
  const start = useEmailOAuthStart();
  const sync = useEmailSync();
  const disconnect = useDisconnectEmail();

  async function connect() {
    const popup = window.open("", "_blank");
    try {
      const res = await start.mutateAsync();
      if (popup) {
        popup.opener = null;
        popup.location.href = res.authorization_url;
      } else {
        window.location.assign(res.authorization_url);
      }
      toast.success("Opening Google authorization…");
    } catch {
      popup?.close();
      toast.error("Gmail isn't configured in this environment");
    }
  }

  async function runSync() {
    try {
      const res = await sync.mutateAsync();
      toast.success(`Imported ${res.documents_created} document(s)`);
    } catch {
      toast.error("Couldn't sync Gmail");
    }
  }

  async function remove() {
    try {
      await disconnect.mutateAsync();
      toast.success("Gmail disconnected");
    } catch {
      toast.error("Couldn't disconnect Gmail");
    }
  }

  return (
    <ConnectionShell
      title="Email (Gmail)"
      description="Forward receipts & statements from your inbox."
      footer={
        <>
          <Button onClick={connect} disabled={start.isPending}>
            {start.isPending ? "Starting…" : "Connect Gmail"}
          </Button>
          <Button variant="outline" onClick={runSync} disabled={sync.isPending}>
            {sync.isPending ? "Syncing…" : "Sync now"}
          </Button>
          <Button variant="ghost" onClick={remove} disabled={disconnect.isPending}>
            Disconnect
          </Button>
        </>
      }
    >
      <p className="text-muted">
        Connect opens Google&apos;s consent screen in a new tab; Sync pulls recent receipts.
      </p>
    </ConnectionShell>
  );
}

function SplitwiseCard() {
  const start = useSplitwiseOAuthStart();
  const sync = useSplitwiseSync();
  const disconnect = useDisconnectSplitwise();
  const balances = useSplitwiseBalances();
  const qc = useQueryClient();
  const balanceRows = (balances.data?.balances ?? []) as unknown as SplitwiseBalanceRow[];
  const net = netBalance(balanceRows);

  async function connect() {
    const popup = window.open("", "_blank");
    try {
      const res = await start.mutateAsync();
      if (popup) {
        popup.opener = null;
        popup.location.href = res.authorization_url;
      } else {
        window.location.assign(res.authorization_url);
      }
      toast.success("Opening Splitwise authorization…");
    } catch {
      popup?.close();
      toast.error("Splitwise isn't configured in this environment");
    }
  }

  async function runSync() {
    try {
      const res = await sync.mutateAsync();
      qc.invalidateQueries({ queryKey: ["splitwise-balances"] });
      toast.success(`Updated ${res.balances_count} balance(s)`);
    } catch {
      toast.error("Couldn't sync Splitwise");
    }
  }

  async function remove() {
    try {
      await disconnect.mutateAsync();
      toast.success("Splitwise disconnected");
    } catch {
      toast.error("Couldn't disconnect Splitwise");
    }
  }

  return (
    <ConnectionShell
      title="Splitwise"
      description="Import who owes whom from Splitwise."
      footer={
        <>
          <Button onClick={connect} disabled={start.isPending}>
            {start.isPending ? "Starting…" : "Connect Splitwise"}
          </Button>
          <Button variant="outline" onClick={runSync} disabled={sync.isPending}>
            {sync.isPending ? "Syncing…" : "Sync now"}
          </Button>
          <Button variant="ghost" onClick={remove} disabled={disconnect.isPending}>
            Disconnect
          </Button>
        </>
      }
    >
      <p className="text-muted">
        Read-only access imports friend balances without creating expenses.
      </p>
      {balanceRows.length > 0 && (
        <div className="mt-3 rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold">Splitwise balances</h3>
            <span className={net >= 0 ? "text-sm font-semibold text-success" : "text-sm font-semibold text-destructive"}>
              net {net >= 0 ? "+" : ""}{net.toFixed(2)}
            </span>
          </div>
          <ul className="space-y-1">
            {balanceRows.map((b, i) => (
              <li key={i} className="flex justify-between text-sm">
                <span>{b.friend ?? "Friend"}</span>
                <span className="text-muted">
                  {b.amount} {b.currency ?? ""}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">Read-only. Splitwise balances aren&rsquo;t added as transactions.</p>
        </div>
      )}
    </ConnectionShell>
  );
}

function SmsCard() {
  const rotate = useRotateSmsToken();
  const disconnect = useDisconnectSms();
  const [creds, setCreds] = useState<SmsToken | null>(null);

  async function generate() {
    try {
      const res = await rotate.mutateAsync();
      setCreds(res);
      toast.success("Forwarding token generated");
    } catch {
      toast.error("Couldn't generate token");
    }
  }

  async function remove() {
    try {
      await disconnect.mutateAsync();
      setCreds(null);
      toast.success("SMS forwarding disconnected");
    } catch {
      toast.error("Couldn't disconnect");
    }
  }

  return (
    <ConnectionShell
      title="SMS"
      description="Forward bank SMS alerts to auto-log spends."
      footer={
        <>
          <Button onClick={generate} disabled={rotate.isPending}>
            {rotate.isPending ? "Generating…" : creds ? "Rotate token" : "Generate token"}
          </Button>
          {creds && (
            <Button variant="ghost" onClick={remove} disabled={disconnect.isPending}>
              Disconnect
            </Button>
          )}
        </>
      }
    >
      {creds ? (
        <div className="space-y-2">
          <div>
            <p className="text-xs text-muted">Webhook URL</p>
            <code className="break-all rounded bg-chip px-1.5 py-0.5 text-xs">
              {creds.webhook_url}
            </code>
          </div>
          <div>
            <p className="text-xs text-muted">Token</p>
            <code className="break-all rounded bg-chip px-1.5 py-0.5 text-xs">{creds.token}</code>
          </div>
        </div>
      ) : (
        <p className="text-muted">
          Generates a forwarding token + webhook URL for an SMS-forwarding app.
        </p>
      )}
    </ConnectionShell>
  );
}

function BotCard() {
  return (
    <ConnectionShell
      title="Chat bot"
      description="Log spends via a messaging bot."
      footer={
        <Button disabled>On hold</Button>
      }
    >
      <Badge variant="secondary">M12 — on hold</Badge>
      <p className="text-muted">Bot linking isn&apos;t available yet.</p>
    </ConnectionShell>
  );
}
