import { ConfigBuilder, PaymentRequirements, RpcProxy, X402Flow } from 'sdk-4mica'
import { CorePublicParameters, PaymentSigner, SigningScheme } from 'sdk-4mica'
import { config } from '../config/env'
import { Wallet } from 'ethers'

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

let flow: X402Flow | null = null
let userAddress: string | null = null
let params: CorePublicParameters | null = null
let signer: PaymentSigner | null = null

const boundFetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const f = globalThis.fetch as any
  if (typeof f !== 'function') {
    throw new Error('global fetch not available')
  }
  return f.call(globalThis, input, init)
}

const buildFlow = async () => {
  if (flow && userAddress) return { flow, userAddress }
  if (!config.walletPrivateKey) {
    throw new Error('Wallet private key missing; set VITE_WALLET_PRIVATE_KEY')
  }
  const wallet = new Wallet(config.walletPrivateKey)
  userAddress = wallet.address
  const cfg = new ConfigBuilder()
    .walletPrivateKey(config.walletPrivateKey)
    .rpcUrl(config.rpcUrl)
    .build()

  // Use a fetch bound to globalThis to avoid "fetch called on non-Window" issues
  const rpc = new RpcProxy(cfg.rpcUrl, cfg.adminApiKey, boundFetch as any)
  params = await rpc.getPublicParams()
  signer = new PaymentSigner(cfg.walletPrivateKey)

  const flowSigner = {
    signPayment: (claims: any, scheme: SigningScheme) => signer!.signRequest(params!, claims, scheme),
  }

  flow = new X402Flow(flowSigner as any, boundFetch as any)
  console.log('[x402] initialized flow for', userAddress, 'rpc=', cfg.rpcUrl)
  return { flow, userAddress }
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

export const handlePayment = async (
  response: Response,
  options: XhrOptions,
  body?: any
): Promise<string> => {
  console.log('[x402] handlePayment: received 402')
  const rawRequirements = await getPaymentRequirements(response, options, body)
  const requirements = withFixedTabEndpoint(rawRequirements)
  console.log('[x402] parsed requirements', requirements)

  const { flow, userAddress } = await buildFlow()
  console.log('[x402] signing payment for user', userAddress)
  const signed = await flow.signPayment(requirements, userAddress)
  console.log('[x402] signed payment header length', signed.header.length)

  return signed.header
}
