import { Hammer } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Placeholder for surfaces not yet built. Lives INSIDE the (app) route group so
 * the nav shell stays mounted — navigating here never drops the sidebar.
 */
export function ComingSoon({
  title,
  wave,
  description,
}: {
  title: string;
  wave: string;
  description?: string;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {description ?? "This surface is on the roadmap."}
        </p>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Hammer className="size-6" />
          </span>
          <div className="space-y-1">
            <p className="font-medium">Coming soon</p>
            <p className="text-sm text-muted-foreground">
              {title} lands in <Badge variant="secondary">{wave}</Badge> of the rebuild.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
