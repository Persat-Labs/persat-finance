"use client";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AdminOpsDashboard } from "@/components/admin/AdminOpsDashboard";

/**
 * Protocol ops dashboard — client-only (Mode W).
 * No backend/database required for charts, oracle, balances, program map, local ops log.
 */
export default function AdminPage() {
  return (
    <ErrorBoundary>
      <AdminOpsDashboard />
    </ErrorBoundary>
  );
}
