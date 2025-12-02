import { PaymentRequirements } from 'sdk-4mica'
import { signPaymentHeader } from './paymentClient'

type XhrOptions = {
  uri?: string
  headers?: Record<string, string>
  [key: string]: any
}

type Response = {
  headers?: Record<string, string>
  statusCode?: number
  body?: unknown
  response?: unknown
  responseText?: unknown
  text?: unknown
  [key: string]: any
}

const parseJsonBody = (response: Response): Record<string, unknown> | null => {
  const candidates = [response?.body, response?.response, response?.responseText, response?.text]

  for (const value of candidates) {
    if (!value) continue
    if (typeof value === 'object') {
      return value as Record<string, unknown>
    }
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as Record<string, unknown>
      } catch {
        continue
      }
    }
  }

  return null
}

export const handlePayment = async (response: Response, _options: XhrOptions): Promise<string> => {
  const json = parseJsonBody(response)

  if (!json || !Array.isArray((json as { accepts?: unknown }).accepts)) {
    throw new Error('Payment requirements missing from 402 response')
  }

  const accepts = (json as { accepts: unknown[] }).accepts
  const rawRequirement =
    accepts.find(
      (candidate: any) =>
        candidate &&
        typeof candidate.scheme === 'string' &&
        candidate.scheme.toLowerCase().includes('4mica')
    ) ?? accepts[0]

  if (!rawRequirement) {
    throw new Error('No acceptable payment requirement found in 402 response')
  }

  const requirements = PaymentRequirements.fromRaw(rawRequirement as Record<string, unknown>)

  return signPaymentHeader(requirements)
}
