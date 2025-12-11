import { Signer, isAddress, ZeroAddress, formatUnits } from 'ethers'

type TransferAuthorizationParams = {
  from: string
  to: string
  value: string
  validAfter: number
  validBefore: number
  nonce: string
}

type ExactPaymentPayload = {
  x402Version: number
  scheme: string
  network: string
  payload: {
    signature: string
    authorization: TransferAuthorizationParams & { asset: string }
  }
}

const createNonce = (): string => {
  const cryptoObj =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function'
      ? globalThis.crypto
      : require('crypto').webcrypto
  const randomBytes = cryptoObj.getRandomValues(new Uint8Array(32))
  let hex = '0x'
  for (let i = 0; i < randomBytes.length; i++) {
    hex += randomBytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

const signTransferAuthorization = async (
  signer: Signer,
  params: TransferAuthorizationParams,
  assetAddress: string,
  chainId: number,
  tokenName?: string,
  tokenVersion?: string
): Promise<string> => {
  const domain = {
    name: tokenName,
    version: tokenVersion,
    chainId,
    verifyingContract: assetAddress,
  }

  const types = {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  }

  const message = {
    from: params.from,
    to: params.to,
    value: params.value,
    validAfter: params.validAfter,
    validBefore: params.validBefore,
    nonce: params.nonce,
  }

  const signature = await signer.signTypedData(domain, types, message)
  return signature
}

const encodeBase64Payload = (payload: unknown): string => {
  console.log('[x402] encoding exact payment payload', payload)

  const json = JSON.stringify(payload)
  if (typeof btoa === 'function') return btoa(json)

  const buf = (globalThis as any).Buffer
  if (buf?.from) return buf.from(json, 'utf-8').toString('base64')

  throw new Error('No base64 encoder available')
}

const createExactPaymentHeader = async (
  signer: Signer,
  from: string,
  to: string,
  value: string,
  assetAddress: string,
  network: string,
  chainId: number,
  maxTimeoutSeconds: number = 3600,
  tokenName?: string,
  tokenVersion?: string
): Promise<string> => {
  const nonce = createNonce()
  const validAfter = Math.floor(Date.now() / 1000) - 600
  const validBefore = Math.floor(Date.now() / 1000) + maxTimeoutSeconds

  const authorizationParams: TransferAuthorizationParams = {
    from,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
  }

  const signature = await signTransferAuthorization(
    signer,
    authorizationParams,
    assetAddress,
    chainId,
    tokenName,
    tokenVersion
  )

  const payload: ExactPaymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network,
    payload: {
      signature,
      authorization: {
        ...authorizationParams,
        asset: assetAddress,
      },
    },
  }

  return encodeBase64Payload(payload)
}

export const settleDirectPayment = async (
  signer: Signer,
  from: string,
  amountRaw: bigint,
  assetAddr: string,
  payTo: string,
  network: string,
  decimals: number,
  symbol: string,
  expectedChainId?: number,
  maxTimeoutSeconds?: number,
  tokenName?: string,
  tokenVersion?: string
): Promise<{ paymentHeader: string; amountDisplay: string; txHash?: string }> => {
  if (!signer.provider) {
    throw new Error('Wallet provider unavailable for direct payment')
  }

  const networkObj = await signer.provider.getNetwork()
  const chainId = Number(networkObj.chainId)
  if (expectedChainId && chainId !== Number(expectedChainId)) {
    throw new Error(`Wrong network ${chainId}; expected ${expectedChainId}`)
  }

  if (!payTo || !isAddress(payTo)) {
    throw new Error('Invalid recipient in payment requirements')
  }
  if (amountRaw <= 0n) {
    throw new Error('Payment amount must be greater than zero')
  }

  const isNative = !assetAddr || assetAddr.toLowerCase() === ZeroAddress.toLowerCase()
  if (isNative) {
    const tx = await signer.sendTransaction({ to: payTo, value: amountRaw })
    const receipt = await tx.wait(2)
    const txHash = receipt?.hash ?? tx.hash
    console.log('[x402] direct native payment sent', { txHash, to: payTo, amount: amountRaw.toString() })

    const nativePayload = {
      x402Version: 1,
      scheme: 'exact',
      network,
      payload: {
        txHash,
        payTo,
        asset: assetAddr || ZeroAddress,
        amount: amountRaw.toString(),
      },
    }
    const paymentHeader = encodeBase64Payload(nativePayload)

    return {
      paymentHeader,
      amountDisplay: `${formatUnits(amountRaw, decimals)} ${symbol}`,
      txHash,
    }
  }

  if (!isAddress(assetAddr)) {
    throw new Error('Invalid asset address in payment requirements')
  }

  const paymentHeader = await createExactPaymentHeader(
    signer,
    from,
    payTo,
    amountRaw.toString(),
    assetAddr,
    network,
    chainId,
    maxTimeoutSeconds,
    tokenName,
    tokenVersion
  )

  console.log('[x402] ERC20 payment authorization signed', {
    from,
    to: payTo,
    amount: amountRaw.toString(),
    asset: assetAddr,
    network,
  })

  return {
    paymentHeader,
    amountDisplay: `${formatUnits(amountRaw, decimals)} ${symbol}`,
  }
}
