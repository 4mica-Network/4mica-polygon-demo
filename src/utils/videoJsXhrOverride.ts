import { config } from '../config/env'
import type { XhrUriConfig } from 'xhr'

type XhrCallback = (error: any, response: any, body: any) => void

type PaymentHandler = (response: any, options: XhrUriConfig, body?: any) => Promise<string>

export const setupXhrOverride = (paymentHandler: PaymentHandler, player: any): void => {
  console.log('[x402] Overriding VHS XHR...')

  const originalXhr = player.tech().vhs.xhr
  if (!originalXhr) {
    console.error('Original XHR not found')
    return
  }

  const customXhr = function (options: XhrUriConfig, callback: XhrCallback) {
    console.log('[x402] original XHR called', { uri: options.uri })
    let modifiedOptions: XhrUriConfig
    if (options.uri) {
      const encodedUrl = encodeURIComponent(options.uri)
      modifiedOptions = {
        ...options,
        uri: `${config.streamServerUrl}/stream/remote?url=${encodedUrl}`,
      }
      console.log('[x402] rewrote URI to stream proxy', { original: options.uri, proxied: modifiedOptions.uri })
    } else {
      modifiedOptions = options
    }

    const customCallback: XhrCallback = (error, response, body) => {
      if (!response) {
        return callback(error, response, body)
      }

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

      if (response.status === 402) {
        console.log('[x402] 402 Payment Required. Handling payment...', { uri: options.uri })

        paymentHandler(response, options, body)
          .then(paymentHeader => {
            modifiedOptions.headers = modifiedOptions.headers || {}
            modifiedOptions.headers['x-payment'] = paymentHeader
            console.log('[x402] retrying with x-payment header', {
              uri: modifiedOptions.uri,
              hasHeader: Boolean(paymentHeader),
            })

            originalXhr(modifiedOptions, callback)
          })
          .catch(err => {
            console.error('[x402] Payment failed', err)
            callback(error || err, response, body)
          })

        return
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
