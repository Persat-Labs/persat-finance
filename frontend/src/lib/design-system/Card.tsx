import type { HTMLAttributes, ReactNode } from "react";

export function Card({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <section
      className={`glass sheen rounded-[22px] p-6 sm:p-8 transition-all hover:border-white/15 ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}
