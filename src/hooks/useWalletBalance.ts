import { useCallback, useEffect, useState } from 'react'
import { Contract, formatEther, formatUnits } from 'ethers'
import type { JsonRpcSigner } from 'ethers'

interface TokenBalance {
  address: string
  symbol: string
  balance: string
  decimals: number
}

export const useWalletBalance = (
  signer: JsonRpcSigner | null,
  address: string | null,
  isConnected: boolean,
  chainId: number | null,
  trackedTokens: string[],
  appendLog: (entry: string, tone?: 'info' | 'warn' | 'success' | 'error') => void
) => {
  const [balance, setBalance] = useState<string | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([])

  const fetchBalance = useCallback(async () => {
    if (!signer || !address) return
    setBalanceLoading(true)
    try {
      const bal = await signer.provider?.getBalance(address)
      if (bal !== undefined) {
        setBalance(formatEther(bal))
      }
    } catch (err) {
      appendLog(`Balance fetch failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBalanceLoading(false)
    }
  }, [signer, address, appendLog])

  useEffect(() => {
    if (!isConnected) {
      setBalance(null)
      setTokenBalances([])
      return
    }
    fetchBalance()
  }, [isConnected, chainId, fetchBalance])

  useEffect(() => {
    let cancelled = false
    const fetchTokenBalances = async () => {
      if (!signer || !isConnected || trackedTokens.length === 0) {
        setTokenBalances([])
        return
      }
      const provider = signer.provider
      if (!provider) return

      const results: TokenBalance[] = []
      for (const addr of trackedTokens) {
        try {
          const erc20 = new Contract(
            addr,
            [
              'function symbol() view returns (string)',
              'function decimals() view returns (uint8)',
              'function balanceOf(address) view returns (uint256)',
            ],
            provider
          )
          const [symbol, decimalsValue, raw] = await Promise.all([
            erc20.symbol(),
            erc20.decimals(),
            erc20.balanceOf(address),
          ])
          results.push({
            address: addr,
            symbol,
            decimals: Number(decimalsValue),
            balance: formatUnits(raw, decimalsValue),
          })
        } catch (err) {
          appendLog(`Token balance failed for ${addr}: ${err instanceof Error ? err.message : String(err)}`, 'error')
        }
      }
      if (!cancelled) {
        setTokenBalances(results)
      }
    }
    fetchTokenBalances()
    return () => {
      cancelled = true
    }
  }, [signer, isConnected, trackedTokens, address, appendLog])

  return { balance, balanceLoading, tokenBalances, fetchBalance }
}
