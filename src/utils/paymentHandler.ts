import * as fourMica from 'sdk-4mica'
import { config } from '../config/env'
import { Signer, Wallet, AbiCoder, getBytes, JsonRpcProvider, formatUnits, Contract, ZeroAddress, isAddress } from 'ethers'

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

export type PaymentScheme = '4mica-credit' | 'x402'
type PreferredSchemeResolver = () => PaymentScheme
export type SchemeResolvedInfo = {
  preferred: PaymentScheme
  chosen: string
  offered: string[]
  usedFallback: boolean
}

const { PaymentRequirements, RpcProxy, X402Flow, CorePublicParameters, SigningScheme, PaymentGuaranteeRequestClaims, X402PaymentEnvelope } =
  fourMica

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

const parseAmountRequired = (value: unknown): bigint => {
  try {
    return BigInt(value as any)
  } catch {
    return 0n
  }
}

const resolveAssetMeta = async (
  provider: any,
  assetAddr: string
): Promise<{ symbol: string; decimals: number } | null> => {
  if (!provider) return null
  if (!assetAddr || assetAddr.toLowerCase() === ZeroAddress.toLowerCase()) {
    return { symbol: 'POL', decimals: 18 }
  }
  if (!isAddress(assetAddr)) return null
  try {
    const erc20 = new Contract(
      assetAddr,
      ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'],
      provider
    )
    const [symbol, decimals] = await Promise.all([erc20.symbol(), erc20.decimals()])
    return { symbol: String(symbol), decimals: Number(decimals) || 18 }
  } catch {
    return null
  }
}

const formatAmountDisplay = (amount: bigint, decimals: number, symbol: string) =>
  `${formatUnits(amount, decimals)} ${symbol}`

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
  return { flow, userAddress: address, signer, publicParams }
}

const encodeBase64Payload = (payload: unknown): string => {
  const json = JSON.stringify(payload)
  if (typeof btoa === 'function') return btoa(json)
  const buf = (globalThis as any).Buffer
  if (buf?.from) return buf.from(json, 'utf-8').toString('base64')
  throw new Error('No base64 encoder available')
}

const parseRequirements = (
  raw: string,
  preferredScheme: PaymentScheme,
  onSchemeResolved?: (info: SchemeResolvedInfo) => void
): PaymentRequirements => {
  const parsed: PaymentRequiredResponse = JSON.parse(raw)
  if (!Array.isArray(parsed.accepts) || parsed.accepts.length === 0) {
    throw new Error('paymentRequirements missing from 402 response')
  }

  const normalizeScheme = (candidate: unknown) => {
    if (typeof candidate === 'object' && candidate !== null && 'scheme' in (candidate as any)) {
      const scheme = (candidate as any).scheme
      if (typeof scheme === 'string') return scheme.toLowerCase()
    }
    return ''
  }

  const offered = parsed.accepts.map(normalizeScheme)
  const normalizedPreferred = preferredScheme.toLowerCase()
  const directAliases = ['x402', 'exact']
  const matchesPreferred = (candidate: unknown) => {
    const scheme = normalizeScheme(candidate)
    if (!scheme) return false
    if (scheme === normalizedPreferred) return true
    if (normalizedPreferred === 'x402' && directAliases.includes(scheme)) return true
    return false
  }
  const directChoice =
    normalizedPreferred === 'x402'
      ? parsed.accepts.find(r => directAliases.includes(normalizeScheme(r)))
      : undefined
  const exact = parsed.accepts.find(matchesPreferred)
  const fallback4mica =
    normalizedPreferred === 'x402' ? undefined : parsed.accepts.find(r => normalizeScheme(r).includes('4mica'))
  const choice = (directChoice ?? exact ?? fallback4mica ?? parsed.accepts[0]) as Record<string, unknown>
  const chosen = normalizeScheme(choice) || String((choice as any).scheme ?? '')

  if (normalizedPreferred === 'x402' && !directAliases.includes(chosen)) {
    throw new Error('Direct x402 settlement not offered by server')
  }

  onSchemeResolved?.({
    preferred: preferredScheme,
    chosen,
    offered,
    usedFallback: !matchesPreferred(choice),
  })

  return PaymentRequirements.fromRaw(choice)
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

const getPaymentRequirements = async (
  response: Response,
  options: XhrOptions,
  body: any,
  preferredScheme: PaymentScheme,
  onSchemeResolved?: (info: SchemeResolvedInfo) => void
) => {
  const inline = coerceBodyText(response, body)
  if (inline) return parseRequirements(inline, preferredScheme, onSchemeResolved)

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
  return parseRequirements(fetched, preferredScheme, onSchemeResolved)
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

const settleDirectPayment = async (
  signer: Signer,
  amountRaw: bigint,
  assetAddr: string,
  payTo: string,
  decimals: number,
  symbol: string,
  expectedChainId?: number
): Promise<{ txHash: string; amountDisplay: string }> => {
  if (!signer.provider) {
    throw new Error('Wallet provider unavailable for direct payment')
  }

  const network = await signer.provider.getNetwork()
  if (expectedChainId && Number(network.chainId) !== Number(expectedChainId)) {
    throw new Error(`Wrong network ${network.chainId}; expected ${expectedChainId}`)
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
    console.log('[x402] direct native payment sent', { txHash: tx.hash, to: payTo, amount: amountRaw.toString() })
    return {
      txHash: receipt?.hash ?? tx.hash,
      amountDisplay: formatAmountDisplay(amountRaw, decimals, symbol),
    }
  }

  if (!isAddress(assetAddr)) {
    throw new Error('Invalid asset address in payment requirements')
  }

  const erc20 = new Contract(assetAddr, ['function transfer(address,uint256) returns (bool)'], signer)
  const tx = await erc20.transfer(payTo, amountRaw)
  const receipt = await tx.wait(2)
  console.log('[x402] direct ERC20 payment sent', {
    txHash: receipt?.hash ?? tx.hash,
    to: payTo,
    amount: amountRaw.toString(),
    asset: assetAddr,
  })
  return {
    txHash: receipt?.hash ?? tx.hash,
    amountDisplay: formatAmountDisplay(amountRaw, decimals, symbol),
  }
}

export const createPaymentHandler =
  (
    getWalletSigner: SignerResolver,
    getPreferredScheme?: PreferredSchemeResolver,
    onSchemeResolved?: (info: SchemeResolvedInfo) => void
  ) =>
  async (
    response: Response,
    options: XhrOptions,
    body?: any,
    onAmountReady?: (amountDisplay: string) => void
  ): Promise<{ header: string; amountDisplay: string; txHash?: string }> => {
    console.log('[x402] handlePayment: received 402')
    const preferredScheme = getPreferredScheme?.() ?? '4mica-credit'
    let resolvedSchemeInfo: SchemeResolvedInfo | null = null
    const rawRequirements = await getPaymentRequirements(response, options, body, preferredScheme, info => {
      resolvedSchemeInfo = info
      onSchemeResolved?.(info)
    })
    const requirements = withFixedTabEndpoint(rawRequirements)
    console.log('[x402] parsed requirements', requirements)
    const scheme = String((requirements as any).scheme ?? '').toLowerCase()
    const isDirectScheme = scheme === 'x402' || scheme === 'exact'

    const { flow, userAddress, signer, publicParams } = await buildFlow(getWalletSigner)
    const amountRaw = parseAmountRequired((requirements as any).maxAmountRequired ?? 0n)
    const assetAddr = String((requirements as any).asset ?? '')
    const payTo = String((requirements as any).payTo ?? '')
    const isDefaultAsset =
      assetAddr &&
      config.defaultTokenAddress &&
      assetAddr.toLowerCase() === config.defaultTokenAddress.toLowerCase()
    const explicitDecimals = Number((requirements as any)?.assetDecimals ?? (requirements as any)?.decimals)
    const assetMeta = signer.provider ? await resolveAssetMeta(signer.provider, assetAddr) : null
    const decimals =
      assetMeta?.decimals ??
      (Number.isFinite(explicitDecimals) && explicitDecimals > 0 ? Number(explicitDecimals) : isDefaultAsset ? 6 : 18)
    const symbol =
      assetMeta?.symbol ??
      (requirements as any)?.assetSymbol ??
      (isDefaultAsset && !Number.isFinite(explicitDecimals)
        ? 'USDC'
        : assetAddr
          ? assetAddr.slice(0, 6) + '…' + assetAddr.slice(-4)
          : 'POL')
    const amountDisplay = formatAmountDisplay(amountRaw, decimals, symbol)
    onAmountReady?.(amountDisplay)

    if (isDirectScheme) {
      console.log('[x402] direct settlement selected', {
        scheme,
        offered: resolvedSchemeInfo?.offered,
        chosen: resolvedSchemeInfo?.chosen,
      })
      const direct = await settleDirectPayment(
        signer,
        amountRaw,
        assetAddr,
        payTo,
        decimals,
        symbol,
        publicParams?.chainId
      )
      const envelope = new X402PaymentEnvelope(1, 'exact', requirements.network, {
        txHash: direct.txHash,
        payTo,
        asset: assetAddr,
        amount: amountRaw.toString(),
      })
      const header = encodeBase64Payload(envelope.toPayload())
      return { header, amountDisplay: direct.amountDisplay, txHash: direct.txHash }
    }

    console.log('[x402] signing payment for user', userAddress)
    const signed = await flow.signPayment(requirements, userAddress)
    console.log('[x402] signed payment header length', signed.header.length)

    return { header: signed.header, amountDisplay }
  }
