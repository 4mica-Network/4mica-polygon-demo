import { useCallback, useEffect, useState } from 'react'
import { formatUnits } from 'ethers'
import { config } from '../config/env'

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
  const [collateral, setCollateral] = useState<CollateralItem[]>([])
  const [collateralLoading, setCollateralLoading] = useState(false)

  const normalizeAmount = useCallback((raw: string, decimals: number) => {
    try {
      return formatUnits(BigInt(raw || '0'), decimals || 18)
    } catch {
      return '0'
    }
  }, [])

  const fetchCollateral = useCallback(async () => {
    if (!address) {
      setCollateral([])
      return
    }

    setCollateralLoading(true)
    try {
      const url = `${config.signerServiceUrl.replace(/\/+$/, '')}/collateral?address=${encodeURIComponent(address)}`
      const resp = await fetch(url)
      if (!resp.ok) {
        const msg = await resp.text()
        throw new Error(msg || 'Collateral fetch failed')
      }
      const data = (await resp.json()) as { assets?: CollateralItem[] }
      const assets = data.assets || []
      setCollateral(
        assets.map(item => ({
          ...item,
          collateral: normalizeAmount(item.collateral, item.decimals),
          locked: normalizeAmount(item.locked, item.decimals),
          withdrawalRequested: normalizeAmount(item.withdrawalRequested, item.decimals),
        }))
      )
    } catch (err) {
      appendLog(`Collateral fetch failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setCollateralLoading(false)
    }
  }, [appendLog, isConnected, address, normalizeAmount])

  useEffect(() => {
    if (isConnected) {
      fetchCollateral()
    } else {
      setCollateral([])
    }
  }, [isConnected, address, fetchCollateral])

  useEffect(() => {
    if (!isConnected) return
    const id = setInterval(() => {
      fetchCollateral()
    }, 10000)
    return () => clearInterval(id)
  }, [isConnected, fetchCollateral])

  return { collateral, collateralLoading, fetchCollateral }
}
