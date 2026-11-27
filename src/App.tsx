import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import NewDeal from './pages/NewDeal'
import ClaimDeal from './pages/ClaimDeal'
import Marketplace from './pages/Marketplace'
import ManageDeal from './pages/ManageDeal'
import Security from './pages/Security'
import AdminGate from './components/AdminGate'
import { StudioWatermark } from './components/StudioBadge'

// Loaded on demand, only for admin wallets. The contracts still enforce onlyOwner on every action.
const Admin = lazy(() => import('./pages/Admin'))

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
          <Route path="/deal/new" element={<Layout><NewDeal /></Layout>} />
          <Route path="/deal/claim/:token" element={<Layout><ClaimDeal /></Layout>} />
          <Route path="/marketplace" element={<Layout><Marketplace /></Layout>} />
          <Route path="/deal/:id/manage" element={<Layout><ManageDeal /></Layout>} />
          <Route path="/deal/manage/:id" element={<Layout><ManageDeal /></Layout>} />
          <Route path="/security" element={<Layout><Security /></Layout>} />
          <Route path="/admin" element={<Layout><AdminGate><Suspense fallback={null}><Admin /></Suspense></AdminGate></Layout>} />
        </Routes>
        <StudioWatermark />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
