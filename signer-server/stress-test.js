import http from 'node:http'
import https from 'node:https'
import { randomBytes } from 'node:crypto'
import { URL, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const httpAgent = new http.Agent({ keepAlive: true })
const httpsAgent = new https.Agent({ keepAlive: true })

const usage = `
Usage: node signer-server/stress-test.js [options]

Options:
  --url <url>                 Base signer URL (default: http://localhost:4000)
  --endpoint <message|info|typed|collateral>
  --requests <n>              Total requests (default: 500)
  --concurrency <n>           Concurrent workers (default: 50)
  --timeout <ms>              Request timeout (default: 10000)
  --address <addr>            Address for /collateral (defaults to /info address)
  --pay-to <addr>             Required for --endpoint typed (default: X402_PAY_TO env)
  --contract <addr>           Typed domain verifyingContract (default: --pay-to)
  --report-every <n>           Progress print interval (default: 50)
  --help
`

const parseNumber = (value, fallback) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

const parseArgs = argv => {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i]
    if (!raw.startsWith('--')) continue
    const [key, inlineValue] = raw.slice(2).split('=')
    if (key === 'help') {
      args.help = true
      continue
    }
    const next = inlineValue ?? argv[i + 1]
    if (inlineValue === undefined && next && !next.startsWith('--')) {
      i += 1
    }
    args[key] = inlineValue ?? next
  }
  return args
}

const requestJson = (url, method, body, timeoutMs) =>
  new Promise((resolve, reject) => {
    const target = new URL(url)
    const payload = body ? JSON.stringify(body) : ''
    const isHttps = target.protocol === 'https:'
    const lib = isHttps ? https : http
    const headers = {
      Accept: 'application/json',
    }
    if (payload) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = Buffer.byteLength(payload).toString()
    }
    const options = {
      method,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      headers,
      agent: isHttps ? httpsAgent : httpAgent,
    }
    const req = lib.request(options, res => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', chunk => {
        raw += chunk
      })
      res.on('end', () => {
        resolve({
          status: res.statusCode || 0,
          body: raw,
          headers: res.headers,
        })
      })
    })
    req.on('error', reject)
    if (timeoutMs) {
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`timeout after ${timeoutMs}ms`))
      })
    }
    if (payload) req.write(payload)
    req.end()
  })

const fetchInfo = async (baseUrl, timeoutMs) => {
  const response = await requestJson(`${baseUrl}/info`, 'GET', null, timeoutMs)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`info request failed with status ${response.status}`)
  }
  let parsed
  try {
    parsed = JSON.parse(response.body || '{}')
  } catch {
    throw new Error('info response is not valid JSON')
  }
  if (!parsed.address || parsed.chainId === undefined || parsed.chainId === null) {
    throw new Error('info response missing address or chainId')
  }
  return parsed
}

const buildTypedPayload = ({ address, chainId, payTo, verifyingContract }) => ({
  domain: {
    name: '4mica signer stress',
    version: '1',
    chainId,
    verifyingContract,
  },
  types: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  message: {
    from: address,
    to: payTo,
    value: '1',
    validAfter: '0',
    validBefore: '9999999999',
    nonce: `0x${randomBytes(32).toString('hex')}`,
  },
})

const buildMessagePayload = () => ({
  message: `0x${randomBytes(32).toString('hex')}`,
})

const percentile = (values, p) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

const formatMs = value => `${value.toFixed(1)}ms`
const formatBytes = value => {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = units[0]
  for (let i = 1; i < units.length && size >= 1024; i += 1) {
    size /= 1024
    unit = units[i]
  }
  return `${size.toFixed(1)}${unit}`
}

export const runSignerStressTest = async options => {
  const baseUrl = options.url || 'http://localhost:4000'
  const total = Math.max(1, parseNumber(options.requests, 500))
  const concurrency = Math.max(1, Math.min(total, parseNumber(options.concurrency, 50)))
  const endpoint = options.endpoint || 'message'
  const timeoutMs = Math.max(1, parseNumber(options.timeout, 10000))
  const reportEvery = Math.max(0, parseNumber(options.reportEvery, 50))

  let info
  if (endpoint === 'typed' || endpoint === 'collateral') {
    info = await fetchInfo(baseUrl, timeoutMs)
  }

  const payTo = options.payTo || process.env.X402_PAY_TO
  const verifyingContract = options.contract || payTo
  const collateralAddress = options.address || info?.address

  if (endpoint === 'typed') {
    if (!payTo) {
      throw new Error('typed endpoint requires --pay-to or X402_PAY_TO env var')
    }
    if (!verifyingContract) {
      throw new Error('typed endpoint requires --contract or --pay-to')
    }
  }
  if (endpoint === 'collateral' && !collateralAddress) {
    throw new Error('collateral endpoint requires --address or a signer /info response')
  }

  let completed = 0
  let ok = 0
  let failed = 0
  const errors = []
  const latencies = []
  const statusCounts = new Map()

  const nextIndex = (() => {
    let current = 0
    return () => {
      if (current >= total) return null
      const idx = current
      current += 1
      return idx
    }
  })()

  const runOne = async () => {
    const start = performance.now()
    let response
    try {
      if (endpoint === 'info') {
        response = await requestJson(`${baseUrl}/info`, 'GET', null, timeoutMs)
      } else if (endpoint === 'collateral') {
        const url = `${baseUrl}/collateral?address=${encodeURIComponent(collateralAddress)}`
        response = await requestJson(url, 'GET', null, timeoutMs)
      } else if (endpoint === 'typed') {
        const payload = buildTypedPayload({
          address: info.address,
          chainId: info.chainId,
          payTo,
          verifyingContract,
        })
        response = await requestJson(`${baseUrl}/sign/typed`, 'POST', payload, timeoutMs)
      } else {
        const payload = buildMessagePayload()
        response = await requestJson(`${baseUrl}/sign/message`, 'POST', payload, timeoutMs)
      }
    } catch (err) {
      failed += 1
      const duration = performance.now() - start
      latencies.push(duration)
      if (errors.length < 10) {
        errors.push({ type: 'request', message: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    const duration = performance.now() - start
    latencies.push(duration)
    const status = response.status
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1)

    if (status >= 200 && status < 300) {
      ok += 1
    } else {
      failed += 1
      if (errors.length < 10) {
        errors.push({
          type: 'response',
          status,
          body: response.body?.slice(0, 200) || '',
        })
      }
    }
  }

  const worker = async () => {
    for (;;) {
      const idx = nextIndex()
      if (idx === null) return
      await runOne()
      completed += 1
      if (reportEvery > 0 && completed % reportEvery === 0) {
        const mem = process.memoryUsage()
        const rss = formatBytes(mem.rss)
        const heap = formatBytes(mem.heapUsed)
        console.log(
          `[progress] ${completed}/${total} ok=${ok} fail=${failed} rss=${rss} heap=${heap}`
        )
      }
    }
  }

  console.log(
    `[start] url=${baseUrl} endpoint=${endpoint} total=${total} concurrency=${concurrency} timeoutMs=${timeoutMs}`
  )
  if (endpoint === 'typed') {
    console.log(`[typed] signer=${info.address} chainId=${info.chainId} payTo=${payTo}`)
  }

  const workers = Array.from({ length: concurrency }, () => worker())
  await Promise.all(workers)

  const min = latencies.length ? Math.min(...latencies) : 0
  const max = latencies.length ? Math.max(...latencies) : 0
  const p50 = percentile(latencies, 50)
  const p90 = percentile(latencies, 90)
  const p99 = percentile(latencies, 99)
  const statusSummary = Array.from(statusCounts.entries())
    .sort(([a], [b]) => a - b)
    .map(([status, count]) => `${status}:${count}`)
    .join(' ')

  console.log('[done]')
  console.log(`ok=${ok} fail=${failed} status=${statusSummary || 'none'}`)
  console.log(`latency min=${formatMs(min)} p50=${formatMs(p50)} p90=${formatMs(p90)} p99=${formatMs(p99)} max=${formatMs(max)}`)
  if (errors.length) {
    console.log('sample errors:')
    for (const err of errors) {
      if (err.type === 'response') {
        console.log(`- status=${err.status} body=${err.body}`)
      } else {
        console.log(`- ${err.message}`)
      }
    }
  }
}

const isMain = (() => {
  if (!process.argv[1]) return false
  return import.meta.url === pathToFileURL(process.argv[1]).href
})()

if (isMain) {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage.trim())
    process.exit(0)
  }

  runSignerStressTest({
    url: args.url || process.env.SIGNER_URL,
    endpoint: args.endpoint,
    requests: args.requests || process.env.SIGNER_STRESS_REQUESTS,
    concurrency: args.concurrency || process.env.SIGNER_STRESS_CONCURRENCY,
    timeout: args.timeout || process.env.SIGNER_STRESS_TIMEOUT,
    address: args.address || process.env.SIGNER_STRESS_ADDRESS,
    payTo: args['pay-to'] || process.env.X402_PAY_TO,
    contract: args.contract || process.env.SIGNER_STRESS_CONTRACT,
    reportEvery: args['report-every'] || process.env.SIGNER_STRESS_REPORT_EVERY,
  }).catch(err => {
    console.error(`[fatal] ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
