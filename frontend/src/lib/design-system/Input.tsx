import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`min-h-12 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 font-body text-base text-white outline-none transition placeholder:text-white/30 focus:border-amber focus:bg-white/[0.05] focus:ring-1 focus:ring-amber/40 ${className}`}
      {...props}
    />
  );
}
