import { AbstractSigner, JsonRpcProvider, TransactionRequest, TypedDataDomain, TypedDataField, getBytes, hexlify, isHexString } from 'ethers'

type TypedDataTypes = Record<string, TypedDataField[]>

type SignResponse = {
  signature: string
  scheme: string
}

export class RemoteSigner extends AbstractSigner {
  private readonly baseUrl: string
  private readonly authToken?: string
  private readonly addressValue: string

  constructor(address: string, serviceUrl: string, provider?: JsonRpcProvider, authToken?: string) {
    super(provider)
    this.baseUrl = serviceUrl.replace(/\/+$/, '')
    this.authToken = authToken
    this.addressValue = address
  }

  connect(provider: JsonRpcProvider) {
    return new RemoteSigner(this.addressValue, this.baseUrl, provider, this.authToken)
  }

  async getAddress(): Promise<string> {
    return this.addressValue
  }

  private async request(path: string, payload: Record<string, unknown>): Promise<SignResponse> {
    const jsonBody = JSON.stringify(payload, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    )

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`
    }

    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: jsonBody,
    })

    const text = await resp.text()
    let parsed: any = {}
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = { error: text }
      }
    }

    if (!resp.ok) {
      const message = parsed?.error || resp.statusText || 'Remote signer error'
      throw new Error(String(message))
    }

    if (!parsed?.signature || typeof parsed.signature !== 'string') {
      throw new Error('Remote signer returned invalid signature payload')
    }

    return parsed as SignResponse
  }

  protected async _signTypedData(domain: TypedDataDomain, types: TypedDataTypes, value: Record<string, any>): Promise<string> {
    const { signature } = await this.request('/sign/typed', { domain, types, message: value })
    return signature
  }

  async signTypedData(domain: TypedDataDomain, types: TypedDataTypes, value: Record<string, any>): Promise<string> {
    return this._signTypedData(domain, types, value)
  }

  protected async _signMessage(message: string | Uint8Array): Promise<string> {
    const hex = isHexString(message) ? (message as string) : hexlify(getBytes(message))
    const { signature } = await this.request('/sign/message', { message: hex })
    return signature
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    return this._signMessage(message)
  }

  protected async _signTransaction(_tx: TransactionRequest): Promise<string> {
    throw new Error('RemoteSigner cannot sign transactions locally.')
  }

  async sendTransaction(_tx: TransactionRequest): Promise<any> {
    throw new Error('RemoteSigner cannot send transactions locally.')
  }
}
