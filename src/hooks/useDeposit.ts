import { useCallback, useState } from 'react'
import type { CorePublicParameters } from 'sdk-4mica'
import { formatUnits, isAddress, parseUnits } from 'ethers'
import type { JsonRpcSigner } from 'ethers'
import { TARGET_CHAIN_ID } from '../context/WalletContext'
import { config } from '../config/env'
import type { PaymentScheme } from '../utils/paymentHandler'
import { getCoreContract, getErc20Contract, getProvider } from '../utils/fourMicaContract'

export const useDeposit = (
  signer: JsonRpcSigner | null,
  address: string | null,
  chainId: number | null,
  paymentScheme: PaymentScheme,
  coreParams: CorePublicParameters | null,
  appendLog: (entry: string, tone?: 'info' | 'warn' | 'success' | 'error') => void,
  onSuccess: () => void
) => {
  const [depositLoading, setDepositLoading] = useState(false)

  // Helper to resolve metadata, ideally SDK should handle this or we keep helper
  // Keeping helper for now as SDK doesn't expose easy metadata fetch
  const resolveTokenMeta = useCallback(
    async (tokenAddr: string) => {
      const provider = getProvider(signer, coreParams?.ethereumHttpRpcUrl || config.rpcProxyUrl)
      if (!provider) {
        // Can't fail hard here if client is not ready, but usually we need provider
        return null
      }

      try {
        const erc20 = getErc20Contract(tokenAddr, provider)
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
    [signer, coreParams?.ethereumHttpRpcUrl, appendLog]
  )

  const handleDeposit = useCallback(
    async (depositMode: 'default' | 'custom', depositAmount: string, tokenAddress: string, tokenDecimals: string) => {
      // Check scheme
      if (paymentScheme !== '4mica-credit') {
        appendLog('Deposits are only needed in 4mica credit mode. Switch payment rail to deposit.', 'warn')
        return
      }

      if (!signer || !address) {
        appendLog('Connect a wallet before depositing.', 'error')
        return
      }

      // Check chain 
      // coreParams might be null if failed, but client has internal params.
      // We can check chainId from client or wallet context.
      // SDK client validates chain on init usually.

      const requiredChainId = coreParams?.chainId ?? TARGET_CHAIN_ID
      if (chainId !== null && BigInt(chainId) !== BigInt(requiredChainId)) {
        appendLog(`Switch to chain ${requiredChainId} before depositing.`, 'warn')
        return
      }

      const coreAddress = coreParams?.contractAddress
      if (!coreAddress || !isAddress(coreAddress)) {
        appendLog('Missing 4mica contract address; reload params and try again.', 'error')
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
        const meta = await resolveTokenMeta(tokenToUse)
        const fallbackDecimals = Number(tokenDecimals) || 18
        const decimals = meta?.decimals ?? fallbackDecimals
        const tokenLabel =
          meta?.symbol ??
          (tokenToUse ? `${tokenToUse.slice(0, 6)}…${tokenToUse.slice(-4)}` : useDefaultToken ? 'default token' : 'token')

        if (!decimals || decimals < 0) {
          appendLog(`Unable to resolve decimals for ${tokenToUse}.`, 'error')
          setDepositLoading(false)
          return
        }

        const parsedAmount = parseUnits(amount, decimals)

        appendLog(`Preparing deposit of ${formatUnits(parsedAmount, decimals)} ${tokenLabel} (${decimals} decimals)`)

        if (!signer.provider) {
          appendLog('Wallet provider unavailable; reconnect your wallet.', 'error')
          setDepositLoading(false)
          return
        }

        const walletAddress = await signer.getAddress()
        const erc20 = getErc20Contract(tokenToUse, signer)
        const allowance: bigint = await erc20.allowance(walletAddress, coreAddress)
        if (allowance < parsedAmount) {
          appendLog(`Requesting token approval…`)
          try {
            const approveTx = await erc20.approve(coreAddress, parsedAmount)
            const receipt = await approveTx.wait?.(1)
            appendLog(`Approve sent: ${receipt?.hash || approveTx.hash || 'ok'}`)
          } catch (err) {
            appendLog(`Approval step warning: ${err instanceof Error ? err.message : String(err)}`)
            // Continue in case allowance is already set
          }
        } else {
          appendLog('Existing allowance is sufficient; skipping approval.')
        }

        const core = getCoreContract(coreAddress, signer)
        const tx = await core.depositStablecoin(tokenToUse, parsedAmount)
        const receipt = await tx.wait?.(1)
        appendLog(`Deposit submitted: ${receipt?.hash || tx.hash || 'ok'}`)

        onSuccess()
      } catch (err) {
        appendLog('Deposit failed. Please re-approve the token and retry.', 'error')
      } finally {
        setDepositLoading(false)
      }
    },
    [signer, address, chainId, paymentScheme, coreParams, appendLog, resolveTokenMeta, onSuccess]
  )

  return { depositLoading, handleDeposit }
}
