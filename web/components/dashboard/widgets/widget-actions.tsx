"use client";
import { MoreHorizontal, Maximize2, SlidersHorizontal, Copy, Trash2, Sparkles, Pin, Lock } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export function WidgetActions({
  onExpand,
  onCustomize,
  onDuplicate,
  onRemove,
}: {
  onExpand: () => void;
  onCustomize?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Widget actions"
        className="grid size-5 place-items-center rounded text-muted hover:bg-chip hover:text-fg"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <MoreHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onExpand}><Maximize2 className="mr-2 size-3.5" />Expand</DropdownMenuItem>
        {onCustomize && <DropdownMenuItem onClick={onCustomize}><SlidersHorizontal className="mr-2 size-3.5" />Customize</DropdownMenuItem>}
        {onDuplicate && <DropdownMenuItem onClick={onDuplicate}><Copy className="mr-2 size-3.5" />Duplicate</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled><Sparkles className="mr-2 size-3.5" />Ask AI</DropdownMenuItem>
        <DropdownMenuItem disabled><Pin className="mr-2 size-3.5" />Pin</DropdownMenuItem>
        <DropdownMenuItem disabled><Lock className="mr-2 size-3.5" />Lock</DropdownMenuItem>
        {onRemove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive"><Trash2 className="mr-2 size-3.5" />Remove</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
