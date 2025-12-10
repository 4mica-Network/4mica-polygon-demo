import { config } from '../config/env'
import type { PaymentTabInfo } from './paymentHandler'
import type { XhrUriConfig } from 'xhr'

type XhrCallback = (error: any, response: any, body: any) => void

type PaymentHandler = (
  response: any,
  options: XhrUriConfig,
  body?: any,
  onAmountReady?: (amountDisplay: string) => void
) => Promise<{ header: string; amountDisplay: string; txHash?: string; tabInfo?: PaymentTabInfo }>

export type PaymentEvents = {
  onPaymentRequested?: (chunkId: string, amount?: string) => void
  onPaymentSettled?: (chunkId: string, amount?: string, txHash?: string) => void
  onPaymentFailed?: (chunkId: string, error: unknown, amount?: string) => void
}

let paymentCounter = 0

const normalizeStatus = (responseOrRequest?: any): number | null => {
  const raw = responseOrRequest?.status ?? responseOrRequest?.statusCode
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') {
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export const setupXhrOverride = (paymentHandler: PaymentHandler, player: any, events?: PaymentEvents): void => {
  console.log('[x402] Overriding VHS XHR...')

  const originalXhr = player.tech().vhs.xhr
  if (!originalXhr) {
    console.error('Original XHR not found')
    return
  }

  const chunkMeta = new Map<string, { amount?: string; txHash?: string }>()

  const customXhr = function (options: XhrUriConfig, callback: XhrCallback) {
    console.log('[x402] original XHR called', { uri: options.uri })
    let chunkId: string | null = null
    let modifiedOptions: XhrUriConfig
    if (config.enableExternalStreaming && options.uri) {
      const encodedUrl = encodeURIComponent(options.uri)
      modifiedOptions = {
        ...options,
        uri: `${config.streamServerUrl}/stream/remote?url=${encodedUrl}`,
      }
      console.log('[x402] rewrote URI to stream proxy', { original: options.uri, proxied: modifiedOptions.uri })
    } else {
      modifiedOptions = options
    }

    let awaitingSettlement = false
    let settlementNotified = false

    const notifySettled = () => {
      if (!awaitingSettlement || settlementNotified) return
      const key = chunkId ?? `${paymentCounter}`
      const meta = chunkMeta.get(key)
      events?.onPaymentSettled?.(key, meta?.amount, meta?.txHash)
      chunkMeta.delete(key)
      awaitingSettlement = false
      settlementNotified = true
    }

    const attachEarlySettlementWatch = (req: any) => {
      if (!req) return
      const handler = () => {
        const readyState = (req as any).readyState ?? 0
        const status = normalizeStatus(req)
        if (readyState >= 2 && status !== null && status < 400) {
          notifySettled()
        }
      }

      if (typeof req.addEventListener === 'function') {
        req.addEventListener('readystatechange', handler)
        req.addEventListener('loadstart', handler)
      } else if ('onreadystatechange' in req) {
        const existing = (req as any).onreadystatechange
        ;(req as any).onreadystatechange = function (...args: any[]) {
          handler()
          if (typeof existing === 'function') {
            return existing.apply(this, args)
          }
        }
      }
    }

    const customCallback: XhrCallback = (error, response, body) => {
      if (!response) {
        return callback(error, response, body)
      }

      const status = normalizeStatus(response)

      Object.defineProperty(response, 'url', {
        value: options.uri,
        writable: true,
      })

      // Track the proxied URL so the payment handler can refetch the 402 body if needed
      if (modifiedOptions.uri) {
        Object.defineProperty(response, '_proxiedUri', {
          value: modifiedOptions.uri,
          writable: true,
        })
      }

      // Some browsers/libraries use responseURL as well
      if (response.responseURL) {
        Object.defineProperty(response, 'responseURL', {
          value: options.uri,
          writable: true,
        })
      }

      if (status === 402) {
        console.log('[x402] 402 Payment Required. Handling payment...', { uri: options.uri })
        awaitingSettlement = true
        settlementNotified = false
        chunkId = `${++paymentCounter}`
        paymentHandler(response, options, body, amountDisplay => {
          const key = chunkId ?? `${paymentCounter}`
          chunkMeta.set(key, { amount: amountDisplay })
          events?.onPaymentRequested?.(key, amountDisplay)
        })
          .then(({ header, amountDisplay, txHash }) => {
            const key = chunkId ?? `${paymentCounter}`
            const existing = chunkMeta.get(key)
            chunkMeta.set(key, { amount: existing?.amount ?? amountDisplay, txHash })
            modifiedOptions.headers = modifiedOptions.headers || {}
            modifiedOptions.headers['x-payment'] = header
            console.log('[x402] retrying with x-payment header', {
              uri: modifiedOptions.uri,
              hasHeader: Boolean(header),
            })

            const retryRequest = originalXhr(modifiedOptions, customCallback)
            attachEarlySettlementWatch(retryRequest)
          })
          .catch(err => {
            console.error('[x402] Payment failed', err)
            const key = chunkId ?? `${paymentCounter}`
            const meta = chunkMeta.get(key)
            events?.onPaymentFailed?.(key, err, meta?.amount)
            chunkMeta.delete(key)
            awaitingSettlement = false
            settlementNotified = false
            callback(error || err, response, body)
          })

        return
      }

      if (awaitingSettlement && status !== null && status < 400) {
        notifySettled()
      }

      return callback(error, response, body)
    }

    return originalXhr(modifiedOptions, customCallback)
  }

  Object.keys(originalXhr).forEach(key => {
    ;(customXhr as any)[key] = (originalXhr as any)[key]
  })
  player.tech().vhs.xhr = customXhr
}
