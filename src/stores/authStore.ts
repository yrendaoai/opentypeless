import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { authClient } from '../lib/auth-client'
import { getSubscriptionStatus } from '../lib/api'
import { toast } from '../lib/toast'

let sttWarningShown = false
let llmWarningShown = false
let agentWarningShown = false

export interface AuthUser {
  id: string
  email: string
  name: string | null
}

interface AuthState {
  // User
  user: AuthUser | null
  plan: 'free' | 'plus' | 'pro'
  subscriptionEnd: string | null
  cancelAtPeriodEnd: boolean
  cloudAuthState: 'ready' | 'cloud_auth_incomplete'

  // Quotas
  sttSecondsUsed: number
  sttSecondsLimit: number
  polishTokensUsed: number
  polishTokensLimit: number
  agentTokensUsed: number
  agentTokensLimit: number
  trialTokensUsed: number
  trialTokensLimit: number
  searchRequestsUsed: number
  searchRequestsLimit: number

  // Loading
  loading: boolean
  error: string | null
  emailVerificationPending: boolean
  pendingEmail: string | null

  // Checkout flow
  checkoutPending: boolean

  // Actions
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, name: string) => Promise<void>
  resendVerification: () => Promise<void>
  signOut: () => Promise<void>
  refreshSubscription: () => Promise<void>
  handleDeepLinkToken: (token: string) => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  plan: 'free',
  subscriptionEnd: null,
  cancelAtPeriodEnd: false,
  cloudAuthState: 'ready',
  sttSecondsUsed: 0,
  sttSecondsLimit: 0,
  polishTokensUsed: 0,
  polishTokensLimit: 0,
  agentTokensUsed: 0,
  agentTokensLimit: 0,
  trialTokensUsed: 0,
  trialTokensLimit: 0,
  searchRequestsUsed: 0,
  searchRequestsLimit: 0,
  loading: false,
  error: null,
  emailVerificationPending: false,
  pendingEmail: null,
  checkoutPending: false,

  initialize: async () => {
    try {
      set({ loading: true, error: null })
      const { data: session } = await authClient.getSession()
      if (session?.user) {
        const savedToken = localStorage.getItem('session_token')?.trim() || ''
        set({
          user: {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name ?? null,
          },
          cloudAuthState: savedToken ? 'ready' : 'cloud_auth_incomplete',
        })
        // Push saved session token to Rust for cloud providers
        if (savedToken) {
          await invoke('set_session_token', { token: savedToken }).catch((e) => {
            console.error('Failed to sync session token to backend:', e)
          })
        }
        await get().refreshSubscription()
      }
    } catch {
      // Not logged in — that's fine
    } finally {
      set({ loading: false })
    }
  },

  signIn: async (email, password) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await authClient.signIn.email(
        { email, password },
        {
          onSuccess: async (ctx) => {
            const token = ctx.response.headers.get('set-auth-token')
            if (token) {
              localStorage.setItem('session_token', token)
              await invoke('set_session_token', { token }).catch((e: unknown) => {
                console.error('Failed to sync session token to backend:', e)
              })
              set({ cloudAuthState: 'ready' })
            }
          },
        },
      )
      if (error) {
        if (error.code === 'EMAIL_NOT_VERIFIED') {
          set({ emailVerificationPending: true, pendingEmail: email })
          return
        }
        throw new Error(error.message ?? 'Sign in failed')
      }
      if (data?.user) {
        const savedToken = localStorage.getItem('session_token')?.trim() || ''
        set({
          user: {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name ?? null,
          },
          cloudAuthState: savedToken ? 'ready' : 'cloud_auth_incomplete',
        })
        await get().refreshSubscription()
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign in failed'
      set({ error: msg })
      throw e
    } finally {
      set({ loading: false })
    }
  },

  signUp: async (email, password, name) => {
    set({ loading: true, error: null, emailVerificationPending: false })
    try {
      const { error } = await authClient.signUp.email(
        { email, password, name },
        {
          onSuccess: async (ctx) => {
            const token = ctx.response.headers.get('set-auth-token')
            if (token) {
              localStorage.setItem('session_token', token)
              await invoke('set_session_token', { token }).catch((e: unknown) => {
                console.error('Failed to sync session token to backend:', e)
              })
              set({ cloudAuthState: 'ready' })
            }
          },
        },
      )
      if (error) throw new Error(error.message ?? 'Sign up failed')
      // Email verification is required — don't set user yet
      set({ emailVerificationPending: true, pendingEmail: email })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign up failed'
      set({ error: msg })
      throw e
    } finally {
      set({ loading: false })
    }
  },

  resendVerification: async () => {
    const email = get().pendingEmail
    if (!email) return
    set({ loading: true, error: null })
    try {
      const { error } = await authClient.sendVerificationEmail({ email })
      if (error) throw new Error(error.message ?? 'Failed to resend')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to resend verification email'
      set({ error: msg })
    } finally {
      set({ loading: false })
    }
  },

  signOut: async () => {
    try {
      await authClient.signOut()
    } finally {
      // Clear session token in localStorage and Rust
      localStorage.removeItem('session_token')
      await invoke('set_session_token', { token: '' }).catch((e: unknown) => {
        console.error('Failed to clear session token in backend:', e)
      })
      set({
        user: null,
        plan: 'free',
        subscriptionEnd: null,
        cancelAtPeriodEnd: false,
        sttSecondsUsed: 0,
        sttSecondsLimit: 0,
        polishTokensUsed: 0,
        polishTokensLimit: 0,
        agentTokensUsed: 0,
        agentTokensLimit: 0,
        trialTokensUsed: 0,
        trialTokensLimit: 0,
        searchRequestsUsed: 0,
        searchRequestsLimit: 0,
        error: null,
        emailVerificationPending: false,
        pendingEmail: null,
        checkoutPending: false,
        cloudAuthState: 'ready',
      })
      sttWarningShown = false
      llmWarningShown = false
      agentWarningShown = false
    }
  },

  refreshSubscription: async () => {
    try {
      const status = await getSubscriptionStatus()
      set({
        plan: status.plan,
        subscriptionEnd: status.subscriptionEnd,
        cancelAtPeriodEnd: status.cancelAtPeriodEnd,
        sttSecondsUsed: status.sttSecondsUsed,
        sttSecondsLimit: status.sttSecondsLimit,
        polishTokensUsed: status.polishTokensUsed,
        polishTokensLimit: status.polishTokensLimit,
        agentTokensUsed: status.agentTokensUsed,
        agentTokensLimit: status.agentTokensLimit,
        trialTokensUsed: status.trialTokensUsed,
        trialTokensLimit: status.trialTokensLimit,
        searchRequestsUsed: status.searchRequestsUsed,
        searchRequestsLimit: status.searchRequestsLimit,
      })
      // Clear checkout pending flag after first post-checkout refresh
      if (get().checkoutPending) {
        set({ checkoutPending: false })
      }
      if (
        status.sttSecondsLimit > 0 &&
        status.sttSecondsUsed / status.sttSecondsLimit >= 0.9 &&
        !sttWarningShown
      ) {
        toast('STT quota is above 90%. Consider upgrading your plan.', 'error')
        sttWarningShown = true
      }
      if (
        status.polishTokensLimit > 0 &&
        status.polishTokensUsed / status.polishTokensLimit >= 0.9 &&
        !llmWarningShown
      ) {
        toast('Polish quota is above 90%. Consider upgrading your plan.', 'error')
        llmWarningShown = true
      }
      if (
        status.agentTokensLimit > 0 &&
        status.agentTokensUsed / status.agentTokensLimit >= 0.9 &&
        !agentWarningShown
      ) {
        toast('Agent quota is above 90%. Consider upgrading your plan.', 'error')
        agentWarningShown = true
      }
    } catch (e) {
      console.warn('Failed to refresh subscription status:', e instanceof Error ? e.message : e)
    }
  },

  handleDeepLinkToken: async (token: string) => {
    try {
      set({ loading: true, error: null })
      localStorage.setItem('session_token', token)
      await invoke('set_session_token', { token }).catch((e: unknown) => {
        console.error('Failed to sync session token to backend:', e)
      })
      set({ cloudAuthState: 'ready' })
      const { data: session } = await authClient.getSession({
        fetchOptions: {
          headers: { Authorization: `Bearer ${token}` },
        },
      })
      if (session?.user) {
        set({
          user: {
            id: session.user.id,
            email: session.user.email,
            name: session.user.name ?? null,
          },
        })
        await get().refreshSubscription()
      }
    } catch {
      set({ error: 'Failed to authenticate with token' })
    } finally {
      set({ loading: false })
    }
  },
}))
