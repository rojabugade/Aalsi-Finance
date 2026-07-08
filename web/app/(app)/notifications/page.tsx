"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "@/lib/api/notifications";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const CHANNELS: [string, string][] = [
  ["inapp", "In-app"],
  ["email", "Email"],
  ["push", "Web push"],
  ["bot", "Bot"],
];

export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <ActivityFeed />

      <details className="rounded-2xl border border-border bg-card shadow-card">
        <summary
          role="button"
          className="cursor-pointer list-none px-4 py-3 text-sm font-semibold"
        >
          Preferences
        </summary>
        <div className="px-1 pb-1">
          <PreferencesCard />
        </div>
      </details>
    </div>
  );
}

function PreferencesCard() {
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  const [channels, setChannels] = useState<Record<string, boolean>>({});
  const [quiet, setQuiet] = useState({ enabled: false, start: "22:00", end: "07:00", timezone: "UTC" });

  useEffect(() => {
    if (prefs.data) {
      const quietHours = prefs.data.quiet_hours ?? ({} as Partial<typeof quiet>);
      setChannels({ ...(prefs.data.channels as Record<string, boolean>) });
      setQuiet({
        enabled: quietHours.enabled ?? false,
        start: quietHours.start ?? "22:00",
        end: quietHours.end ?? "07:00",
        timezone: quietHours.timezone ?? "UTC",
      });
    }
  }, [prefs.data]);

  async function toggleChannel(key: string, value: boolean) {
    // Web push requires an explicit browser permission grant; it is best-effort
    // (no VAPID subscription endpoint exists yet — this only records the preference).
    if (key === "push" && value && typeof Notification !== "undefined") {
      try {
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          toast.error("Push permission denied by the browser");
          return;
        }
      } catch {
        /* ignore — still record the preference */
      }
    }
    setChannels((c) => ({ ...c, [key]: value }));
  }

  async function save() {
    try {
      await update.mutateAsync({ channels, quiet_hours: quiet });
      toast.success("Preferences saved");
    } catch {
      toast.error("Couldn't save preferences");
    }
  }

  if (prefs.isLoading) return <Skeleton className="h-64" />;
  if (prefs.isError || !prefs.data) {
    return (
      <div className="rounded-card-sm border border-border bg-card p-6 text-sm text-destructive shadow-card">
        Couldn&apos;t load preferences.
      </div>
    );
  }

  return (
    <div className="p-4">
      <p className="mb-3 text-sm text-muted">Choose channels and quiet hours.</p>
      <div className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm font-semibold">Channels</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {CHANNELS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(channels[key])}
                  onChange={(e) => toggleChannel(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">
            Web push is best-effort: it requests browser permission but delivery isn&apos;t wired
            up yet.
          </p>
        </div>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={quiet.enabled}
              onChange={(e) => setQuiet((q) => ({ ...q, enabled: e.target.checked }))}
            />
            Quiet hours
          </label>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="quiet-start">Start</Label>
              <Input
                id="quiet-start"
                type="time"
                value={quiet.start}
                onChange={(e) => setQuiet((q) => ({ ...q, start: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="quiet-end">End</Label>
              <Input
                id="quiet-end"
                type="time"
                value={quiet.end}
                onChange={(e) => setQuiet((q) => ({ ...q, end: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="quiet-tz">Timezone</Label>
              <Input
                id="quiet-tz"
                value={quiet.timezone}
                onChange={(e) => setQuiet((q) => ({ ...q, timezone: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <Button onClick={save} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </div>
  );
}
