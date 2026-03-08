// Vercel serverless entry point.
// Handles HTTP-only API routes: /auth/ms, /session, /realms/*, /api/vm/net/connect
//
// The WebSocket TCP proxy (net-browserify) cannot run on Vercel serverless.
// It is served by the public proxy at proxy.mcraft.fun instead — the built
// dist/config.json already contains that URL as defaultProxy so players see
// it pre-filled without any extra configuration.
module.exports = require('../server.js').app
