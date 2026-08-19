import type { HTMLAttributes, ReactNode } from "react";
export function Card({ children, className = "", ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return <section className={`panel p-5 sm:p-7 ${className}`} {...props}>{children}</section>;
}
