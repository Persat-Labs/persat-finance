import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
  loading?: boolean;
};

const variants: Record<Variant, string> = {
  primary:
    "btn-pill-orange px-6 py-3",
  secondary:
    "rounded-full border border-white/15 bg-white/[0.04] text-white/90 hover:border-amber hover:text-white hover:bg-white/[0.08] backdrop-blur-md transition-all px-5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
  danger:
    "rounded-full border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 px-5 py-3 transition-all",
  ghost:
    "rounded-full border border-transparent bg-transparent text-white/70 hover:text-white hover:bg-white/[0.06] px-4 py-2 transition-all",
};

export function Button({
  variant = "primary",
  loading,
  disabled,
  className = "",
  children,
  ...props
}: Props) {
  return (
    <button
      disabled={disabled || loading}
      className={`relative inline-flex min-h-11 items-center justify-center gap-2 font-mono text-xs uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-40 active:scale-[0.99] ${variants[variant]} ${className}`}
      {...props}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <svg className="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Processing…</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
