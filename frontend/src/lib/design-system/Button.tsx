import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; children: ReactNode; loading?: boolean };

const variants: Record<Variant, string> = {
  primary: "border-amber bg-surface text-white hover:border-white hover:bg-amber/10",
  secondary: "border-amber/30 bg-surface/70 text-amber hover:border-amber hover:text-white",
  danger: "border-orange bg-orange/10 text-white hover:bg-orange/20",
  ghost: "border-transparent bg-transparent text-orange-50 hover:border-amber/30 hover:text-amber",
};

export function Button({ variant = "primary", loading, disabled, className = "", children, ...props }: Props) {
  return <button disabled={disabled || loading} className={`group relative inline-flex min-h-12 items-center justify-center gap-2 overflow-hidden border px-5 py-3 font-mono text-xs uppercase tracking-widest transition disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${className}`} {...props}>
    <span className="absolute inset-y-0 left-0 w-1 bg-amber transition-all group-hover:w-2" />
    <span className="relative">{loading ? "Processing…" : children}</span>
  </button>;
}
