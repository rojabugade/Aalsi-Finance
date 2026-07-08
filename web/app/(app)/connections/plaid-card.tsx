"use client";

import { useEffect, useRef, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { toast } from "sonner";
import {
  usePlaidLinkToken, useExchangePlaidToken, useSyncPlaid, usePlaidItems, useDisconnectPlaidItem,
} from "@/lib/api/connections";
import { Button } from "@/components/ui/button";
import { ConnectionShell } from "./connection-shell";

export function PlaidCard() {
  const linkToken = usePlaidLinkToken();
  const exchange = useExchangePlaidToken();
  const sync = useSyncPlaid();
  const items = usePlaidItems();
  const disconnect = useDisconnectPlaidItem();
  const [token, setToken] = useState<string | null>(null);
  const updateItemId = useRef<string | null>(null);

  async function finishLink(publicToken: string, metadata: PlaidLinkOnSuccessMetadata) {
    if (updateItemId.current) {
      // Update mode: the existing item was re-authenticated in place — there is
      // no public token to exchange and nothing new to import, just sync.
      const itemId = updateItemId.current;
      updateItemId.current = null;
      setToken(null);
      try {
        const synced = await sync.mutateAsync({ plaid_item_id: itemId });
        toast.success(`Reconnected · ${synced.transactions_created} new transaction(s)`);
        void items.refetch?.();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't sync after reconnecting");
      }
      return;
    }
    try {
      const res = await exchange.mutateAsync({
        public_token: publicToken,
        institution_name: metadata?.institution?.name ?? null,
        accounts: (metadata?.accounts ?? []) as unknown as Record<string, never>[],
      });
      toast.success(`Linked ${res.accounts_created} account(s)`);
      const synced = await sync.mutateAsync({ plaid_item_id: res.plaid_item_id });
      const extra = synced.loans_synced ? `, ${synced.loans_synced} loan/card(s)` : "";
      toast.success(`Imported ${synced.transactions_created} transaction(s)${extra}`);
      void items.refetch?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't finish connecting your bank");
    } finally {
      setToken(null);
    }
  }

  async function connect() {
    try {
      updateItemId.current = null;
      const res = await linkToken.mutateAsync({});
      setToken(res.link_token);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't start Plaid Link");
    }
  }

  async function reconnect(itemId: string) {
    try {
      const res = await linkToken.mutateAsync({ plaid_item_id: itemId });
      updateItemId.current = itemId;
      setToken(res.link_token);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't start reconnect");
    }
  }

  const connected = items.data ?? [];

  return (
    <>
      {token ? <PlaidLinkLauncher token={token} onSuccess={finishLink} /> : null}
      <ConnectionShell
        title="Bank (Plaid)"
        description="Securely import bank & card transactions."
        footer={
          <Button onClick={connect} disabled={linkToken.isPending || exchange.isPending}>
            {linkToken.isPending ? "Requesting…" : "Connect bank"}
          </Button>
        }
      >
        {connected.length === 0 ? (
          <div className="space-y-2">
            <p className="text-muted">No banks connected yet. Connect to import transactions automatically.</p>
            <p className="text-xs text-muted">
              Sandbox tip: sign in with <code>user_transactions_dynamic</code> / <code>pass_good</code> to
              get a realistic, continuously updating transaction feed.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {connected.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <span className="text-sm font-medium">{item.institution_name ?? "Bank"} · {item.account_count} acct</span>
                <span className="flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => sync.mutateAsync({ plaid_item_id: item.id }).then(() => toast.success("Synced")).catch(() => toast.error("Sync failed"))}>Sync</Button>
                  <Button variant="outline" size="sm" onClick={() => reconnect(item.id)}>Reconnect</Button>
                  <Button variant="ghost" size="sm" onClick={() => disconnect.mutateAsync(item.id).then(() => toast.success("Disconnected")).catch(() => toast.error("Couldn't disconnect"))}>Disconnect</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </ConnectionShell>
    </>
  );
}

function PlaidLinkLauncher({ token, onSuccess }: {
  token: string;
  onSuccess: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => void;
}) {
  const opened = useRef(false);
  const { open, ready } = usePlaidLink({ token, onSuccess });

  useEffect(() => {
    if (ready && !opened.current) {
      opened.current = true;
      open();
    }
  }, [open, ready]);

  return null;
}
