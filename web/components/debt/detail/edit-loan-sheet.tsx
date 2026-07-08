"use client";

import type { Loan } from "@/lib/api/loans";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { EditSection } from "./sections";

export function EditLoanSheet({
  loan, open, onOpenChange, onDeleted,
}: { loan: Loan; open: boolean; onOpenChange: (v: boolean) => void; onDeleted: () => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetTitle className="mb-4">Edit {loan.name}</SheetTitle>
        <EditSection
          loan={loan}
          onDone={() => onOpenChange(false)}
          onDeleted={onDeleted}
        />
      </SheetContent>
    </Sheet>
  );
}
