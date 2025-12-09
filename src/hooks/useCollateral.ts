import { useCallback, useEffect, useState } from 'react'
import type { JsonRpcSigner } from 'ethers'
import * as fourMica from 'sdk-4mica'
import { useClient } from './useClient'

export interface CollateralItem {
  asset: string
  symbol: string
  decimals: number
  collateral: string
  withdrawalRequested: string
}

export const useCollateral = (
  signer: JsonRpcSigner | null,
  address: string | null,
  isConnected: boolean,
  coreParams: fourMica.CorePublicParameters | null,
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

    setCollateralLoading(true)
    try {
      const assets = await client.user.getUser()

      // We need to fetch symbol/decimals for these assets to display them nicely
      // The SDK UserInfo result has: asset (address), collateral (bigint), withdrawalRequestAmount (bigint)
      // The SDK does NOT return symbol/decimals, so we might still need a helper or use the SDK if it has one?
      // SDK client.user.getUser() returns UserInfo[].
      // Looking at my analysis earlier, I didn't see a helper for metadata in the SDK UserClient.
      // However, the original code had `resolveTokenMeta`.
      // I should probably keep `resolveTokenMeta` or implement a simplified version.
      // Actually, since I have the `client` which has a `gateway` composed of `ContractGateway`,
      // I can check if `ContractGateway` has a helper. It seems it has `erc20(address)` but it's private.
      // So I still need to resolve metadata manually or using a provider.
      // But `client.gateway.provider` is available!

      const parsed = await Promise.all(assets.map(async (item) => {
        // item is UserInfo { asset, collateral, withdrawalRequestAmount ... }
        const assetAddr = item.asset
        if (!assetAddr) return null

        // We can use the provider from the client's gateway to fetch metadata
        // Client -> gateway -> provider
        const provider = (client as any).gateway.provider
        // (Need to cast to access gateway if it's protected, or check if it's public. 
        // `UserClient` has `private client: Client`. `Client` has `readonly gateway`. So `client.client.gateway`... ?
        // Wait, `UserClient` wraps `Client`. `useClient` returns `Client`.
        // So `client.gateway` is accessible.

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
        return {
          asset: assetAddr,
          symbol,
          decimals,
          collateral: formatUnits(item.collateral, decimals),
          withdrawalRequested: formatUnits(item.withdrawalRequestAmount, decimals)
        }
      }))

      setCollateral(parsed.filter(Boolean) as CollateralItem[])

    } catch (err) {
      appendLog(`Collateral fetch failed (SDK): ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setCollateralLoading(false)
    }
  }, [client, appendLog, isConnected])

  useEffect(() => {
    if (isConnected && client) {
      fetchCollateral()
    } else {
      setCollateral([])
    }
  }, [isConnected, client, fetchCollateral])

  useEffect(() => {
    if (!isConnected || !client) return
    const id = setInterval(() => {
      fetchCollateral()
    }, 10000)
    return () => clearInterval(id)
  }, [isConnected, client, fetchCollateral])

  return { collateral, collateralLoading: collateralLoading || clientLoading, fetchCollateral }
}
