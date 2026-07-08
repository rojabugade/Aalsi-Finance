import * as React from "react";

import { cn } from "@/lib/utils";

/** Native <select> styled to match Input (Ledger primitives): 16px on mobile to
 *  avoid iOS focus-zoom, dense 36px on desktop, 2px focus ring + accent border. */
const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-11 w-full rounded-md border border-border bg-card px-3 text-base shadow-sm transition-[border-color,box-shadow] focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50 md:h-9 md:text-sm",
      className,
    )}
    {...props}
  />
));
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
