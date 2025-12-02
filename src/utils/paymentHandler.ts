type XhrOptions = {
  uri?: string
  [key: string]: any
}

type Response = {
  headers?: Record<string, string>
  [key: string]: any
}

export const handlePayment = async (response: Response, options: XhrOptions): Promise<string> => {
  throw new Error('Payment handler not implemented')
}
