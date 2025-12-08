import { useCallback, useEffect, useState } from 'react'
import { Contract, formatUnits, isAddress } from 'ethers'
import type { JsonRpcSigner } from 'ethers'
import core4micaAbi from 'sdk-4mica/dist/abi/core4mica.json'
import * as fourMica from 'sdk-4mica'

interface CollateralItem {
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
  const [collateral, setCollateral] = useState<CollateralItem[]>([])
  const [collateralLoading, setCollateralLoading] = useState(false)

  const resolveTokenMeta = useCallback(
    async (tokenAddr: string) => {
      if (!signer?.provider) {
        throw new Error('Wallet provider unavailable')
      }
      const erc20 = new Contract(
        tokenAddr,
        ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
        signer.provider
      )
      try {
        const [symbol, decimalsValue] = await Promise.all([erc20.symbol(), erc20.decimals()])
        return { symbol: String(symbol), decimals: Number(decimalsValue) || 18 }
      } catch (err) {
        appendLog(
          `Token metadata fetch failed for ${tokenAddr}: ${err instanceof Error ? err.message : String(err)}`,
          'error'
        )
        return null
      }
    },
    [signer, appendLog]
  )

  const fetchCollateral = useCallback(async () => {
    if (!coreParams || !address || !signer?.provider) return
    setCollateralLoading(true)
    try {
      const contract = new Contract(
        coreParams.contractAddress,
        (core4micaAbi as any).abi ?? core4micaAbi,
        signer.provider
      )
      const raw: any[] = await contract.getUserAllAssets(address)
      const parsed = await Promise.all(
        raw.map(async item => {
          const assetAddr = String(item.asset ?? item[0] ?? '')
          const zeroAddress = '0x0000000000000000000000000000000000000000'
          if (!assetAddr || !isAddress(assetAddr)) return null
          const collateralRaw = BigInt(item.collateral ?? item[1] ?? 0)
          const withdrawalRaw = BigInt(item.withdrawal_request_amount ?? item[3] ?? 0)
          const isNative = assetAddr.toLowerCase() === zeroAddress
          const meta = isNative ? { symbol: 'POL', decimals: 18 } : await resolveTokenMeta(assetAddr)
          const decimals = meta?.decimals ?? 18
          const symbol = meta?.symbol ?? `${assetAddr.slice(0, 6)}...${assetAddr.slice(-4)}`
          return {
            asset: assetAddr,
            symbol,
            decimals,
            collateral: formatUnits(collateralRaw, decimals),
            withdrawalRequested: formatUnits(withdrawalRaw, decimals),
          }
        })
      )
      setCollateral(parsed.filter(Boolean) as CollateralItem[])
    } catch (err) {
      appendLog(`Collateral fetch failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setCollateralLoading(false)
    }
  }, [coreParams, address, signer, resolveTokenMeta, appendLog])

  useEffect(() => {
    if (isConnected) {
      fetchCollateral()
    } else {
      setCollateral([])
    }
  }, [isConnected, fetchCollateral])

  useEffect(() => {
    if (!isConnected) return
    const id = setInterval(() => {
      fetchCollateral()
    }, 10000)
    return () => clearInterval(id)
  }, [isConnected, fetchCollateral])

  return { collateral, collateralLoading, fetchCollateral }
}
