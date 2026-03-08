import { useState } from 'react'
import Button from './Button'
import { showNotification } from './NotificationProvider'
import { getCurrentProxy } from './ServersList'
import { AuthenticatedAccount } from './serversStorage'

export interface RealmInfo {
  id: number
  name: string
  motd: string
  state: string
  owner: string
  maxPlayers: number
  expired: boolean
  platform: 'java' | 'bedrock'
}

interface Props {
  onClose: () => void
  onConnectRealm: (host: string, port: number, platform: 'java' | 'bedrock') => void
  authenticatedAccounts: readonly AuthenticatedAccount[]
}

async function callRealmsEndpoint (endpoint: string, body: Record<string, any>) {
  let proxy = getCurrentProxy()
  if (!proxy) throw new Error('No proxy configured. Set a proxy (e.g. localhost:8080) to use Realms.')
  if (!proxy.startsWith('http')) proxy = `http://${proxy}`
  const res = await fetch(`${proxy}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json
}

function getCachedTokens (accounts: readonly AuthenticatedAccount[]) {
  // Merge all cached token data objects; prismarine-auth caches by key name
  const merged: Record<string, any> = {}
  for (const acc of accounts) {
    if (acc.cachedTokens?.data && typeof acc.cachedTokens.data === 'object') {
      Object.assign(merged, acc.cachedTokens.data)
    }
  }
  return merged
}

export default ({ onClose, onConnectRealm, authenticatedAccounts }: Props) => {
  const [platform, setPlatform] = useState<'java' | 'bedrock'>('java')
  const [realms, setRealms] = useState<RealmInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connectingId, setConnectingId] = useState<number | null>(null)

  const fetchRealms = async (p: 'java' | 'bedrock') => {
    setLoading(true)
    setError(null)
    setRealms(null)
    try {
      const cached = getCachedTokens(authenticatedAccounts)
      const data = await callRealmsEndpoint('/realms/list', { platform: p, ...cached })
      setRealms(data.realms ?? [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const connectRealm = async (realm: RealmInfo) => {
    if (realm.platform === 'bedrock') {
      showNotification('Bedrock Realms are not playable in this Java web client. Address shown for reference only.', '', true)
      return
    }
    setConnectingId(realm.id)
    try {
      const cached = getCachedTokens(authenticatedAccounts)
      const address = await callRealmsEndpoint('/realms/address', {
        platform: realm.platform,
        realmId: realm.id,
        ...cached
      })
      onConnectRealm(address.host, address.port, realm.platform)
      onClose()
    } catch (err: any) {
      showNotification('Failed to get realm address: ' + err.message, '', true)
    } finally {
      setConnectingId(null)
    }
  }

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  }
  const dialog: React.CSSProperties = {
    background: '#2a2a2a', border: '1px solid #555', padding: 20,
    minWidth: 420, maxWidth: 600, maxHeight: '80vh', display: 'flex',
    flexDirection: 'column', gap: 10, color: '#fff', fontSize: 13,
  }
  const headerRow: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  }
  const tabRow: React.CSSProperties = {
    display: 'flex', gap: 6,
  }
  const realmList: React.CSSProperties = {
    overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, flex: 1,
  }
  const realmRow: React.CSSProperties = {
    background: '#1a1a1a', border: '1px solid #444', padding: '8px 10px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  }

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={dialog}>
        <div style={headerRow}>
          <span style={{ fontWeight: 'bold', fontSize: 15 }}>Minecraft Realms</span>
          <Button onClick={onClose} style={{ padding: '0 8px', height: 20, fontSize: 11 }}>✕ Close</Button>
        </div>

        <div style={tabRow}>
          <Button
            style={{ padding: '2px 10px', fontWeight: platform === 'java' ? 'bold' : 'normal', opacity: platform === 'java' ? 1 : 0.6 }}
            onClick={() => setPlatform('java')}
          >Java</Button>
          <Button
            style={{ padding: '2px 10px', fontWeight: platform === 'bedrock' ? 'bold' : 'normal', opacity: platform === 'bedrock' ? 1 : 0.6 }}
            onClick={() => setPlatform('bedrock')}
          >Bedrock</Button>
          <Button
            style={{ padding: '2px 10px', marginLeft: 'auto' }}
            onClick={() => fetchRealms(platform)}
            disabled={loading}
          >{loading ? 'Loading…' : 'Fetch Realms'}</Button>
        </div>

        {authenticatedAccounts.length === 0 && (
          <div style={{ color: '#f90', fontSize: 12 }}>
            ⚠ Sign in with a Microsoft account first (use the "+ MS Account" button).
          </div>
        )}

        {error && <div style={{ color: '#f55', fontSize: 12 }}>Error: {error}</div>}

        <div style={realmList}>
          {realms === null && !loading && (
            <div style={{ color: '#aaa', fontSize: 12, padding: 8 }}>
              Click "Fetch Realms" to load your {platform === 'java' ? 'Java' : 'Bedrock'} Realms.
            </div>
          )}
          {realms?.length === 0 && (
            <div style={{ color: '#aaa', fontSize: 12, padding: 8 }}>No Realms found for this account.</div>
          )}
          {realms?.map(realm => (
            <div key={realm.id} style={realmRow}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {realm.name || '(no name)'}
                  {realm.expired && <span style={{ color: '#f55', marginLeft: 6, fontSize: 11 }}>[Expired]</span>}
                </span>
                {realm.motd && <span style={{ color: '#aaa', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{realm.motd}</span>}
                <span style={{ color: '#888', fontSize: 10 }}>
                  Owner: {realm.owner} · {realm.state} · {realm.maxPlayers} players · {realm.platform}
                </span>
              </div>
              <Button
                disabled={realm.expired || connectingId === realm.id}
                style={{ whiteSpace: 'nowrap', padding: '2px 10px', fontSize: 11 }}
                onClick={() => connectRealm(realm)}
              >
                {connectingId === realm.id ? 'Joining…' : realm.platform === 'bedrock' ? 'Info' : 'Join'}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
