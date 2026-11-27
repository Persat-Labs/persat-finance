import { Navigate } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { useIsAdmin } from '../hooks/useIsAdmin'

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const { isConnected, isConnecting, isReconnecting } = useAccount()
  const { isAdmin, isChecking } = useIsAdmin()
  if (isConnecting || isReconnecting || isChecking) {
    return <div className="max-w-4xl mx-auto px-4 py-16 text-center text-sm text-[#a58c7b]">Checking access…</div>
  }
  if (!isConnected || !isAdmin) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}
