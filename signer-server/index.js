import 'dotenv/config'
import { createServer } from 'node:http'
import { JsonRpcProvider, Wallet, Contract, getBytes, isHexString, isAddress } from 'ethers'
import { Client, ConfigBuilder, PaymentRequirements, ValidationError, X402Flow, validateGuaranteeTypedData } from 'sdk-4mica'

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

const nowIso = () => new Date().toISOString()
const formatError = (err) => {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    }
  }
  return { message: String(err) }
}
const logWithLevel = (level, message, meta) => {
  const prefix = `[signer] ${nowIso()} ${level.toUpperCase()}`
  const logger = console[level] || console.log
  if (meta) {
    logger(prefix, message, meta)
  } else {
    logger(prefix, message)
  }
}
const logInfo = (message, meta) => logWithLevel('log', message, meta)
const logWarn = (message, meta) => logWithLevel('warn', message, meta)
const logError = (message, meta) => logWithLevel('error', message, meta)

let requestSequence = 0
const createRequestId = () => {
  requestSequence = (requestSequence + 1) % 1_000_000
  return `${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

if (!SIGNER_PRIVATE_KEY) {
  logError('Missing SIGNER_PRIVATE_KEY environment variable.')
  process.exit(1)
}

const provider = SIGNER_RPC_URL ? new JsonRpcProvider(SIGNER_RPC_URL) : undefined
const wallet = new Wallet(SIGNER_PRIVATE_KEY, provider)
const walletAddressPromise = wallet.getAddress()
let sdkClientPromise
let sdkInitFailureCount = 0
const expectedPayTo = (() => {
  if (!X402_PAY_TO || !isAddress(X402_PAY_TO)) {
    logError('Missing or invalid X402_PAY_TO environment variable.')
    process.exit(1)
  }
  return X402_PAY_TO
})()

logInfo('Signer configuration', {
  host: SIGNER_HOST,
  port: SIGNER_PORT,
  signerChainId: SIGNER_CHAIN_ID || 'auto',
  rpcUrl: SIGNER_RPC_URL ? 'configured' : 'default',
  coreRpcUrl: SIGNER_CORE_RPC_URL || FOUR_MICA_RPC_URL || 'default',
  payTo: expectedPayTo,
})

process.on('uncaughtException', err => {
  logError('Uncaught exception', formatError(err))
})
process.on('unhandledRejection', err => {
  logError('Unhandled rejection', formatError(err))
})
process.on('warning', warning => {
  logWarn('Process warning', warning)
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Expose-Headers': 'X-Request-Id',
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
    req.on('aborted', () => reject(new Error('Request aborted by client')))
    req.on('error', reject)
  })

const sendJson = (res, status, payload, requestId) => {
  if (res.writableEnded) return
  try {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId || '',
      ...corsHeaders,
    })
    res.end(JSON.stringify(payload))
  } catch (err) {
    logError('Failed to send JSON response', { ...formatError(err), requestId, status })
  }
}

const sendError = (res, status, message, requestId) => {
  sendJson(res, status, { error: message, requestId }, requestId)
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
      logInfo('SDK client initialized', {
        coreRpcUrl: coreRpcUrl || 'default',
      })
      return client
    } catch (err) {
      sdkInitFailureCount += 1
      logError(`SDK client init failed (attempt ${sdkInitFailureCount})`, formatError(err))
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
      logWarn('Failed to read chainId from provider', formatError(err))
    }
  }

  return 80002
}

const normalizeAddress = addr => (typeof addr === 'string' ? addr.toLowerCase() : '')

const serializePublicParams = params => {
  const rawKey = params?.publicKey
  let publicKey = ''
  if (typeof rawKey === 'string') {
    publicKey = rawKey
  } else if (rawKey instanceof Uint8Array) {
    publicKey = `0x${Buffer.from(rawKey).toString('hex')}`
  } else if (Array.isArray(rawKey)) {
    publicKey = `0x${Buffer.from(Uint8Array.from(rawKey)).toString('hex')}`
  }
  if (!publicKey) publicKey = '0x'

  return {
    publicKey,
    contractAddress: params?.contractAddress || '',
    ethereumHttpRpcUrl: params?.ethereumHttpRpcUrl || '',
    eip712Name: params?.eip712Name || '',
    eip712Version: params?.eip712Version || '',
    chainId: params?.chainId ?? null,
  }
}

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

  const requestedTypes = Object.keys(types).filter(key => key !== 'EIP712Domain')
  if (requestedTypes.length !== 1) {
    throw new ValidationError('Unsupported typed data structure requested')
  }

  const structName = requestedTypes[0]
  const [expectedChainId, signerAddress] = await Promise.all([resolveChainId(), walletAddressPromise])
  if (structName === 'SolGuaranteeRequestClaimsV1') {
    validateGuaranteeTypedData(
      { domain, types, message },
      { expectedChainId, expectedSigner: signerAddress, expectedRecipient: expectedPayTo }
    )
    return
  }
  if (structName === 'TransferWithAuthorization') {
    validateTransferWithAuthorization({ domain, types, message, expectedChainId, signerAddress })
    return
  }

  throw new ValidationError(`Struct ${structName} is not allowed for signing`)
}

const server = createServer(async (req, res) => {
  const requestIdHeader = req.headers['x-request-id']
  const requestId = (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) || createRequestId()
  const startedAt = Date.now()
  const requestMeta = {
    requestId,
    method: req.method,
    url: req.url,
    remoteAddress: req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'],
    contentLength: req.headers['content-length'],
  }

  logInfo('Incoming request', requestMeta)
  res.on('finish', () => {
    logInfo('Request completed', {
      requestId,
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    })
  })
  res.on('close', () => {
    if (!res.writableEnded) {
      logWarn('Request closed before response finished', {
        requestId,
        method: req.method,
        url: req.url,
      })
    }
  })

  try {
    const { method, url } = req

    if (method === 'OPTIONS') {
      res.writeHead(204, { ...corsHeaders, 'X-Request-Id': requestId })
      res.end()
      return
    }

    if (method === 'GET' && url === '/info') {
      const chainId = await resolveChainId()
      const address = await wallet.getAddress()
      sendJson(res, 200, { address, chainId }, requestId)
      logInfo('Info request served', { requestId, chainId, address })
      return
    }

    if (method === 'GET' && url === '/params') {
      try {
        const client = await ensureSdkClient()
        const params = serializePublicParams(client.params)
        sendJson(res, 200, { params }, requestId)
        logInfo('Params request served', { requestId })
      } catch (err) {
        logError('Params request failed', { requestId, ...formatError(err) })
        sendError(res, 500, err instanceof Error ? err.message : 'params request failed', requestId)
      }
      return
    }

    if (method === 'GET' && url.startsWith('/collateral')) {
      try {
        const [, query] = url.split('?', 2)
        const params = new URLSearchParams(query || '')
        const user = params.get('address') || params.get('user')
        if (!user) {
          sendError(res, 400, 'address is required', requestId)
          return
        }
        if (!isAddress(user)) {
          sendError(res, 400, 'address must be a valid address', requestId)
          return
        }
        logInfo('Collateral request', { requestId, user })

        const client = await ensureSdkClient()
        const assets = await client.user.getUser()
        if (!Array.isArray(assets)) {
          logError('Collateral asset list invalid', { requestId, assetsType: typeof assets })
          sendError(res, 500, 'collateral response malformed', requestId)
          return
        }
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
            logWarn('Collateral balance fetch failed', { requestId, assetAddr, ...formatError(err) })
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

        sendJson(res, 200, { assets: results }, requestId)
        logInfo('Collateral request completed', { requestId, assetCount: results.length })
      } catch (err) {
        logError('Collateral fetch failed', { requestId, ...formatError(err) })
        sendError(res, 500, err instanceof Error ? err.message : 'collateral fetch failed', requestId)
      }
      return
    }

    if (method === 'POST' && url === '/x402/sign') {
      try {
        const body = await parseBody(req)
        const { paymentRequirements, userAddress } = body || {}
        if (!paymentRequirements || typeof paymentRequirements !== 'object') {
          sendError(res, 400, 'paymentRequirements is required', requestId)
          return
        }

        const client = await ensureSdkClient()
        const flow = X402Flow.fromClient(client)
        const requirements = PaymentRequirements.fromRaw(paymentRequirements)
        const signerAddress = await walletAddressPromise
        if (userAddress && normalizeAddress(userAddress) !== normalizeAddress(signerAddress)) {
          sendError(res, 400, 'userAddress does not match signer address', requestId)
          return
        }

        const payment = await flow.signPayment(requirements, signerAddress)
        const claims = payment.claims
        const payload = {
          header: payment.header,
          claims: {
            userAddress: claims.userAddress,
            recipientAddress: claims.recipientAddress,
            tabId: claims.tabId.toString(),
            reqId: claims.reqId.toString(),
            amount: claims.amount.toString(),
            assetAddress: claims.assetAddress,
            timestamp: claims.timestamp,
          },
          signature: payment.signature,
        }
        sendJson(res, 200, payload, requestId)
        logInfo('x402 sign request served', {
          requestId,
          scheme: requirements.scheme,
          network: requirements.network,
          tabId: payload.claims.tabId,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'x402 sign failed'
        const status = err instanceof ValidationError || (err instanceof Error && err.name === 'X402Error') ? 400 : 500
        if (status === 500) {
          logError('x402 sign failed', { requestId, ...formatError(err) })
        }
        sendError(res, status, message, requestId)
      }
      return
    }

    if (method === 'POST' && url === '/sign/typed') {
      try {
        const body = await parseBody(req)
        const { domain, types, message } = body || {}
        if (!domain || !types || !message) {
          sendError(res, 400, 'domain, types, and message are required', requestId)
          return
        }
        logInfo('Typed sign request received', {
          requestId,
          structNames: Object.keys(types || {}).filter(key => key !== 'EIP712Domain'),
          domainChainId: domain?.chainId,
        })
        logInfo('Typed sign payload', { requestId, domain, types, message })
        await validateTypedDataRequest(domain, types, message)
        const signature = await wallet.signTypedData(domain, types, message)
        logInfo('Typed sign response', { requestId, signature, scheme: 'eip712' })
        sendJson(res, 200, { signature, scheme: 'eip712' }, requestId)
      } catch (err) {
        const isValidation = err instanceof ValidationError
        if (!isValidation) {
          logError('Typed sign failed', { requestId, ...formatError(err) })
        }
        sendError(res, isValidation ? 400 : 500, err instanceof Error ? err.message : 'signTypedData failed', requestId)
      }
      return
    }

    if (method === 'POST' && url === '/sign/message') {
      try {
        const body = await parseBody(req)
        const { message } = body || {}
        if (!message || !isHexString(message)) {
          sendError(res, 400, 'message must be a hex string', requestId)
          return
        }
        logInfo('Message sign request received', { requestId, messageLength: message.length, message })
        const signature = await wallet.signMessage(getBytes(message))
        logInfo('Message sign response', { requestId, signature, scheme: 'eip191' })
        sendJson(res, 200, { signature, scheme: 'eip191' }, requestId)
      } catch (err) {
        logError('Message sign failed', { requestId, ...formatError(err) })
        sendError(res, 500, err instanceof Error ? err.message : 'signMessage failed', requestId)
      }
      return
    }

    logWarn('Unknown route', { requestId, method, url })
    sendError(res, 404, 'Not found', requestId)
  } catch (err) {
    logError('Unhandled request error', { requestId, ...formatError(err) })
    sendError(res, 500, 'Internal server error', requestId)
  }
})

server.on('clientError', (err, socket) => {
  logWarn('Client socket error', formatError(err))
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
  }
})
server.on('error', err => {
  logError('Server error', formatError(err))
})

const shutdown = signal => {
  logWarn(`Received ${signal}, shutting down`)
  server.close(() => {
    logInfo('Server closed')
    process.exit(0)
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

server.listen(Number(SIGNER_PORT), SIGNER_HOST, () => {
  ;(async () => {
    try {
      const chainId = await resolveChainId()
      const address = await wallet.getAddress()
      logInfo('Signer ready', {
        url: `http://${SIGNER_HOST}:${SIGNER_PORT}`,
        address,
        chainId,
        provider: SIGNER_RPC_URL ? 'configured' : 'default',
      })
    } catch (err) {
      logError('Failed to log startup info', formatError(err))
    }
  })()
})
