// oxlint-disable
import { useEffect, useMemo } from 'react'
import { LiFiWidget, ChainId, ChainType, WidgetEvent, useWidgetEvents, type WidgetConfig } from '@lifi/widget'

const ARC_CHAIN_ID = 5042

interface Props {
  fromToken: `0x${string}`
  fromAmount: string
  btcAddress: string
  onCompleted: () => void
}

// cirBTC on Arc -> native BTC on the Bitcoin network, delivered to the address the user typed and confirmed.
export default function LifiWithdrawWidget({ fromToken, fromAmount, btcAddress, onCompleted }: Props) {
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
    fromChain: ARC_CHAIN_ID,
    fromToken,
    fromAmount,
    toChain: ChainId.BTC,
    toToken: 'bitcoin',
    toAddress: { address: btcAddress, chainType: ChainType.UTXO, name: 'Your Bitcoin address' },
    disabledUI: ['fromToken', 'toToken', 'toAddress'],
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
  }), [fromToken, fromAmount, btcAddress])

  return <LiFiWidget integrator="persat-finance" config={config} />
}
