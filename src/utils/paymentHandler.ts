import * as fourMica from 'sdk-4mica'
import { config } from '../config/env'
import { Signer, Wallet, AbiCoder, getBytes, JsonRpcProvider } from 'ethers'

type XhrOptions = {
  uri?: string
  [key: string]: any
}

type Response = {
  headers?: Record<string, string>
  body?: any
  [key: string]: any
}

type PaymentRequiredResponse = {
  x402Version: number
  accepts: unknown[]
  error?: string | null
}

const { PaymentRequirements, RpcProxy, X402Flow, CorePublicParameters, SigningScheme, PaymentGuaranteeRequestClaims } = fourMica

type SignerResolver = () => Promise<Signer | null>

let params: CorePublicParameters | null = null
let rpcProxy: RpcProxy | null = null

const boundFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const f = globalThis.fetch as any
  if (typeof f !== 'function') {
    throw new Error('global fetch not available')
  }
  return f.call(globalThis, input, init)
}

const ensureParams = async (): Promise<CorePublicParameters> => {
  if (params) return params
  if (!rpcProxy) {
    rpcProxy = new RpcProxy(config.rpcUrl, undefined, boundFetch as any)
  }
  params = await rpcProxy.getPublicParams()
  return params
}

const buildTypedMessage = (publicParams: CorePublicParameters, claims: PaymentGuaranteeRequestClaims) => ({
  types: {
    EIP712Domain: [
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
    ],
    SolGuaranteeRequestClaimsV1: [
      { name: 'user', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'tabId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'asset', type: 'address' },
      { name: 'timestamp', type: 'uint64' },
    ],
  },
  primaryType: 'SolGuaranteeRequestClaimsV1',
  domain: {
    name: publicParams.eip712Name,
    version: publicParams.eip712Version,
    chainId: publicParams.chainId,
  },
  message: {
    user: claims.userAddress,
    recipient: claims.recipientAddress,
    tabId: BigInt(claims.tabId),
    amount: BigInt(claims.amount),
    asset: claims.assetAddress,
    timestamp: BigInt(claims.timestamp),
  },
})

const encodeEip191 = (claims: PaymentGuaranteeRequestClaims): Uint8Array => {
  const payload = AbiCoder.defaultAbiCoder().encode(
    ['address', 'address', 'uint256', 'uint256', 'address', 'uint64'],
    [
      claims.userAddress,
      claims.recipientAddress,
      claims.tabId,
      claims.amount,
      claims.assetAddress,
      claims.timestamp,
    ]
  )
  return getBytes(payload)
}

const resolveSigner = async (
  getWalletSigner: SignerResolver,
  params: CorePublicParameters
): Promise<{ signer: Signer; address: string; source: 'wallet' | 'env' }> => {
  const envKey = config.walletPrivateKey?.trim()
  if (envKey) {
    try {
      const rpcUrl = params.ethereumHttpRpcUrl || undefined
      const provider = rpcUrl ? new JsonRpcProvider(rpcUrl) : undefined
      const envSigner = provider ? new Wallet(envKey, provider) : new Wallet(envKey)
      const address = await envSigner.getAddress()
      return { signer: envSigner, address, source: 'env' }
    } catch (err) {
      console.warn('[x402] env signer init failed', err)
    }
  }

  const walletSigner = await getWalletSigner()
  if (walletSigner) {
    const address = await walletSigner.getAddress()
    return { signer: walletSigner, address, source: 'wallet' }
  }

  throw new Error('No signer available. Add VITE_WALLET_PRIVATE_KEY or connect a wallet.')
}

const buildFlow = async (getWalletSigner: SignerResolver) => {
  const publicParams = await ensureParams()
  const { signer, address, source } = await resolveSigner(getWalletSigner, publicParams)

  const flowSigner = {
    signPayment: async (claims: PaymentGuaranteeRequestClaims, scheme: SigningScheme) => {
      const normalizedAddress = address.toLowerCase()
      if (normalizedAddress !== claims.userAddress.toLowerCase()) {
        throw new Error(`Signer address mismatch. Wallet=${address}, claims.userAddress=${claims.userAddress}`)
      }

      const network = await signer.provider?.getNetwork?.()
      if (network && Number(network.chainId) !== Number(publicParams.chainId)) {
        throw new Error(`Wrong network. Switch wallet to chain ${publicParams.chainId}. Current: ${network.chainId}`)
      }

      if (scheme === SigningScheme.EIP712) {
        const typed = buildTypedMessage(publicParams, claims)
        const signature = await (signer as any).signTypedData(
          typed.domain,
          { SolGuaranteeRequestClaimsV1: typed.types.SolGuaranteeRequestClaimsV1 },
          typed.message
        )
        return { signature, scheme }
      }

      if (scheme === SigningScheme.EIP191) {
        const message = encodeEip191(claims)
        const signature = await signer.signMessage(message)
        return { signature, scheme }
      }

      throw new Error(`Unsupported signing scheme: ${scheme}`)
    },
  }

  const flow = new X402Flow(flowSigner as any, boundFetch as any)
  console.log('[x402] initialized flow for', address, 'rpc=', config.rpcUrl, 'source=', source)
  return { flow, userAddress: address }
}

const parseRequirements = (raw: string): PaymentRequirements => {
  const parsed: PaymentRequiredResponse = JSON.parse(raw)
  if (!Array.isArray(parsed.accepts) || parsed.accepts.length === 0) {
    throw new Error('paymentRequirements missing from 402 response')
  }
  const preferred =
    parsed.accepts.find(
      r => typeof r === 'object' && r !== null && 'scheme' in (r as any) && String((r as any).scheme).toLowerCase().includes('4mica')
    ) ?? parsed.accepts[0]
  return PaymentRequirements.fromRaw(preferred as Record<string, unknown>)
}

const coerceBodyText = (response: Response, body?: any): string | null => {
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(body))
  if (Array.isArray(body)) return body.join('')
  if (typeof response.body === 'string') return response.body
  if (response.body instanceof Uint8Array) return new TextDecoder().decode(response.body)
  if (response.body instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(response.body))
  try {
    const rt = (response as any).responseText
    if (typeof rt === 'string') return rt
  } catch {
    // ignore
  }
  return null
}

const fetchBodyText = async (url: string): Promise<string | null> => {
  // First try fetch bound to globalThis
  try {
    const res = await boundFetch(url, { method: 'GET' })
    return await res.text()
  } catch (err) {
    console.warn('[x402] fetch body failed', err)
  }

  // Fallback to XHR
  return await new Promise(resolve => {
    try {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', url, true)
      xhr.onreadystatechange = function () {
        if (xhr.readyState === XMLHttpRequest.DONE) {
          resolve(xhr.responseText || null)
        }
      }
      xhr.onerror = function () {
        resolve(null)
      }
      xhr.send()
    } catch (err) {
      console.warn('[x402] XHR body failed', err)
      resolve(null)
    }
  })
}

const getPaymentRequirements = async (response: Response, options: XhrOptions, body?: any) => {
  const inline = coerceBodyText(response, body)
  if (inline) return parseRequirements(inline)

  const url =
    (response as any)._proxiedUri ??
    (response as any).responseURL ??
    (response as any).url ??
    options.uri
  if (!url) throw new Error('No payment details found in 402 response')

  console.log('[x402] refetching 402 body from', url)
  const fetched = await fetchBodyText(url)
  if (!fetched) {
    throw new Error('No payment details found in 402 response')
  }
  return parseRequirements(fetched)
}

const withFixedTabEndpoint = (requirements: PaymentRequirements): PaymentRequirements => {
  const extra = { ...(requirements.extra ?? {}) }
  const current = extra.tabEndpoint ?? extra.tab_endpoint
  const desiredBase = config.streamServerUrl.replace(/\/$/, '')
  const desired = `${desiredBase}/tab`

  let needsFix = false
  if (!current || typeof current !== 'string') {
    needsFix = true
  } else {
    try {
      const currUrl = new URL(current)
      const desiredUrl = new URL(desired)
      if (currUrl.host !== desiredUrl.host || currUrl.protocol !== desiredUrl.protocol) {
        needsFix = true
      }
    } catch {
      needsFix = true
    }
  }

  if (needsFix) {
    extra.tabEndpoint = desired
    requirements.extra = extra
    console.log('[x402] tabEndpoint adjusted to stream server', desired)
  }
  return requirements
}

export const createPaymentHandler =
  (getWalletSigner: SignerResolver) =>
  async (response: Response, options: XhrOptions, body?: any): Promise<string> => {
    console.log('[x402] handlePayment: received 402')
    const rawRequirements = await getPaymentRequirements(response, options, body)
    const requirements = withFixedTabEndpoint(rawRequirements)
    console.log('[x402] parsed requirements', requirements)

    const { flow, userAddress } = await buildFlow(getWalletSigner)
    console.log('[x402] signing payment for user', userAddress)
    const signed = await flow.signPayment(requirements, userAddress)
    console.log('[x402] signed payment header length', signed.header.length)

    return signed.header
  }
