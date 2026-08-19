import type { InputHTMLAttributes } from "react";
export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
 return <input className={`min-h-12 w-full border border-amber/20 bg-ink px-4 font-body text-base text-white outline-none transition placeholder:text-orange-50/45 focus:border-amber focus:ring-1 focus:ring-amber/40 ${className}`} {...props} />;
}
