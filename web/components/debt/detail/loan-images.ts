// Decorative, type-derived hero images. SEAM: a future per-loan image_url field
// or AI/asset-picked URL replaces these defaults.
const LOAN_IMAGES: Record<string, string> = {
  auto: "https://images.pexels.com/photos/35592262/pexels-photo-35592262.jpeg",
  home: "https://images.pexels.com/photos/1396122/pexels-photo-1396122.jpeg",
  education: "https://images.pexels.com/photos/207692/pexels-photo-207692.jpeg",
  personal: "https://images.pexels.com/photos/3943716/pexels-photo-3943716.jpeg",
  credit_card: "https://images.pexels.com/photos/259200/pexels-photo-259200.jpeg",
  other: "https://images.pexels.com/photos/210607/pexels-photo-210607.jpeg",
};

export function loanImage(loan: { type: string }): string {
  return LOAN_IMAGES[loan.type] ?? LOAN_IMAGES.other;
}

const TYPE_LABEL: Record<string, string> = {
  home: "Mortgage", auto: "Auto", education: "Student",
  personal: "Personal", credit_card: "Credit card", other: "Other",
};

export function loanTypeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}
