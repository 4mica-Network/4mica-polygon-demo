import videojs from 'video.js'

type XhrOptions = {
  uri?: string
  headers?: Record<string, string>
  [key: string]: any
}

type XhrCallback = (error: any, response: any, body: any) => void

type XhrFunction = (options: XhrOptions, callback: XhrCallback) => any

type PaymentHandler = (response: any, options: XhrOptions) => Promise<string>

export const setupXhrOverride = (paymentHandler: PaymentHandler): void => {
  const originalXhr = (videojs as any).Vhs && ((videojs as any).Vhs.xhr as XhrFunction | undefined)

  if (!originalXhr) {
    console.warn('VHS XHR not available. HLS playback may not work correctly.')
    return
  }

  const customXhr: XhrFunction = function (options: XhrOptions, callback: XhrCallback) {
    const customCallback: XhrCallback = (error, response, body) => {
      if (!response) {
        return callback(error, response, body)
      }

      if (response.statusCode === 402) {
        console.log('402 Payment Required. Handling payment...')

        paymentHandler(response, options)
          .then(newToken => {
            options = options || {}
            options.headers = options.headers || {}
            options.headers['x-payment'] = newToken

            originalXhr(options, callback)
          })
          .catch(err => {
            console.error('Payment failed', err)
            callback(error || err, response, body)
          })

        return
      }

      return callback(error, response, body)
    }

    return originalXhr(options, customCallback)
  }

  Object.keys(originalXhr).forEach(key => {
    ;(customXhr as any)[key] = (originalXhr as any)[key]
  })
  ;(videojs as any).Vhs.xhr = customXhr
}
