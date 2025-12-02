import { Client, ConfigBuilder, PaymentRequirements, X402Flow } from 'sdk-4mica'
import { config } from '../config/env'

let clientPromise: Promise<Client> | null = null
let flowPromise: Promise<X402Flow> | null = null

const buildClient = async (): Promise<Client> => {
  if (!config.walletPrivateKey) {
    throw new Error('Missing VITE_WALLET_PRIVATE_KEY for 4Mica payments')
  }

  const builder = new ConfigBuilder().walletPrivateKey(config.walletPrivateKey)

  if (config.rpcUrl) {
    builder.rpcUrl(config.rpcUrl)
  }

  return Client.new(builder.build())
}

export const getClient = async (): Promise<Client> => {
  if (!clientPromise) {
    clientPromise = buildClient().catch(err => {
      clientPromise = null
      throw err
    })
  }

  return clientPromise
}

const buildFlow = async (): Promise<X402Flow> => {
  const client = await getClient()
  return X402Flow.fromClient(client)
}

export const getPaymentFlow = async (): Promise<{ flow: X402Flow; userAddress: string }> => {
  if (!flowPromise) {
    flowPromise = buildFlow().catch(err => {
      flowPromise = null
      throw err
    })
  }

  const [flow, client] = await Promise.all([flowPromise, getClient()])
  const userAddress = client.gateway.wallet.address
  return { flow, userAddress }
}

export const signPaymentHeader = async (
  requirements: PaymentRequirements,
  userAddress?: string
): Promise<string> => {
  const { flow, userAddress: derivedAddress } = await getPaymentFlow()
  const address = userAddress ?? derivedAddress
  const payment = await flow.signPayment(requirements, address)
  return payment.header
}
