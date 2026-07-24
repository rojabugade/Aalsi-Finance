"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  downloadExport,
  useConsents,
  useDeleteAccount,
  usePingLlm,
  useRevokeConsent,
  useSettings,
  useUpdateSettings,
} from "@/lib/api/settings";
import { authStore } from "@/lib/api/auth";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemePicker } from "@/components/theme/theme-picker";
import { InstallButton } from "@/components/pwa/install-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { MemoryCard } from "./memory-card";

export default function SettingsPage() {
  return (
    <div className="space-y-4">
      <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
        <h2 className="text-base font-bold tracking-tight">Appearance</h2>
        <p className="text-sm text-muted">Palette and light/dark mode.</p>
        <div className="mt-4 flex items-center justify-between gap-4">
          <ThemePicker />
          <InstallButton />
        </div>
      </div>
      <LlmSettingsCard />
      <PreferencesCard />
      <ConsentsCard />
      <MemoryCard />
      <DataControlsCard />
    </div>
  );
}

type LlmProvider = "openrouter" | "lmstudio";

function LlmSettingsCard() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const ping = usePingLlm();
  const [form, setForm] = useState({
    llm_provider: "openrouter" as LlmProvider,
    llm_base_url: "https://openrouter.ai/api/v1",
    llm_model: "",
    llm_api_key: "",
  });

  useEffect(() => {
    if (!settings.data) return;
    const provider = settings.data.llm_provider.replace("-", "") as LlmProvider;
    setForm((current) => ({
      ...current,
      llm_provider: provider === "lmstudio" ? "lmstudio" : "openrouter",
      llm_base_url: settings.data.llm_base_url ?? "",
      llm_model: settings.data.llm_model ?? "",
      llm_api_key: "",
    }));
  }, [settings.data]);

  function selectProvider(provider: LlmProvider) {
    setForm((current) => ({
      ...current,
      llm_provider: provider,
      llm_base_url:
        provider === "openrouter"
          ? "https://openrouter.ai/api/v1"
          : "http://localhost:1234/v1",
    }));
  }

  async function save() {
    try {
      await update.mutateAsync({
        llm_provider: form.llm_provider,
        llm_base_url: form.llm_base_url,
        llm_model: form.llm_model,
        ...(form.llm_api_key ? { llm_api_key: form.llm_api_key } : {}),
      });
      setForm((current) => ({ ...current, llm_api_key: "" }));
      toast.success("LLM settings saved");
    } catch {
      toast.error("Couldn't save LLM settings");
    }
  }

  async function testConnection() {
    try {
      await ping.mutateAsync();
      toast.success("LLM connection works");
    } catch {
      toast.error("LLM connection failed");
    }
  }

  if (settings.isLoading) return <Skeleton className="h-72" />;

  return (
    <div className="rounded-card-sm border border-dashed border-amber-500/50 bg-card p-4 shadow-card">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold tracking-tight">LLM testing override</h2>
          <p className="text-sm text-muted">
            Temporary workspace-level settings. Saved values take precedence over .env.
          </p>
        </div>
        <Badge variant="secondary">
          {settings.data?.llm_settings_source === "app" ? "Using app settings" : "Using .env"}
        </Badge>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="llm_provider">Provider</Label>
          <select
            id="llm_provider"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.llm_provider}
            onChange={(event) => selectProvider(event.target.value as LlmProvider)}
          >
            <option value="openrouter">OpenRouter</option>
            <option value="lmstudio">LM Studio</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="llm_model">Model (optional)</Label>
          <Input
            id="llm_model"
            value={form.llm_model}
            placeholder={form.llm_provider === "lmstudio" ? "Discover loaded model" : "openai/gpt-4o-mini"}
            onChange={(event) => setForm((current) => ({ ...current, llm_model: event.target.value }))}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="llm_base_url">Base URL</Label>
          <Input
            id="llm_base_url"
            type="url"
            value={form.llm_base_url}
            onChange={(event) => setForm((current) => ({ ...current, llm_base_url: event.target.value }))}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="llm_api_key">API key (optional)</Label>
          <Input
            id="llm_api_key"
            type="password"
            autoComplete="off"
            value={form.llm_api_key}
            placeholder={settings.data?.llm_api_key_configured ? "Saved key is configured; leave blank to keep it" : "Not required for LM Studio"}
            onChange={(event) => setForm((current) => ({ ...current, llm_api_key: event.target.value }))}
          />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={save} disabled={update.isPending || !form.llm_base_url}>
          {update.isPending ? "Saving…" : "Save LLM settings"}
        </Button>
        <Button variant="outline" onClick={testConnection} disabled={ping.isPending}>
          {ping.isPending ? "Testing…" : "Test connection"}
        </Button>
      </div>
    </div>
  );
}

function PreferencesCard() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [form, setForm] = useState({ base_currency: "", locale: "", language: "" });

  useEffect(() => {
    if (settings.data) {
      setForm({
        base_currency: settings.data.base_currency,
        locale: settings.data.locale,
        language: settings.data.language,
      });
    }
  }, [settings.data]);

  async function save() {
    try {
      await update.mutateAsync(form);
      toast.success("Settings saved");
    } catch {
      toast.error("Couldn't save settings");
    }
  }

  if (settings.isLoading) return <Skeleton className="h-48" />;

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3">
        <h2 className="text-base font-bold tracking-tight">Preferences</h2>
        <p className="text-sm text-muted">Currency, locale, and language for your workspace.</p>
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <Label htmlFor="base_currency">Base currency</Label>
            <Input
              id="base_currency"
              value={form.base_currency}
              maxLength={3}
              onChange={(e) => setForm((f) => ({ ...f, base_currency: e.target.value.toUpperCase() }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="locale">Locale</Label>
            <Input
              id="locale"
              value={form.locale}
              onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="language">Language</Label>
            <Input
              id="language"
              value={form.language}
              onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
            />
          </div>
        </div>
        <Button onClick={save} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}

function ConsentsCard() {
  const consents = useConsents();
  const revoke = useRevokeConsent();

  return (
    <div className="rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3">
        <h2 className="text-base font-bold tracking-tight">Consents</h2>
        <p className="text-sm text-muted">Channels you&apos;ve authorised for data ingestion.</p>
      </div>
      <div className="space-y-2">
        {consents.isLoading ? (
          <Skeleton className="h-20" />
        ) : (consents.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">No consents on record.</p>
        ) : (
          (consents.data ?? []).map((c) => (
            <div
              key={c.channel}
              className="flex items-center justify-between rounded-lg border border-border p-3 text-sm"
            >
              <div>
                <span className="font-medium capitalize">{c.channel}</span>
                <span className="ml-2 text-muted">
                  {c.granted ? "Granted" : "Revoked"}
                </span>
              </div>
              {c.granted && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={async () => {
                    try {
                      await revoke.mutateAsync(c.channel);
                      toast.success("Consent revoked");
                    } catch {
                      toast.error("Couldn't revoke consent");
                    }
                  }}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DataControlsCard() {
  const [busy, setBusy] = useState<"csv" | "pdf" | null>(null);

  async function exportData(format: "csv" | "pdf") {
    setBusy(format);
    try {
      await downloadExport(format);
    } catch {
      toast.error("Export failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-card-sm border border-destructive/30 bg-card p-4 shadow-card">
      <div className="mb-3">
        <h2 className="text-base font-bold tracking-tight">Your data</h2>
        <p className="text-sm text-muted">Export everything, or delete your account.</p>
      </div>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => exportData("csv")} disabled={busy !== null}>
            {busy === "csv" ? "Preparing…" : "Export CSV (zip)"}
          </Button>
          <Button variant="outline" onClick={() => exportData("pdf")} disabled={busy !== null}>
            {busy === "pdf" ? "Preparing…" : "Export PDF summary"}
          </Button>
        </div>
        <DeleteAccountDialog />
      </div>
    </div>
  );
}

function DeleteAccountDialog() {
  const router = useRouter();
  const del = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  async function onConfirm() {
    try {
      await del.mutateAsync(confirmation);
      authStore.clear();
      toast.success("Account deleted");
      router.replace("/login");
    } catch {
      toast.error("Couldn't delete account — check the confirmation text");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">Delete account</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete account</DialogTitle>
          <DialogDescription>
            This permanently removes your data. Type <strong>DELETE</strong> to confirm.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="confirmation">Confirmation</Label>
          <Input
            id="confirmation"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="DELETE"
          />
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={del.isPending || confirmation.length === 0}
          >
            {del.isPending ? "Deleting…" : "Permanently delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
