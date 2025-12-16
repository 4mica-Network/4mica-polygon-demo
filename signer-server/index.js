import { createServer } from 'node:http'
import { JsonRpcProvider, Wallet, Contract, getBytes, hexlify, isHexString } from 'ethers'
import { Client, ConfigBuilder } from 'sdk-4mica'

const {
  SIGNER_PRIVATE_KEY,
  SIGNER_RPC_URL,
  SIGNER_PORT = 4000,
  SIGNER_HOST = '0.0.0.0',
  SIGNER_CHAIN_ID,
} = process.env

if (!SIGNER_PRIVATE_KEY) {
  console.error('[signer] Missing SIGNER_PRIVATE_KEY environment variable.')
  process.exit(1)
}

const provider = SIGNER_RPC_URL ? new JsonRpcProvider(SIGNER_RPC_URL) : undefined
const wallet = new Wallet(SIGNER_PRIVATE_KEY, provider)
let sdkClientPromise

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
    const cfg = new ConfigBuilder()
      .fromEnv()
      .rpcUrl(SIGNER_RPC_URL || 'https://api.4mica.xyz/')
      .walletPrivateKey(SIGNER_PRIVATE_KEY)
      .build()
    return Client.new(cfg)
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

const server = createServer(async (req, res) => {
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
      const provider = client.gateway?.provider || new JsonRpcProvider(SIGNER_RPC_URL)

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
              const erc20 = new Contract(
                assetAddr,
                [
                  'function symbol() view returns (string)',
                  'function decimals() view returns (uint8)',
                ],
                provider
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
      const signature = await wallet.signTypedData(domain, types, message)
      sendJson(res, 200, { signature, scheme: 'eip712' })
    } catch (err) {
      console.error('[signer] Typed sign failed:', err)
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'signTypedData failed' })
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
})

server.listen(Number(SIGNER_PORT), SIGNER_HOST, async () => {
  const chainId = await resolveChainId()
  console.log(
    `[signer] Ready on http://${SIGNER_HOST}:${SIGNER_PORT} | address=${await wallet.getAddress()} chainId=${chainId}`
  )
})
