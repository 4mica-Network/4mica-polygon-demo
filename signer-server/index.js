import 'dotenv/config'
import { createServer } from 'node:http'
import { JsonRpcProvider, Wallet, Contract, getBytes, isHexString, isAddress } from 'ethers'
import { Client, ConfigBuilder } from 'sdk-4mica'

const {
  SIGNER_PRIVATE_KEY,
  SIGNER_RPC_URL,
  SIGNER_CORE_RPC_URL,
  SIGNER_PORT = 4000,
  SIGNER_HOST = '0.0.0.0',
  SIGNER_CHAIN_ID,
  X402_PAY_TO,
} = process.env
const FOUR_MICA_RPC_URL = process.env['4MICA_RPC_URL']

if (!SIGNER_PRIVATE_KEY) {
  console.error('[signer] Missing SIGNER_PRIVATE_KEY environment variable.')
  process.exit(1)
}

const provider = SIGNER_RPC_URL ? new JsonRpcProvider(SIGNER_RPC_URL) : undefined
const wallet = new Wallet(SIGNER_PRIVATE_KEY, provider)
const walletAddressPromise = wallet.getAddress()
let sdkClientPromise
let sdkInitFailureCount = 0
const expectedPayTo = (() => {
  if (!X402_PAY_TO || !isAddress(X402_PAY_TO)) {
    console.error('[signer] Missing or invalid X402_PAY_TO environment variable.')
    process.exit(1)
  }
  return X402_PAY_TO
})()

process.on('uncaughtException', err => {
  console.error('[signer] Uncaught exception:', err)
})
process.on('unhandledRejection', err => {
  console.error('[signer] Unhandled rejection:', err)
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

const parseBody = async req =>
  new Promise((resolve, reject) => {
    let data = ''
    req.on('data', chunk => {
      data += chunk
      if (data.length > 1_000_000) {
        req.destroy()
        reject(new Error('Payload too large'))
      }
    })
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch (err) {
        reject(new Error('Invalid JSON payload'))
      }
    })
    req.on('error', reject)
  })

const sendJson = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...corsHeaders,
  })
  res.end(JSON.stringify(payload))
}

const ensureSdkClient = async () => {
  if (sdkClientPromise) return sdkClientPromise
  sdkClientPromise = (async () => {
    try {
      const cfg = new ConfigBuilder().fromEnv()
      const coreRpcUrl = SIGNER_CORE_RPC_URL || FOUR_MICA_RPC_URL
      if (coreRpcUrl) {
        cfg.rpcUrl(coreRpcUrl)
      }
      const builtCfg = cfg.walletPrivateKey(SIGNER_PRIVATE_KEY).build()
      // sdk-4mica uses its own Core RPC; SIGNER_RPC_URL stays the on-chain provider
      const client = await Client.new(builtCfg)
      sdkInitFailureCount = 0
      return client
    } catch (err) {
      sdkInitFailureCount += 1
      console.error(`[signer] SDK client init failed (attempt ${sdkInitFailureCount}):`, err)
      sdkClientPromise = undefined
      throw err
    }
  })()
  return sdkClientPromise
}

const resolveChainId = async () => {
  if (typeof SIGNER_CHAIN_ID === 'string' && SIGNER_CHAIN_ID.trim()) {
    const parsed = Number(SIGNER_CHAIN_ID)
    if (!Number.isNaN(parsed)) return parsed
  }

  if (provider) {
    try {
      const net = await provider.getNetwork()
      return Number(net.chainId)
    } catch (err) {
      console.warn('[signer] Failed to read chainId from provider:', err)
    }
  }

  return 80002
}

class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValidationError'
  }
}

const normalizeAddress = addr => (typeof addr === 'string' ? addr.toLowerCase() : '')

const fieldsMatch = (actual, expected) => {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false
  const norm = arr => arr.map(item => `${item.name}:${item.type}`).sort()
  const actualSet = new Set(norm(actual))
  return norm(expected).every(key => actualSet.has(key))
}

const ensureBigIntish = (value, label) => {
  try {
    BigInt(value)
  } catch {
    throw new ValidationError(`${label} must be a numeric value`)
  }
}

const ensureChainId = (domain, expectedChainId) => {
  const domainChainId = domain?.chainId
  const parsed = typeof domainChainId === 'bigint' ? Number(domainChainId) : Number(domainChainId)
  if (!Number.isFinite(parsed)) {
    throw new ValidationError('domain.chainId is required for typed data signatures')
  }
  if (parsed !== Number(expectedChainId)) {
    throw new ValidationError(`domain.chainId mismatch; expected ${expectedChainId}, got ${parsed}`)
  }
}

const validateGuaranteeClaims = (params) => {
  const { domain, types, message, expectedChainId, signerAddress } = params
  const structName = 'SolGuaranteeRequestClaimsV1'
  const expectedFields = [
    { name: 'user', type: 'address' },
    { name: 'recipient', type: 'address' },
    { name: 'tabId', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
    { name: 'asset', type: 'address' },
    { name: 'timestamp', type: 'uint64' },
  ]

  if (!fieldsMatch(types[structName], expectedFields)) {
    throw new ValidationError(`Unexpected struct fields for ${structName}`)
  }

  const { user, recipient, tabId, amount, asset, timestamp } = message || {}
  const requiredFields = ['user', 'recipient', 'tabId', 'amount', 'asset', 'timestamp']
  if (!message || typeof message !== 'object' || requiredFields.some(field => !(field in message))) {
    throw new ValidationError('message is missing required SolGuaranteeRequestClaimsV1 fields')
  }
  if (!isAddress(user) || !isAddress(recipient) || !isAddress(asset)) {
    throw new ValidationError('user, recipient, and asset must be valid addresses')
  }
  if (normalizeAddress(user) !== normalizeAddress(signerAddress)) {
    throw new ValidationError('message.user must match signer address')
  }
  if (normalizeAddress(recipient) !== normalizeAddress(expectedPayTo)) {
    throw new ValidationError('message.recipient must match configured X402_PAY_TO')
  }
  ensureBigIntish(tabId, 'tabId')
  ensureBigIntish(amount, 'amount')
  ensureBigIntish(timestamp, 'timestamp')

  ensureChainId(domain, expectedChainId)
}

const validateTransferWithAuthorization = (params) => {
  const { domain, types, message, expectedChainId, signerAddress } = params
  const structName = 'TransferWithAuthorization'
  const expectedFields = [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ]

  if (!fieldsMatch(types[structName], expectedFields)) {
    throw new ValidationError(`Unexpected struct fields for ${structName}`)
  }

  const { from, to, value, validAfter, validBefore, nonce } = message || {}
  const requiredFields = ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce']
  if (!message || typeof message !== 'object' || requiredFields.some(field => !(field in message))) {
    throw new ValidationError('message is missing required TransferWithAuthorization fields')
  }
  if (!isAddress(from) || !isAddress(to)) {
    throw new ValidationError('from and to must be valid addresses')
  }
  if (normalizeAddress(from) !== normalizeAddress(signerAddress)) {
    throw new ValidationError('message.from must match signer address')
  }
  if (normalizeAddress(to) !== normalizeAddress(expectedPayTo)) {
    throw new ValidationError('message.to must match configured X402_PAY_TO')
  }
  ensureBigIntish(value, 'value')
  ensureBigIntish(validAfter, 'validAfter')
  ensureBigIntish(validBefore, 'validBefore')
  if (!isHexString(nonce, 32)) {
    throw new ValidationError('nonce must be a 32-byte hex string')
  }

  ensureChainId(domain, expectedChainId)
  if (!isAddress(domain?.verifyingContract)) {
    throw new ValidationError('domain.verifyingContract must be a valid address')
  }
}

const validateTypedDataRequest = async (domain, types, message) => {
  if (!domain || typeof domain !== 'object') throw new ValidationError('domain is required')
  if (!types || typeof types !== 'object') throw new ValidationError('types are required')
  if (!message || typeof message !== 'object') throw new ValidationError('message is required')

  const supportedValidators = {
    SolGuaranteeRequestClaimsV1: validateGuaranteeClaims,
    TransferWithAuthorization: validateTransferWithAuthorization,
  }

  const requestedTypes = Object.keys(types).filter(key => key !== 'EIP712Domain')
  if (requestedTypes.length !== 1) {
    throw new ValidationError('Unsupported typed data structure requested')
  }

  const structName = requestedTypes[0]
  const validator = supportedValidators[structName]
  if (!validator) {
    throw new ValidationError(`Struct ${structName} is not allowed for signing`)
  }

  const [expectedChainId, signerAddress] = await Promise.all([resolveChainId(), walletAddressPromise])
  validator({ domain, types, message, expectedChainId, signerAddress })
}

const server = createServer(async (req, res) => {
  try {
    const { method, url } = req

    if (method === 'OPTIONS') {
      res.writeHead(204, corsHeaders)
      res.end()
      return
    }

    if (method === 'GET' && url === '/info') {
      const chainId = await resolveChainId()
      sendJson(res, 200, { address: await wallet.getAddress(), chainId })
      return
    }

    if (method === 'GET' && url.startsWith('/collateral')) {
      try {
        const [, query] = url.split('?', 2)
        const params = new URLSearchParams(query || '')
        const user = params.get('address') || params.get('user')
        if (!user) {
          sendJson(res, 400, { error: 'address is required' })
          return
        }

        const client = await ensureSdkClient()
        const assets = await client.user.getUser()
        const providerForLookup = client.gateway?.provider || provider

        const metaCache = new Map()
        const zeroAddress = '0x0000000000000000000000000000000000000000'

        const results = []
        for (const item of assets) {
          const assetAddr = item.asset
          if (!assetAddr) continue

          const metaKey = assetAddr.toLowerCase()
          if (!metaCache.has(metaKey)) {
            if (assetAddr.toLowerCase() === zeroAddress) {
              metaCache.set(metaKey, { symbol: 'POL', decimals: 18 })
            } else {
              try {
                if (!providerForLookup) throw new Error('provider unavailable')
                const erc20 = new Contract(
                  assetAddr,
                  [
                    'function symbol() view returns (string)',
                    'function decimals() view returns (uint8)',
                  ],
                  providerForLookup
                )
                const [symbol, decimals] = await Promise.all([erc20.symbol(), erc20.decimals()])
                metaCache.set(metaKey, { symbol: String(symbol), decimals: Number(decimals) || 18 })
              } catch {
                metaCache.set(metaKey, { symbol: `${assetAddr.slice(0, 6)}...${assetAddr.slice(-4)}`, decimals: 18 })
              }
            }
          }
          const meta = metaCache.get(metaKey)

          let locked = '0'
          let total = item.collateral?.toString?.() ?? '0'
          try {
            const balanceInfo = await client.recipient.getUserAssetBalance(user, assetAddr)
            if (balanceInfo) {
              locked = balanceInfo.locked?.toString?.() ?? '0'
              total = balanceInfo.total?.toString?.() ?? total
            }
          } catch (err) {
            console.warn('[signer] collateral balance fetch failed:', err)
          }

          results.push({
            asset: assetAddr,
            symbol: meta.symbol,
            decimals: meta.decimals,
            collateral: total,
            locked,
            withdrawalRequested: item.withdrawalRequestAmount?.toString?.() ?? '0',
          })
        }

        sendJson(res, 200, { assets: results })
      } catch (err) {
        console.error('[signer] collateral fetch failed:', err)
        sendJson(res, 500, { error: err instanceof Error ? err.message : 'collateral fetch failed' })
      }
      return
    }

    if (method === 'POST' && url === '/sign/typed') {
      try {
        const body = await parseBody(req)
        const { domain, types, message } = body || {}
        if (!domain || !types || !message) {
          sendJson(res, 400, { error: 'domain, types, and message are required' })
          return
        }
        await validateTypedDataRequest(domain, types, message)
        const signature = await wallet.signTypedData(domain, types, message)
        sendJson(res, 200, { signature, scheme: 'eip712' })
      } catch (err) {
        const isValidation = err instanceof ValidationError
        if (!isValidation) {
          console.error('[signer] Typed sign failed:', err)
        }
        sendJson(res, isValidation ? 400 : 500, { error: err instanceof Error ? err.message : 'signTypedData failed' })
      }
      return
    }

    if (method === 'POST' && url === '/sign/message') {
      try {
        const body = await parseBody(req)
        const { message } = body || {}
        if (!message || !isHexString(message)) {
          sendJson(res, 400, { error: 'message must be a hex string' })
          return
        }
        const signature = await wallet.signMessage(getBytes(message))
        sendJson(res, 200, { signature, scheme: 'eip191' })
      } catch (err) {
        console.error('[signer] Message sign failed:', err)
        sendJson(res, 500, { error: err instanceof Error ? err.message : 'signMessage failed' })
      }
      return
    }

    sendJson(res, 404, { error: 'Not found' })
  } catch (err) {
    console.error('[signer] Unhandled request error:', err)
    sendJson(res, 500, { error: 'Internal server error' })
  }
})

server.listen(Number(SIGNER_PORT), SIGNER_HOST, async () => {
  const chainId = await resolveChainId()
  console.log(
    `[signer] Ready on http://${SIGNER_HOST}:${SIGNER_PORT} | address=${await wallet.getAddress()} chainId=${chainId}`
  )
})
