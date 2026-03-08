// Replicates Java's signed-integer SHA-1 hex encoding ("Notch hash")
function mcHexDigest (hashBytes: Uint8Array): string {
  const buf = new Uint8Array(hashBytes) // copy – we mutate for two's complement
  const negative = buf[0] >= 0x80
  if (negative) {
    let carry = true
    for (let i = buf.length - 1; i >= 0; i--) {
      const b = (~buf[i]) & 0xff
      if (carry) {
        carry = b === 0xff
        buf[i] = carry ? 0 : b + 1
      } else {
        buf[i] = b
      }
    }
  }
  const hex = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('').replace(/^0+/, '') || '0'
  return (negative ? '-' : '') + hex
}

export const server = ({ host: sessionServer }) => {
  return {
    // Called by encrypt.js with: (accessToken, profile.id, packet.serverId, sharedSecret, packet.publicKey, cb)
    async join (accessToken, selectedProfile, serverId, sharedSecret, publicKey, cb) {
      try {
        // Compute the Minecraft SHA-1 hash entirely in the browser using Web Crypto.
        // This matches exactly what yggdrasil's Server.join() does in Node:
        //   SHA1( utf8(serverId) || sharedSecret || publicKey )
        const enc = new TextEncoder()
        const serverIdBytes = enc.encode(serverId)
        const secretBytes = sharedSecret instanceof Uint8Array ? sharedSecret : new Uint8Array(Buffer.from(sharedSecret))
        const keyBytes = publicKey instanceof Uint8Array ? publicKey : new Uint8Array(Buffer.from(publicKey))
        const combined = new Uint8Array(serverIdBytes.length + secretBytes.length + keyBytes.length)
        combined.set(serverIdBytes, 0)
        combined.set(secretBytes, serverIdBytes.length)
        combined.set(keyBytes, serverIdBytes.length + secretBytes.length)
        const digest = await crypto.subtle.digest('SHA-1', combined)
        const computedServerId = mcHexDigest(new Uint8Array(digest))

        const res = await fetch(String(sessionServer), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken, selectedProfile, serverId: computedServerId })
        })
        if (!res.ok) throw new Error(`Request failed ${await res.text()}`)
        cb(null)
      } catch (err) {
        cb(err)
      }
    }
  }
}
