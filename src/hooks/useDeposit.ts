import { useCallback, useState } from 'react'
import { formatUnits, isAddress, parseUnits, type Signer } from 'ethers'
import * as fourMica from 'sdk-4mica'
import { TARGET_CHAIN_ID } from '../context/WalletContext'
import { config } from '../config/env'
import type { PaymentScheme } from '../utils/paymentHandler'
import { useClient } from './useClient'

export const useDeposit = (
  signer: Signer | null,
  address: string | null,
  chainId: number | null,
  paymentScheme: PaymentScheme,
  coreParams: fourMica.CorePublicParameters | null,
  appendLog: (entry: string, tone?: 'info' | 'warn' | 'success' | 'error') => void,
  onSuccess: () => void
) => {
  const { client, clientLoading } = useClient(appendLog)
  const [depositLoading, setDepositLoading] = useState(false)

  // Helper to resolve metadata, ideally SDK should handle this or we keep helper
  // Keeping helper for now as SDK doesn't expose easy metadata fetch
  const resolveTokenMeta = useCallback(
    async (tokenAddr: string) => {
      // We can use signer provider or client provider
      const provider = signer?.provider || (client as any)?.gateway?.provider
      if (!provider) {
        // Can't fail hard here if client is not ready, but usually we need provider
        return null
      }

      try {
        const { Contract } = await import('ethers')
        const erc20 = new Contract(
          tokenAddr,
          ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
          provider
        )
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
    [signer, client, appendLog]
  )

  const handleDeposit = useCallback(
    async (depositMode: 'default' | 'custom', depositAmount: string, tokenAddress: string, tokenDecimals: string) => {
      if (!client) {
        appendLog('SDK Client not ready.', 'error')
        return
      }

      // Check scheme
      if (paymentScheme !== '4mica-credit') {
        appendLog('Deposits are only needed in 4mica credit mode. Switch payment rail to deposit.', 'warn')
        return
      }

      // Check chain 
      // coreParams might be null if failed, but client has internal params.
      // We can check chainId from client or wallet context.
      // SDK client validates chain on init usually.

      const requiredChainId = coreParams?.chainId ?? TARGET_CHAIN_ID
      if (chainId !== null && BigInt(chainId) !== BigInt(requiredChainId)) {
        // Note: SDK usually handles chain mismatch internally or we rely on WalletContext
        appendLog(`Switch to chain ${requiredChainId} before depositing.`, 'warn')
        return
      }

      const amount = depositAmount.trim()
      if (!amount || Number(amount) <= 0) {
        appendLog('Enter a valid amount greater than 0.', 'error')
        return
      }
      const useDefaultToken = depositMode === 'default'
      const defaultTokenAddress = config.defaultTokenAddress
      const tokenToUse = useDefaultToken ? defaultTokenAddress : tokenAddress

      if (!tokenToUse || !isAddress(tokenToUse)) {
        appendLog('Invalid token address.', 'error')
        return
      }

      setDepositLoading(true)
      try {
        // Resolve meta for logging/decimals
        const meta = await resolveTokenMeta(tokenToUse)
        if (!meta) {
          appendLog(`Invalid or non-existent token at ${tokenToUse}.`, 'error')
          setDepositLoading(false)
          return
        }

        const decimals = meta.decimals
        const parsedAmount = parseUnits(amount, decimals)
        const tokenLabel = meta.symbol

        appendLog(`Preparing deposit of ${formatUnits(parsedAmount, decimals)} ${tokenLabel} (${decimals} decimals)`)

        // SDK handles approval automatically? 
        // No, client.user.approveErc20 and client.user.deposit are separate.
        // And SDK deposit doesn't auto-approve.

        // 1. Approve
        appendLog(`Requesting token approval…`) // SDK doesn't check allowance first explicitly in exposed method
        // But we can just approve.
        try {
          const tx = await client.user.approveErc20(tokenToUse, parsedAmount)
          appendLog(`Approve sent: ${(tx as any)?.hash || 'ok'}`)
        } catch (err) {
          // It might fail if already approved? Or user rejected.
          // Continue? Or throw?
          appendLog(`Approval step warning: ${err instanceof Error ? err.message : String(err)}`)
          // We try to proceed to deposit in case it was already approved
        }

        // 2. Deposit
        const tx = await client.user.deposit(parsedAmount, tokenToUse)
        appendLog(`Deposit submitted: ${(tx as any)?.hash || 'ok'}`)

        onSuccess()

      } catch (err) {
        appendLog(`Deposit failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
      } finally {
        setDepositLoading(false)
      }
    },
    [client, chainId, paymentScheme, coreParams, appendLog, resolveTokenMeta, onSuccess]
  )

  return { depositLoading: depositLoading || clientLoading, handleDeposit }
}
