#!/usr/bin/env node

const express = require('express')
const netApi = require('net-browserify')
const compression = require('compression')
const path = require('path')
const cors = require('cors')
const https = require('https')
const fs = require('fs')
const crypto = require('crypto')
const { Authflow, Titles } = require('prismarine-auth')
const { RealmAPI } = require('prismarine-realms')
let siModule
try {
  siModule = require('systeminformation')
} catch (err) { }

// Create our app
const app = express()

const isProd = process.argv.includes('--prod') || process.env.NODE_ENV === 'production'
// Vercel sets this env var automatically. When true, skip WebSocket-based
// net-browserify (Vercel doesn't support persistent WebSocket upgrades) and
// skip static file serving (Vercel CDN handles that from dist/ directly).
const isVercel = !!process.env.VERCEL
const timeoutIndex = process.argv.indexOf('--timeout')
let timeout = timeoutIndex > -1 && timeoutIndex + 1 < process.argv.length
    ? parseInt(process.argv[timeoutIndex + 1])
    : process.env.TIMEOUT
        ? parseInt(process.env.TIMEOUT)
        : 10000
if (isNaN(timeout) || timeout < 0) {
  console.warn('Invalid timeout value provided, using default of 10000ms')
  timeout = 10000
}
app.use(compression())
app.use(cors())
// Do NOT use express.json() globally — it consumes the body stream before
// net-browserify can read it. Apply it only to specific API routes below.

// Advertise local Microsoft auth capabilities on the net-browserify discovery
// endpoint. Must be registered BEFORE app.use(netApi(...)) so Express matches
// this GET before net-browserify's WebSocket upgrade handler.
app.get('/api/vm/net/connect', (req, res) => {
  res.json({
    capabilities: {
      authEndpoint: '/auth/ms',
      sessionEndpoint: '/session',
      realmsListEndpoint: '/realms/list',
      realmsAddressEndpoint: '/realms/address'
    }
  })
})

if (!isVercel) {
  app.use(netApi({
    allowOrigin: '*',
    log: process.argv.includes('--log') || process.env.LOG === 'true',
    timeout
  }))
}
if (!isProd && !isVercel) {
  app.use('/sounds', express.static(path.join(__dirname, './generated/sounds/')))
}

// ---------------------------------------------------------------------------
// Local Microsoft authentication via prismarine-auth
// ---------------------------------------------------------------------------

console.log('[MSAuth/server] READY – using live+NintendoSwitch (mineflayer default)')

// POST /auth/ms
// Runs the Microsoft device-code auth flow locally (no external proxy needed).
// Streams JSON-line events back to the browser:
//   { user_code, verification_uri, expires_in }  – device code to display
//   { token, newCache }                          – success + updated cache
//   { error }                                    – failure message
app.post('/auth/ms', express.json(), async (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')

  const send = (data) => {
    if (!res.writableEnded) {
      console.log('[MSAuth/server] sending:', JSON.stringify(data).slice(0, 120))
      res.write(JSON.stringify(data) + '\n\n')
      if (typeof res.flush === 'function') res.flush()
    }
  }

  // Restore previously saved tokens from the client cache so that a user who
  // already signed in via '+ MS Account' won't get a device code prompt again.
  // The client sends { data: { live: {...}, xbl: {...}, mca: {...} }, expiresOn, ... }
  // – we only want the inner 'data' object.
  const savedTokens = (req.body?.data && typeof req.body.data === 'object') ? req.body.data : {}
  const cacheStore = { ...savedTokens }
  const memCache = ({ cacheName }) => ({
    async getCached () { return cacheStore[cacheName] ?? {} },
    async setCached (data) { cacheStore[cacheName] = data },
    async setCachedPartial (data) { cacheStore[cacheName] = { ...(cacheStore[cacheName] ?? {}), ...data } },
    async reset () { cacheStore[cacheName] = {}; return {} }
  })

  try {
    // Exactly what minecraft-protocol's microsoftAuth.js does by default:
    // flow: 'live', authTitle: Titles.MinecraftNintendoSwitch, deviceType: 'Nintendo'
    // This is the proven-working combination used by mineflayer itself.
    const flow = new Authflow(null, memCache, {
      flow: 'live',
      authTitle: Titles.MinecraftNintendoSwitch,
      deviceType: 'Nintendo'
    }, (codeData) => {
      console.log('[MSAuth/server] device code:', codeData.user_code)
      send({
        user_code: codeData.user_code,
        verification_uri: codeData.verification_uri,
        expires_in: codeData.expires_in
      })
    })

    console.log('[MSAuth/server] starting getMinecraftJavaToken...')
    const result = await flow.getMinecraftJavaToken({ fetchProfile: true })
    console.log('[MSAuth/server] auth complete, user:', result?.profile?.name)
    // Send token/profile/etc flat so protocolMicrosoftAuth.authenticate can
    // destructure { token, profile, certificates } at the top level.
    send({ ...result, newCache: cacheStore })
  } catch (err) {
    console.error('[MSAuth/server] auth error:', err.message)
    send({ error: err.message })
  }
  res.end()
})

// ---------------------------------------------------------------------------
// Minecraft Realms integration via prismarine-realms
// ---------------------------------------------------------------------------

// Helper: build an in-memory prismarine-auth cache pre-loaded with client tokens
function makeMemCache (body, excludeKeys) {
  const cacheStore = {}
  for (const [k, v] of Object.entries(body || {})) {
    if (!excludeKeys.has(k) && v && typeof v === 'object') cacheStore[k] = v
  }
  const factory = ({ cacheName }) => ({
    async getCached () { return cacheStore[cacheName] ?? {} },
    async setCached (data) { cacheStore[cacheName] = data },
    async setCachedPartial (data) { cacheStore[cacheName] = { ...(cacheStore[cacheName] ?? {}), ...data } },
    async reset () { cacheStore[cacheName] = {}; return {} }
  })
  return factory
}

// POST /realms/list
// Returns the authenticated user's Minecraft Realms.
// Body: { platform: 'java'|'bedrock', ...cachedTokens }
app.post('/realms/list', express.json(), async (req, res) => {
  const platform = req.body?.platform ?? 'java'
  const cache = makeMemCache(req.body, new Set(['platform']))
  try {
    const authTitle = platform === 'bedrock' ? Titles.MinecraftNintendoSwitch : Titles.MinecraftJava
    const flow = new Authflow(null, cache, { flow: 'live', authTitle })
    const api = RealmAPI.from(flow, platform)
    const realms = await api.getRealms()
    res.json({
      realms: realms.map(r => ({
        id: r.id,
        name: r.name,
        motd: r.motd,
        state: r.state,
        owner: r.owner,
        maxPlayers: r.maxPlayers,
        expired: r.expired,
        platform
      }))
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /realms/address
// Returns { host, port } for a Realm by ID.
// Body: { platform: 'java'|'bedrock', realmId: number, ...cachedTokens }
app.post('/realms/address', express.json(), async (req, res) => {
  const platform = req.body?.platform ?? 'java'
  const realmId = req.body?.realmId
  if (!realmId) return res.status(400).json({ error: 'realmId required' })
  const cache = makeMemCache(req.body, new Set(['platform', 'realmId']))
  try {
    const authTitle = platform === 'bedrock' ? Titles.MinecraftNintendoSwitch : Titles.MinecraftJava
    const flow = new Authflow(null, cache, { flow: 'live', authTitle })
    const api = RealmAPI.from(flow, platform)
    const address = await api.getRealmAddress(realmId)
    res.json({ host: address.host, port: address.port })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /session
// Proxies the Minecraft session join to Mojang on behalf of the browser
// (browsers cannot call sessionserver.mojang.com cross-origin directly).
// The browser shim (yggdrasilReplacement.ts) computes the SHA-1 hash and sends
// the already-hashed serverId here – we just forward it straight to Mojang.
app.post('/session', express.json(), async (req, res) => {
  try {
    const response = await fetch('https://sessionserver.mojang.com/session/minecraft/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: req.body.accessToken,
        selectedProfile: req.body.selectedProfile,
        serverId: req.body.serverId
      })
    })
    if (response.ok || response.status === 204) {
      res.sendStatus(204)
    } else {
      res.status(response.status).send(await response.text())
    }
  } catch (err) {
    res.status(500).send(err.message)
  }
})
// patch config
app.get('/config.json', (req, res, next) => {
  // read original file config
  let config = {}
  let publicConfig = {}
  try {
    config = require('./config.json')
  } catch {
    try {
      config = require('./dist/config.json')
    } catch { }
  }
  try {
    publicConfig = require('./public/config.json')
  } catch { }
  res.json({
    ...config,
    'defaultProxy': 'mc.sathelper.xyz:8080',
    ...publicConfig,
  })
})
if (isProd && !isVercel) {
  // add headers to enable shared array buffer
  app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
    next()
  })

  // First serve from the override directory (volume mount)
  app.use(express.static(path.join(__dirname, './public')))

  // Then fallback to the original dist directory
  app.use(express.static(path.join(__dirname, './dist')))
}

const numArg = process.argv.find(x => x.match(/^\d+$/))
const port = (require.main === module ? numArg : undefined) || 8080

// Only start listening when run directly (node server.js).
// When imported by Vercel (or tests) the caller handles the HTTP transport.
if (require.main === module) {
  const server =
    app.listen(port, async function () {
      console.log('Proxy server listening on port ' + server.address().port)
      if (siModule && isProd) {
        const _interfaces = await siModule.networkInterfaces()
        const interfaces = Array.isArray(_interfaces) ? _interfaces : [_interfaces]
        let netInterface = interfaces.find(int => int.default)
        if (!netInterface) {
          netInterface = interfaces.find(int => !int.virtual) ?? interfaces[0]
          console.warn('Failed to get the default network interface, searching for fallback')
        }
        if (netInterface) {
          const address = netInterface.ip4
          console.log(`You can access the server on http://localhost:${port} or http://${address}:${port}`)
        }
      }
    })
}

module.exports = { app }
