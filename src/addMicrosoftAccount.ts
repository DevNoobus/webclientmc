import { ref } from 'valtio'
import microsoftAuthflow from './microsoftAuthflow'
import { signInMessageState } from './react/SignInMessageProvider'
import { updateAuthenticatedAccountData } from './react/serversStorage'
import { showNotification } from './react/NotificationProvider'

/**
 * Perform a standalone Microsoft authentication and save the resulting account
 * to appStorage.authenticatedAccounts.
 *
 * Uses the same microsoftAuthflow + signInMessageState machinery as the normal
 * bot-connect path, so the existing sign-in screen (code, QR, countdown,
 * cancel button) is shown automatically.
 */
export async function addMicrosoftAccount (proxyBaseUrl: string): Promise<string> {
  console.log('[MSAuth] addMicrosoftAccount called, proxy:', proxyBaseUrl)
  let newCache: any = {}
  let authData: Awaited<ReturnType<typeof microsoftAuthflow>>
  try {
    authData = await microsoftAuthflow({
      tokenCaches: {},
      proxyBaseUrl,
      setProgressText (text: string) {
        console.log('[MSAuth] progress:', text)
        showNotification(text)
      },
      setCacheResult (result: any) {
        console.log('[MSAuth] cache result received, keys:', Object.keys(result ?? {}))
        newCache = result
      },
      connectingServer: ''
    })
  } catch (err: any) {
    console.error('[MSAuth] microsoftAuthflow() failed:', err)
    throw err
  }
  console.log('[MSAuth] microsoftAuthflow() resolved, wiring code callback')

  // Wire device-code callback → existing SignInMessageProvider screen
  signInMessageState.abortController = ref(new AbortController())
  authData.setOnMsaCodeCallback((codeData: any) => {
    console.log('[MSAuth] device code received:', codeData.user_code, '->', codeData.verification_uri)
    signInMessageState.code = codeData.user_code
    signInMessageState.link = codeData.verification_uri
    signInMessageState.expiresOn = Date.now() + codeData.expires_in * 1000
    console.log('[MSAuth] signInMessageState updated, code:', signInMessageState.code)
  })

  console.log('[MSAuth] calling getMinecraftJavaToken')
  try {
    const result = await Promise.race([
      authData.authFlow.getMinecraftJavaToken(),
      new Promise<never>((_r, reject) => {
        signInMessageState.abortController.signal.addEventListener('abort', () => {
          reject(new Error('Cancelled by user'))
        })
      })
    ]) as any

    console.log('[MSAuth] getMinecraftJavaToken resolved:', JSON.stringify(result)?.slice(0, 300))
    const username: string = result?.profile?.name ?? result?.name ?? 'Microsoft Account'
    console.log('[MSAuth] username:', username)

    updateAuthenticatedAccountData(accounts => [
      ...accounts.filter(a => a.username !== username),
      { username, cachedTokens: { data: newCache, expiresOn: Date.now() + 86_400_000 } }
    ])

    return username
  } catch (err: any) {
    console.error('[MSAuth] getMinecraftJavaToken failed:', err)
    throw err
  } finally {
    signInMessageState.code = ''
  }
}
