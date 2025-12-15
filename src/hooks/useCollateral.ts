import { useCallback, useEffect, useState } from 'react'
import { useClient } from './useClient'

export interface CollateralItem {
  asset: string
  symbol: string
  decimals: number
  collateral: string
  locked: string
  withdrawalRequested: string
}

export const useCollateral = (
  isConnected: boolean,
  address: string | null,
  appendLog: (entry: string, tone?: 'info' | 'warn' | 'success' | 'error') => void
) => {
  const { client, clientLoading } = useClient(appendLog)
  const [collateral, setCollateral] = useState<CollateralItem[]>([])
  const [collateralLoading, setCollateralLoading] = useState(false)

  const fetchCollateral = useCallback(async () => {
    if (!client) {
      if (isConnected) appendLog('SDK client not ready yet.', 'warn')
      return
    }
    if (!address) {
      setCollateral([])
      return
    }

    setCollateralLoading(true)
    try {
      const assets = await client.user.getUser()

      const parsed = await Promise.all(
        assets.map(async item => {
          // item is UserInfo { asset, collateral, withdrawalRequestAmount ... }
          const assetAddr = item.asset
          if (!assetAddr) return null

          // We can use the provider from the client's gateway to fetch metadata
          // Client -> gateway -> provider
          const provider = (client as any).gateway.provider

          let symbol = 'UNK'
          let decimals = 18
          const zeroAddress = '0x0000000000000000000000000000000000000000'
          const isNative = assetAddr.toLowerCase() === zeroAddress

          if (isNative) {
            symbol = 'POL'
            decimals = 18
          } else {
            try {
              // Manual fallback for metadata since SDK doesn't expose ERC20 view easily
              // Or I can use `new Contract` if I import it from ethers?
              const { Contract } = await import('ethers')
              const erc20 = new Contract(
                assetAddr,
                ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
                provider
              )
              const [s, d] = await Promise.all([erc20.symbol(), erc20.decimals()])
              symbol = String(s)
              decimals = Number(d) || 18
            } catch (err) {
              symbol = `${assetAddr.slice(0, 6)}...${assetAddr.slice(-4)}`
            }
          }

          const { formatUnits } = await import('ethers')

          let lockedRaw: bigint = 0n
          let totalRaw: bigint | null = null
          try {
            const balanceInfo = await (client as any).recipient.getUserAssetBalance(address, assetAddr)
            lockedRaw = balanceInfo?.locked ?? 0n
            totalRaw = balanceInfo?.total ?? null
          } catch (err) {
            appendLog(
              `Locked collateral fetch failed for ${assetAddr}: ${err instanceof Error ? err.message : String(err)}`,
              'error'
            )
          }

          return {
            asset: assetAddr,
            symbol,
            decimals,
            collateral: formatUnits(totalRaw ?? item.collateral, decimals),
            locked: formatUnits(lockedRaw, decimals),
            withdrawalRequested: formatUnits(item.withdrawalRequestAmount, decimals),
          }
        })
      )

      setCollateral(parsed.filter(Boolean) as CollateralItem[])
    } catch (err) {
      appendLog(`Collateral fetch failed (SDK): ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setCollateralLoading(false)
    }
  }, [client, appendLog, isConnected, address])

  useEffect(() => {
    if (isConnected && client) {
      fetchCollateral()
    } else {
      setCollateral([])
    }
  }, [isConnected, client, address])

  useEffect(() => {
    if (!isConnected || !client) return
    const id = setInterval(() => {
      fetchCollateral()
    }, 10000)
    return () => clearInterval(id)
  }, [isConnected, client, fetchCollateral])

  return { collateral, collateralLoading: collateralLoading || clientLoading, fetchCollateral }
}
