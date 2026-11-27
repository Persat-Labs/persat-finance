// oxlint-disable
import { useEffect, useMemo } from 'react'
import { LiFiWidget, ChainId, ChainType, WidgetEvent, useWidgetEvents, type WidgetConfig } from '@lifi/widget'

const ARC_CHAIN_ID = 5042

interface Props {
  preset: 'btc' | 'any'
  toToken: `0x${string}`
  toAddress: `0x${string}`
  onCompleted: () => void
}

export default function LifiDepositModal({ preset, toToken, toAddress, onCompleted }: Props) {
  const events = useWidgetEvents()

  useEffect(() => {
    const done = () => onCompleted()
    events.on(WidgetEvent.RouteExecutionCompleted, done)
    return () => events.off(WidgetEvent.RouteExecutionCompleted, done)
  }, [events, onCompleted])

  const config = useMemo<WidgetConfig>(() => ({
    integrator: 'persat-finance',
    variant: 'compact',
    appearance: 'dark',
    toChain: ARC_CHAIN_ID,
    toToken,
    toAddress: { address: toAddress, chainType: ChainType.EVM, name: 'Your Persat wallet' },
    ...(preset === 'btc' ? { fromChain: ChainId.BTC, fromToken: 'bitcoin' } : {}),
    disabledUI: ['toAddress', 'toToken'],
    hiddenUI: ['appearance', 'language', 'poweredBy'],
    buildUrl: false,
    routePriority: 'CHEAPEST',
    theme: {
      container: { borderRadius: '16px', border: '1px solid rgba(86,67,52,0.5)' },
      palette: {
        primary: { main: '#ff8a00' },
        secondary: { main: '#ffb86b' },
        background: { default: '#17120f', paper: '#201b17' },
      },
    },
  }), [preset, toToken, toAddress])

  return <LiFiWidget integrator="persat-finance" config={config} />
}
