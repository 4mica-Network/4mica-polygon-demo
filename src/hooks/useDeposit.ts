import { useCallback, useState } from 'react'
import { Contract, formatUnits, isAddress, parseUnits } from 'ethers'
import type { JsonRpcSigner } from 'ethers'
import core4micaAbi from 'sdk-4mica/dist/abi/core4mica.json'
import * as fourMica from 'sdk-4mica'
import { TARGET_CHAIN_ID } from '../context/WalletContext'
import { config } from '../config/env'
import type { PaymentScheme } from '../utils/paymentHandler'

export const useDeposit = (
  signer: JsonRpcSigner | null,
  address: string | null,
  chainId: number | null,
  paymentScheme: PaymentScheme,
  coreParams: fourMica.CorePublicParameters | null,
  appendLog: (entry: string, tone?: 'info' | 'warn' | 'success' | 'error') => void,
  onSuccess: () => void
) => {
  const [depositLoading, setDepositLoading] = useState(false)

  const ensureAllowance = useCallback(
    async (tokenAddr: string, required: bigint, decimals: number) => {
      if (!signer || !address || !coreParams) {
        throw new Error('Wallet not ready for approval')
      }

      const erc20 = new Contract(
        tokenAddr,
        [
          'function allowance(address owner, address spender) view returns (uint256)',
          'function approve(address spender, uint256 amount) returns (bool)',
        ],
        signer
      )
      const current: bigint = await erc20.allowance(address, coreParams.contractAddress)
      if (current >= required) {
        appendLog('Existing allowance is sufficient; skipping approval.')
        return
      }

      appendLog(`Requesting token approval for ${formatUnits(required, decimals)}…`)
      const approveTx = await erc20.approve(coreParams.contractAddress, required)
      appendLog(`Approve submitted: ${approveTx.hash}`)
      const receipt = await approveTx.wait()
      appendLog(`Approve confirmed in block ${receipt?.blockNumber ?? 'unknown'}`)
    },
    [signer, address, coreParams, appendLog]
  )

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

  const handleDeposit = useCallback(
    async (depositMode: 'default' | 'custom', depositAmount: string, tokenAddress: string, tokenDecimals: string) => {
      if (!signer || !address) {
        appendLog('Connect wallet before depositing.', 'warn')
        return
      }
      if (paymentScheme !== '4mica-credit') {
        appendLog('Deposits are only needed in 4mica credit mode. Switch payment rail to deposit.', 'warn')
        return
      }
      if (!coreParams) {
        appendLog('Missing 4mica contract parameters; try again.', 'error')
        return
      }
      const requiredChainId = coreParams.chainId ?? TARGET_CHAIN_ID
      if (chainId !== requiredChainId) {
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

      if (useDefaultToken && (!defaultTokenAddress || !isAddress(defaultTokenAddress))) {
        appendLog('Default token address not configured or invalid. Please enter a token address.', 'error')
        return
      }

      if (!useDefaultToken && !tokenAddress) {
        appendLog('Enter a token address.', 'error')
        return
      }
      if (!useDefaultToken && !isAddress(tokenAddress)) {
        appendLog('Enter a valid token address.', 'error')
        return
      }

      setDepositLoading(true)
      try {
        const contract = new Contract(coreParams.contractAddress, (core4micaAbi as any).abi ?? core4micaAbi, signer)

        const tokenToUse = useDefaultToken ? defaultTokenAddress : tokenAddress
        const meta = await resolveTokenMeta(tokenToUse)

        if (!meta) {
          appendLog(
            `Invalid or non-existent token at ${tokenToUse}. Verify the address is correct and on chain ${requiredChainId}.`,
            'error'
          )
          return
        }

        const decimals = meta.decimals
        const parsedAmount = parseUnits(amount, decimals)
        const tokenLabel = meta.symbol
        appendLog(`Preparing deposit of ${formatUnits(parsedAmount, decimals)} ${tokenLabel} (${decimals} decimals)`)

        await ensureAllowance(tokenToUse, parsedAmount, decimals)

        let tx
        if (useDefaultToken) {
          tx = await contract.depositStablecoin(defaultTokenAddress, parsedAmount)
          appendLog(`Deposit submitted (USDC default): ${tx.hash}`)
        } else {
          tx = await contract.depositStablecoin(tokenAddress, parsedAmount)
          appendLog(`Deposit submitted (custom token ${tokenLabel}): ${tx.hash}`)
        }
        const receipt = await tx.wait()
        appendLog(`Deposit confirmed in block ${receipt?.blockNumber ?? 'unknown'}`)
        onSuccess()
      } catch (err) {
        appendLog(`Deposit failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
      } finally {
        setDepositLoading(false)
      }
    },
    [signer, address, paymentScheme, coreParams, chainId, appendLog, ensureAllowance, resolveTokenMeta, onSuccess]
  )

  return { depositLoading, handleDeposit }
}
