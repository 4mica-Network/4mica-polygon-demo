import type { PaymentRequirementsV1, PaymentRequirementsV2, X402PaymentRequired } from '@4mica/sdk'
import { config } from '../config/env'
import { Signer, formatUnits, Contract, ZeroAddress, isAddress } from 'ethers'
import { settleDirectPayment } from './exact'

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

export type PaymentTabInfo = {
  tabId: bigint
  assetAddress: string
  recipientAddress: string
  amountRaw: bigint
  amountDisplay: string
  decimals: number
  symbol: string
}

export type PaymentHeaderResult = {
  header: string
  headerName: string
  amountDisplay: string
  txHash?: string
  tabInfo?: PaymentTabInfo
}

type PaymentRequirementsType = PaymentRequirementsV1 | PaymentRequirementsV2

type PaymentSelection = {
  version: number
  requirements: PaymentRequirementsType
  schemeInfo: SchemeResolvedInfo
  paymentRequired?: X402PaymentRequired
}

type SignerResolver = () => Promise<Signer | null>

type SdkClaimsResponse = {
  userAddress: string
  recipientAddress: string
  tabId: string
  reqId: string
  amount: string
  assetAddress: string
  timestamp: number
}

type SdkSignResponse = {
  header: string
  claims?: SdkClaimsResponse
}

type CoreParamsSummary = {
  chainId?: number
}

let coreParams: CoreParamsSummary | null = null

const boundFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const f = globalThis.fetch as any
  if (typeof f !== 'function') {
    throw new Error('global fetch not available')
  }
  return f.call(globalThis, input, init)
}

const decodeBase64 = (value: string): string => {
  if (typeof atob === 'function') return atob(value)
  const buf = (globalThis as any).Buffer
  if (buf?.from) return buf.from(value, 'base64').toString('utf-8')
  throw new Error('No base64 decoder available')
}

const decodeBase64Json = <T,>(value: string): T => {
  const decoded = decodeBase64(value)
  return JSON.parse(decoded) as T
}

const getHeaderValue = (response: Response, name: string): string | null => {
  if (!response) return null
  const lower = name.toLowerCase()
  const headersObj = (response as any).headers
  if (headersObj?.get && typeof headersObj.get === 'function') {
    return headersObj.get(name) ?? headersObj.get(lower)
  }
  if (typeof (response as any).getResponseHeader === 'function') {
    return (response as any).getResponseHeader(name)
  }
  if (headersObj && typeof headersObj === 'object') {
    const direct = headersObj[name] ?? headersObj[lower]
    if (typeof direct === 'string') return direct
    for (const [key, value] of Object.entries(headersObj)) {
      if (key.toLowerCase() === lower && typeof value === 'string') return value
    }
  }
  return null
}

const signerBaseUrl = () => config.signerServiceUrl.replace(/\/+$/, '')

const ensureCoreParams = async (): Promise<CoreParamsSummary | null> => {
  if (coreParams) return coreParams
  const url = `${signerBaseUrl()}/params`
  try {
    const resp = await boundFetch(url, { method: 'GET' })
    const text = await resp.text()
    if (!resp.ok) {
      throw new Error(text || `params request failed with ${resp.status}`)
    }
    const parsed = text ? JSON.parse(text) : {}
    const payload = (parsed?.params ?? parsed) as CoreParamsSummary
    coreParams = payload
    return coreParams
  } catch (err) {
    console.warn('[x402] failed to load core params from signer service', err)
    return null
  }
}

const signWithSdkService = async (
  requirements: PaymentRequirementsType
): Promise<SdkSignResponse> => {
  const url = `${signerBaseUrl()}/x402/sign`
  const resp = await boundFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paymentRequirements: requirements }),
  })
  const text = await resp.text()
  if (!resp.ok) {
    throw new Error(text || `signing request failed with ${resp.status}`)
  }
  const data = text ? JSON.parse(text) : {}
  if (!data?.header) {
    throw new Error('Signer service returned no payment header')
  }
  return data as SdkSignResponse
}

const signWithSdkServiceV2 = async (
  paymentRequired: X402PaymentRequired,
  accepted: PaymentRequirementsV2
): Promise<SdkSignResponse> => {
  const url = `${signerBaseUrl()}/x402/sign`
  const resp = await boundFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paymentRequired, accepted }),
  })
  const text = await resp.text()
  if (!resp.ok) {
    throw new Error(text || `signing request failed with ${resp.status}`)
  }
  const data = text ? JSON.parse(text) : {}
  if (!data?.header) {
    throw new Error('Signer service returned no payment header')
  }
  return data as SdkSignResponse
}

const parseAmountRequired = (value: unknown): bigint => {
  try {
    return BigInt(value as any)
  } catch {
    return 0n
  }
}

const normalizePaymentRequirements = (raw: Record<string, unknown>): PaymentRequirementsType => {
  const normalized: Record<string, any> = { ...raw }
  if (normalized.maxAmountRequired === undefined && normalized.max_amount_required !== undefined) {
    normalized.maxAmountRequired = normalized.max_amount_required
  }
  if (normalized.amount === undefined && normalized.amount_required !== undefined) {
    normalized.amount = normalized.amount_required
  }
  if (normalized.payTo === undefined && normalized.pay_to !== undefined) {
    normalized.payTo = normalized.pay_to
  }
  if (normalized.maxTimeoutSeconds === undefined && normalized.max_timeout_seconds !== undefined) {
    normalized.maxTimeoutSeconds = normalized.max_timeout_seconds
  }
  if (normalized.mimeType === undefined && normalized.mime_type !== undefined) {
    normalized.mimeType = normalized.mime_type
  }
  if (normalized.outputSchema === undefined && normalized.output_schema !== undefined) {
    normalized.outputSchema = normalized.output_schema
  }
  if (normalized.asset === undefined && normalized.asset_address !== undefined) {
    normalized.asset = normalized.asset_address
  }
  const extraRaw = normalized.extra
  if (extraRaw && typeof extraRaw === 'object' && !Array.isArray(extraRaw)) {
    const extra: Record<string, unknown> = { ...(extraRaw as Record<string, unknown>) }
    if (extra.tabEndpoint === undefined && extra.tab_endpoint !== undefined) {
      extra.tabEndpoint = extra.tab_endpoint
    }
    normalized.extra = extra
  }
  return normalized as PaymentRequirementsType
}

const resolveAssetMeta = async (
  provider: any,
  assetAddr: string
): Promise<{ symbol: string; decimals: number; name: string; version: string } | null> => {
  if (!provider) return null
  if (!assetAddr || assetAddr.toLowerCase() === ZeroAddress.toLowerCase()) {
    return { symbol: 'POL', decimals: 18, name: 'Polygon', version: '1' }
  }
  if (!isAddress(assetAddr)) return null
  try {
    const erc20 = new Contract(
      assetAddr,
      [
        'function symbol() view returns (string)',
        'function decimals() view returns (uint8)',
        'function name() view returns (string)',
        'function version() view returns (string)',
      ],
      provider
    )
    const [symbol, decimals, name, version] = await Promise.all([
      erc20.symbol(),
      erc20.decimals(),
      erc20.name().catch(() => 'USDC'),
      erc20.version().catch(() => '2'),
    ])
    return {
      symbol: String(symbol),
      decimals: Number(decimals) || 18,
      name: String(name),
      version: String(version),
    }
  } catch {
    return null
  }
}

const formatAmountDisplay = (amount: bigint, decimals: number, symbol: string) =>
  `${formatUnits(amount, decimals)} ${symbol}`

const parseRequirementsV1 = (
  raw: string,
  preferredScheme: PaymentScheme
): { requirements: PaymentRequirementsType; schemeInfo: SchemeResolvedInfo } => {
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
    normalizedPreferred === 'x402' ? parsed.accepts.find(r => directAliases.includes(normalizeScheme(r))) : undefined
  const exact = parsed.accepts.find(matchesPreferred)
  const fallback4mica =
    normalizedPreferred === 'x402' ? undefined : parsed.accepts.find(r => normalizeScheme(r).includes('4mica'))
  const choice = (directChoice ?? exact ?? fallback4mica ?? parsed.accepts[0]) as Record<string, unknown>
  const chosen = normalizeScheme(choice) || String((choice as any).scheme ?? '')

  if (normalizedPreferred === 'x402' && !directAliases.includes(chosen)) {
    throw new Error('Direct x402 settlement not offered by server')
  }

  const schemeInfo: SchemeResolvedInfo = {
    preferred: preferredScheme,
    chosen,
    offered,
    usedFallback: !matchesPreferred(choice),
  }

  return {
    requirements: normalizePaymentRequirements(choice),
    schemeInfo,
  }
}

const parseRequirementsV2 = (
  paymentRequired: X402PaymentRequired,
  preferredScheme: PaymentScheme
): { requirements: PaymentRequirementsType; schemeInfo: SchemeResolvedInfo } => {
  if (!Array.isArray(paymentRequired.accepts) || paymentRequired.accepts.length === 0) {
    throw new Error('paymentRequirements missing from 402 response')
  }

  const normalizeScheme = (candidate: unknown) => {
    if (typeof candidate === 'object' && candidate !== null && 'scheme' in (candidate as any)) {
      const scheme = (candidate as any).scheme
      if (typeof scheme === 'string') return scheme.toLowerCase()
    }
    return ''
  }

  const offered = paymentRequired.accepts.map(normalizeScheme)
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
      ? paymentRequired.accepts.find(r => directAliases.includes(normalizeScheme(r)))
      : undefined
  const exact = paymentRequired.accepts.find(matchesPreferred)
  const fallback4mica =
    normalizedPreferred === 'x402'
      ? undefined
      : paymentRequired.accepts.find(r => normalizeScheme(r).includes('4mica'))
  const choice = (directChoice ?? exact ?? fallback4mica ?? paymentRequired.accepts[0]) as Record<string, unknown>
  const chosen = normalizeScheme(choice) || String((choice as any).scheme ?? '')

  if (normalizedPreferred === 'x402' && !directAliases.includes(chosen)) {
    throw new Error('Direct x402 settlement not offered by server')
  }

  const schemeInfo: SchemeResolvedInfo = {
    preferred: preferredScheme,
    chosen,
    offered,
    usedFallback: !matchesPreferred(choice),
  }

  return {
    requirements: normalizePaymentRequirements(choice),
    schemeInfo,
  }
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
  preferredScheme: PaymentScheme
): Promise<PaymentSelection> => {
  const paymentRequiredHeader = getHeaderValue(response, 'payment-required')
  if (paymentRequiredHeader) {
    try {
      const paymentRequired = decodeBase64Json<X402PaymentRequired>(paymentRequiredHeader)
      const { requirements, schemeInfo } = parseRequirementsV2(paymentRequired, preferredScheme)
      return {
        version: 2,
        requirements,
        schemeInfo,
        paymentRequired,
      }
    } catch (err) {
      console.warn('[x402] failed to use v2 payment-required header; falling back to body', err)
    }
  }

  const inline = coerceBodyText(response, body)
  if (inline) {
    const { requirements, schemeInfo } = parseRequirementsV1(inline, preferredScheme)
    return { version: 1, requirements, schemeInfo }
  }

  const url = (response as any)._proxiedUri ?? (response as any).responseURL ?? (response as any).url ?? options.uri
  if (!url) throw new Error('No payment details found in 402 response')

  console.log('[x402] refetching 402 body from', url)
  const fetched = await fetchBodyText(url)
  if (!fetched) {
    throw new Error('No payment details found in 402 response')
  }
  const { requirements, schemeInfo } = parseRequirementsV1(fetched, preferredScheme)
  return { version: 1, requirements, schemeInfo }
}

const withFixedTabEndpoint = (requirements: PaymentRequirementsType): PaymentRequirementsType => {
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

export const createPaymentHandler = (
  getWalletSigner: SignerResolver,
  getPreferredScheme?: PreferredSchemeResolver,
  onSchemeResolved?: (info: SchemeResolvedInfo) => void,
  onTabReady?: (tab: PaymentTabInfo) => void
) => {
  return async (
    response: Response,
    options: XhrOptions,
    body?: any,
    onAmountReady?: (amountDisplay: string) => void
  ): Promise<PaymentHeaderResult> => {
    console.log('[x402] handlePayment: received 402')

    const preferredScheme = getPreferredScheme?.() ?? '4mica-credit'

    const { version, requirements: rawRequirements, schemeInfo, paymentRequired } = await getPaymentRequirements(
      response,
      options,
      body,
      preferredScheme
    )
    onSchemeResolved?.(schemeInfo)

    const requirements = withFixedTabEndpoint(rawRequirements)
    console.log('[x402] parsed requirements', requirements)
    const scheme = String((requirements as any).scheme ?? '').toLowerCase()
    const isDirectScheme = scheme === 'x402' || scheme === 'exact'
    const headerName = version === 2 ? 'payment-signature' : 'x-payment'

    const walletSigner = await getWalletSigner()
    const signerAddress = walletSigner ? await walletSigner.getAddress() : null

    const amountValue =
      (requirements as any).maxAmountRequired ?? (requirements as any).amount ?? 0n
    const amountRaw = parseAmountRequired(amountValue)
    const assetAddr = String((requirements as any).asset ?? '')
    const payTo = String((requirements as any).payTo ?? '')
    const isDefaultAsset =
      assetAddr && config.defaultTokenAddress && assetAddr.toLowerCase() === config.defaultTokenAddress.toLowerCase()
    const explicitDecimals = Number((requirements as any)?.assetDecimals ?? (requirements as any)?.decimals)

    const assetMeta = walletSigner?.provider ? await resolveAssetMeta(walletSigner.provider, assetAddr) : null
    const decimals =
      assetMeta?.decimals ??
      (Number.isFinite(explicitDecimals) && explicitDecimals > 0 ? Number(explicitDecimals) : isDefaultAsset ? 6 : 18)
    const symbol =
      assetMeta?.symbol ??
      (isDefaultAsset && !Number.isFinite(explicitDecimals)
        ? 'USDC'
        : assetAddr
        ? assetAddr.slice(0, 6) + '…' + assetAddr.slice(-4)
        : 'POL')

    const amountDisplay = formatAmountDisplay(amountRaw, decimals, symbol)
    onAmountReady?.(amountDisplay)

    if (isDirectScheme) {
      if (version === 2) {
        throw new Error('Direct x402 settlement not supported for v2 responses')
      }
      console.log('[x402] direct settlement selected', {
        scheme,
        offered: schemeInfo.offered,
        chosen: schemeInfo.chosen,
      })
      if (!walletSigner || !signerAddress) {
        throw new Error('No signer available. Start the signer service or connect a wallet.')
      }
      const coreParams = await ensureCoreParams()
      const maxTimeoutSeconds = Number((requirements as any).maxTimeoutSeconds ?? 3600)
      const tokenName = assetMeta?.name ?? 'USDC'
      const tokenVersion = assetMeta?.version ?? '2'

      const direct = await settleDirectPayment(
        walletSigner,
        signerAddress,
        amountRaw,
        assetAddr,
        payTo,
        requirements.network,
        decimals,
        symbol,
        coreParams?.chainId,
        maxTimeoutSeconds,
        tokenName,
        tokenVersion
      )

      return {
        header: direct.paymentHeader,
        headerName,
        amountDisplay: direct.amountDisplay,
        txHash: direct.txHash,
      }
    }

    console.log('[x402] signing payment via SDK service')

    if (version === 2 && !paymentRequired) {
      throw new Error('Missing paymentRequired details for v2 signing')
    }

    const signed =
      version === 2
        ? await signWithSdkServiceV2(
            paymentRequired as X402PaymentRequired,
            requirements as PaymentRequirementsV2
          )
        : await signWithSdkService(requirements)
    try {
      if (typeof atob === 'function') {
        const decoded = atob(signed.header)
        console.log('[x402] signed header payload', decoded)
      } else {
        console.warn('[x402] atob not available for decoding signed header')
      }
    } catch (err) {
      console.warn('[x402] failed to decode signed header payload', err)
    }
    console.log('[x402] signed payment header length', signed.header.length)

    let tabInfo: PaymentTabInfo | undefined
    if (signed.claims) {
      tabInfo = {
        tabId: BigInt(signed.claims.tabId),
        assetAddress: signed.claims.assetAddress,
        recipientAddress: signed.claims.recipientAddress,
        amountRaw,
        amountDisplay,
        decimals,
        symbol,
      }
      onTabReady?.(tabInfo)
    }

    return { header: signed.header, headerName, amountDisplay, tabInfo }
  }
}
