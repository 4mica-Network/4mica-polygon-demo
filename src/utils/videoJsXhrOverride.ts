import { config } from '../config/env'
import type { XhrUriConfig } from 'xhr'

type XhrCallback = (error: any, response: any, body: any) => void

type PaymentHandler = (response: any, options: XhrUriConfig) => Promise<string>

export const setupXhrOverride = (paymentHandler: PaymentHandler, player: any): void => {
  console.log('Overriding VHS XHR...')

  const originalXhr = player.tech().vhs.xhr
  if (!originalXhr) {
    console.error('Original XHR not found')
    return
  }

  const customXhr = function (options: XhrUriConfig, callback: XhrCallback) {
    let modifiedOptions: XhrUriConfig
    if (options.uri) {
      const encodedUrl = encodeURIComponent(options.uri)
      modifiedOptions = {
        ...options,
        uri: `${config.streamServerUrl}/stream/remote?url=${encodedUrl}`,
      }
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

      // Some browsers/libraries use responseURL as well
      if (response.responseURL) {
        Object.defineProperty(response, 'responseURL', {
          value: options.uri,
          writable: true,
        })
      }

      if (response.status === 402) {
        console.log('402 Payment Required. Handling payment...')

        paymentHandler(response, options)
          .then(paymentHeader => {
            modifiedOptions.headers = modifiedOptions.headers || {}
            modifiedOptions.headers['x-payment'] = paymentHeader

            originalXhr(modifiedOptions, callback)
          })
          .catch(err => {
            console.error('Payment failed', err)
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
