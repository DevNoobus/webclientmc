import { useEffect, useState } from 'react'
import { proxy, useSnapshot } from 'valtio'
import { hideCurrentModal } from '../globalState'
import { useIsModalActive } from './utilsApp'

interface TradeItem {
  type: number
  count: number
  metadata?: number
  nbt?: any
  // we add a resolved display name after parsing
  displayName?: string
}

interface Trade {
  inputItem1: TradeItem | null
  inputItem2: TradeItem | null
  outputItem: TradeItem | null
  tradeDisabled: boolean
  nbTradeUses: number
  maximumNbTradeUses: number
  xp: number
  specialPrice: number
  priceMultiplier: number
  demand: number
}

interface VillagerState {
  trades: Trade[]
  villagerLevel: number
  experience: number
  isRegularVillager: boolean
  canRestock: boolean
  windowId: number
}

export const villagerState = proxy<{ current: VillagerState | null }>({ current: null })

const LEVEL_NAMES = ['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master']

const getItemName = (item: TradeItem | null): string => {
  if (!item || item.type === -1 || item.type === undefined) return ''
  try {
    const itemDef = loadedData.itemsArray.find((x) => x.id === item.type)
    return itemDef?.displayName ?? itemDef?.name ?? `Item #${item.type}`
  } catch {
    return `Item #${item.type}`
  }
}

const getItemTexture = (item: TradeItem | null): string | null => {
  if (!item || item.type === -1 || item.type === undefined) return null
  try {
    const itemDef = loadedData.itemsArray.find((x) => x.id === item.type)
    const name = itemDef?.name
    if (!name) return null
    return `https://minecraft.wiki/images/Invicon_${name.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join('_')}.png`
  } catch {
    return null
  }
}

const ItemBox = ({ item, disabled }: { item: TradeItem | null, disabled: boolean }) => {
  const [imgError, setImgError] = useState(false)
  const name = getItemName(item)
  const texUrl = getItemTexture(item)
  const isEmpty = !item || item.type === -1

  return (
    <div title={name} style={{
      width: 32,
      height: 32,
      background: disabled ? '#2a1a1a' : '#1a1a1a',
      border: `1px solid ${disabled ? '#553333' : '#555'}`,
      borderRadius: 2,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      flexShrink: 0,
    }}>
      {!isEmpty && texUrl && !imgError
        ? <img
            src={texUrl}
            alt={name}
            width={24}
            height={24}
            style={{ imageRendering: 'pixelated', opacity: disabled ? 0.4 : 1 }}
            onError={() => setImgError(true)}
          />
        : !isEmpty && <span style={{ fontSize: 8, color: disabled ? '#664444' : '#aaa', textAlign: 'center', lineHeight: 1.1, padding: 1 }}>{name || '?'}</span>
      }
      {!isEmpty && item.count > 1 && (
        <span style={{
          position: 'absolute',
          bottom: 1,
          right: 2,
          fontSize: 8,
          color: 'white',
          textShadow: '1px 1px 0 black',
          lineHeight: 1,
        }}>{item.count}</span>
      )}
    </div>
  )
}

const TradeRow = ({ trade, index, selected, onClick }: { trade: Trade, index: number, selected: boolean, onClick: () => void }) => {
  const disabled = trade.tradeDisabled
  const outOfStock = trade.nbTradeUses >= trade.maximumNbTradeUses

  return (
    <div
      onClick={disabled ? undefined : onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        borderRadius: 3,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: selected ? 'rgba(255,255,255,0.1)' : 'transparent',
        border: selected ? '1px solid #888' : '1px solid transparent',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
      }}
    >
      {/* Cost */}
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        <ItemBox item={trade.inputItem1} disabled={disabled} />
        {trade.inputItem2 && trade.inputItem2.type !== -1 && (
          <>
            <span style={{ color: '#888', fontSize: 12 }}>+</span>
            <ItemBox item={trade.inputItem2} disabled={disabled} />
          </>
        )}
      </div>
      {/* Arrow */}
      <span style={{ color: disabled ? '#553' : '#aa0', fontSize: 16, fontWeight: 'bold', marginLeft: 2, marginRight: 2 }}>→</span>
      {/* Result */}
      <ItemBox item={trade.outputItem} disabled={disabled} />
      {/* Stock indicator */}
      <div style={{ marginLeft: 'auto', fontSize: 9, color: outOfStock ? '#f66' : '#aaa', minWidth: 32, textAlign: 'right' }}>
        {outOfStock ? 'Out' : `${trade.maximumNbTradeUses - trade.nbTradeUses}`}
      </div>
    </div>
  )
}

export default () => {
  const isModalActive = useIsModalActive('player_win:VillagerWin')
  const state = useSnapshot(villagerState)
  const [selectedTrade, setSelectedTrade] = useState<number | null>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    // Clear selection when window closes
    if (!isModalActive) {
      setSelectedTrade(null)
      setStatus('')
    }
  }, [isModalActive])

  const handleSelectTrade = (index: number) => {
    const trade = villagerState.current?.trades[index]
    if (!trade || trade.tradeDisabled) return

    setSelectedTrade(index)
    setStatus('')

    try {
      bot._client.write('select_trade', { slot: index })
    } catch (err) {
      console.error('[VillagerTrading] failed to send select_trade:', err)
    }
  }

  const handleTrade = () => {
    if (selectedTrade === null || !villagerState.current) return
    const trade = villagerState.current.trades[selectedTrade]
    if (!trade || trade.tradeDisabled) return

    // Put items in slots 0 and 1, then click the output slot (slot 2) to complete the trade
    try {
      // Simple click on the output slot (slot 2 in villager window) — server handles the item transfer
      bot._client.write('window_click', {
        windowId: villagerState.current.windowId,
        stateId: (bot.currentWindow as any)?.stateId ?? 0,
        slot: 2, // output slot
        mouseButton: 0,
        mode: 0,
        changedSlots: [],
        cursorItem: { present: false },
      })
      setStatus('Trade sent!')
      setTimeout(() => setStatus(''), 1500)
    } catch (err) {
      console.error('[VillagerTrading] failed to send window_click:', err)
      setStatus('Trade failed')
    }
  }

  if (!isModalActive || !state.current) return null

  const { trades, villagerLevel, isRegularVillager } = state.current
  const levelName = LEVEL_NAMES[(villagerLevel - 1)] ?? `Level ${villagerLevel}`

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
      background: 'rgba(0,0,0,0.6)',
    }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) { bot.currentWindow?.['close'](); hideCurrentModal() } }}
    >
      <div style={{
        background: '#1e1e1e',
        border: '1px solid #444',
        borderRadius: 6,
        padding: 16,
        width: 320,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        boxShadow: '0 4px 32px rgba(0,0,0,0.8)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: '#fff', fontWeight: 'bold', fontSize: 14 }}>
              {isRegularVillager ? `Villager — ${levelName}` : 'Wandering Trader'}
            </div>
            <div style={{ color: '#888', fontSize: 10 }}>Select a trade below</div>
          </div>
          <button
            onClick={() => { bot.currentWindow?.['close'](); hideCurrentModal() }}
            style={{ background: 'none', border: 'none', color: '#aaa', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
          >✕</button>
        </div>

        {/* Trade list */}
        <div style={{
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          maxHeight: 360,
        }}>
          {trades.length === 0 && (
            <div style={{ color: '#666', fontSize: 12, textAlign: 'center', padding: 20 }}>No trades available</div>
          )}
          {trades.map((trade, i) => (
            <TradeRow
              key={i}
              trade={trade as Trade}
              index={i}
              selected={selectedTrade === i}
              onClick={() => handleSelectTrade(i)}
            />
          ))}
        </div>

        {/* Trade button */}
        {selectedTrade !== null && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, color: '#888', textAlign: 'center' }}>
              Put items in your hand to trade: <strong style={{ color: '#ccc' }}>{getItemName(trades[selectedTrade]?.inputItem1 as any)}</strong>
              {trades[selectedTrade]?.inputItem2 && trades[selectedTrade].inputItem2!.type !== -1 &&
                <> + <strong style={{ color: '#ccc' }}>{getItemName(trades[selectedTrade].inputItem2 as any)}</strong></>}
              {' → '}<strong style={{ color: '#ff9' }}>{getItemName(trades[selectedTrade]?.outputItem as any)}</strong>
            </div>
            <button
              onClick={handleTrade}
              style={{
                background: '#2a5f2a',
                border: '1px solid #4a9f4a',
                color: 'white',
                borderRadius: 4,
                padding: '6px 14px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 'bold',
              }}
            >Trade</button>
            {status && <div style={{ color: status.includes('failed') ? '#f66' : '#6f6', fontSize: 11, textAlign: 'center' }}>{status}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
