import type { Metadata } from "next";
import "./globals.css";
import { PersatWalletProvider } from "@/components/wallet/WalletContext";

export const metadata: Metadata = { title: "Persat Finance", description: "Non-custodial Bitcoin-backed lending infrastructure." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><PersatWalletProvider>{children}</PersatWalletProvider></body></html>;
}
