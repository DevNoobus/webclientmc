export default () => {
  // not plugin so its loaded earlier
  customEvents.on('mineflayerBotCreated', () => {
    botInit()
  })
}

const waitingPackets = {} as Record<string, Array<{ name: string, data: any }>>

const botInit = () => {
  // PATCH READING
  bot._client.on('packet', (data, meta) => {
    if (meta.name === 'map_chunk') {
      if (data.groundUp && data.bitMap === 1 && data.chunkData.every(x => x === 0)) {
        data.chunkData = Buffer.from(Array.from({ length: 12_544 }).fill(0) as any)
      }
    }
  })

  // PATCH WRITING

  const clientWrite = bot._client.write.bind(bot._client)
  const sendAllPackets = (name: string, data: any) => {
    for (const packet of waitingPackets[name]) {
      clientWrite(packet.name, packet.data)
    }
    delete waitingPackets[name]
  }

  //@ts-expect-error
  bot._client.write = (name: string, data: any) => {
    // FIX 1: mineflayer only updates lastSent.time when position moves, so the time
    // field is stale (frozen) in keepalive / look-only packets. Always stamp the current
    // performance.now() so the server's RTT / lag-compensation calculation is accurate.
    if (name === 'position' || name === 'position_look' || name === 'look') {
      data.time = performance.now()
    }

    // FIX 2: Don't send position packets for unloaded chunks — servers (and anti-cheats)
    // reject positions that don't correspond to a loaded column.
    // NOTE: teleport_confirm is intentionally excluded — it must be sent immediately as
    // a sync handshake regardless of chunk state, or the server freezes the player.
    if (name === 'position' || name === 'position_look' || name === 'look') {
      const chunkX = Math.floor(bot.entity.position.x / 16)
      const chunkZ = Math.floor(bot.entity.position.z / 16)
      const loadedColumns = bot.world.getColumns()
      const chunkLoaded = loadedColumns.some((c) => c.chunkX === chunkX && c.chunkZ === chunkZ)
      if (chunkLoaded) {
        // Only flush the single most-recent queued packet (if any) — flushing all of them
        // at once would look like instant teleportation to the server's anti-cheat.
        const pending = waitingPackets[name]
        if (pending?.length) {
          const latest = pending[pending.length - 1]!
          clientWrite(latest.name, latest.data)
          delete waitingPackets[name]
        }
      } else {
        // Keep only the latest — older queued positions are stale and should be dropped.
        waitingPackets[name] = [{ name, data }]
        return
      }
    }

    if (name === 'settings') {
      data['viewDistance'] = Math.max(data['viewDistance'], 3)
    }
    return clientWrite(name, data)
  }

  // PATCH INTERACTIONS
}
