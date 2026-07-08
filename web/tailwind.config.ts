import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: {
        // Ledger §5 radii — tightened from the original soft (24px) scale to a
        // crisper, data-dense feel. Cards read as panels, not pills.
        card: "14px",
        "card-sm": "12px",
        chip: "8px",
        bar: "16px",
        fab: "14px",
        // shadcn fallbacks (radix primitives).
        lg: "12px",
        md: "9px",
        sm: "7px",
        // Ledger: pull Tailwind's soft default scale (xl 12 / 2xl 16 / 3xl 24) down
        // to panel radii, re-skinning every rounded-xl/2xl/3xl call site at once.
        xl: "12px",
        "2xl": "14px",
        "3xl": "18px",
      },
      colors: {
        // ---- new design tokens (spec §4) ----
        bg: "var(--app-bg)",
        fg: "var(--fg)",
        chip: "var(--chip)",
        track: "var(--track)",
        "on-accent": "var(--on-accent)",
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--on-accent)",
          soft: "var(--accent-soft)",
        },
        c2: { DEFAULT: "var(--c2)", soft: "var(--soft2)" },
        c3: { DEFAULT: "var(--c3)", soft: "var(--soft3)" },
        soft2: "var(--soft2)",
        soft3: "var(--soft3)",
        card: { DEFAULT: "var(--card)", foreground: "var(--fg)" },
        border: "var(--border)",
        // ---- shadcn/radix bridge (map onto the same tokens) ----
        background: "var(--app-bg)",
        foreground: "var(--fg)",
        primary: { DEFAULT: "var(--accent)", foreground: "var(--on-accent)" },
        secondary: { DEFAULT: "var(--chip)", foreground: "var(--fg)" },
        popover: { DEFAULT: "var(--card)", foreground: "var(--fg)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted)" },
        input: "var(--border)",
        ring: "var(--accent)",
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--on-destructive)",
        },
        success: { DEFAULT: "var(--c3)", foreground: "var(--on-accent)" },
      },
      boxShadow: {
        card: "var(--card-shadow)",
        hero: "var(--hero-shadow)",
      },
      backgroundImage: {
        hero: "var(--hero)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
