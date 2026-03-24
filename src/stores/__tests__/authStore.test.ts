import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useAuthStore } from '../authStore'

// Mock external dependencies
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../lib/auth-client', () => ({
  authClient: {
    getSession: vi.fn(),
    signIn: { email: vi.fn() },
    signUp: { email: vi.fn() },
    signOut: vi.fn(),
  },
}))

vi.mock('../../lib/api', () => ({
  getSubscriptionStatus: vi.fn(),
}))

vi.mock('../../components/Toast', () => ({
  toast: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'
import { authClient } from '../../lib/auth-client'
import { getSubscriptionStatus } from '../../lib/api'

function getState() {
  return useAuthStore.getState()
}

describe('authStore', () => {
  beforeEach(() => {
    // Reset store state
    useAuthStore.setState({
      user: null,
      plan: 'free',
      subscriptionEnd: null,
      sttSecondsUsed: 0,
      sttSecondsLimit: 0,
      polishTokensUsed: 0,
      polishTokensLimit: 0,
      agentTokensUsed: 0,
      agentTokensLimit: 0,
      loading: false,
      error: null,
    })

    // Set up mock implementations fresh each test
    vi.mocked(invoke).mockResolvedValue(undefined)
    vi.mocked(authClient.getSession).mockResolvedValue({ data: null } as never)
    vi.mocked(authClient.signOut).mockResolvedValue(undefined as never)
    vi.mocked(getSubscriptionStatus).mockResolvedValue({
      plan: 'pro',
      subscriptionEnd: '2025-12-31',
      cancelAtPeriodEnd: false,
      sttSecondsUsed: 100,
      sttSecondsLimit: 36000,
      polishTokensUsed: 5000,
      polishTokensLimit: 5000000,
      agentTokensUsed: 12000,
      agentTokensLimit: 200000,
      trialTokensUsed: 0,
      trialTokensLimit: 0,
      searchRequestsUsed: 0,
      searchRequestsLimit: 800,
    })
  })

  describe('initial state', () => {
    it('starts with no user and free plan', () => {
      expect(getState().user).toBeNull()
      expect(getState().plan).toBe('free')
      expect(getState().loading).toBe(false)
      expect(getState().error).toBeNull()
    })
  })

  describe('signOut', () => {
    it('clears user and resets to free plan', async () => {
      useAuthStore.setState({
        user: { id: '1', email: 'test@example.com', name: 'Test' },
        plan: 'pro',
        subscriptionEnd: '2025-12-31',
        sttSecondsUsed: 100,
        sttSecondsLimit: 36000,
        polishTokensUsed: 5000,
        polishTokensLimit: 5000000,
        agentTokensUsed: 12000,
        agentTokensLimit: 200000,
      })

      await getState().signOut()

      expect(getState().user).toBeNull()
      expect(getState().plan).toBe('free')
      expect(getState().subscriptionEnd).toBeNull()
      expect(getState().sttSecondsUsed).toBe(0)
      expect(getState().polishTokensUsed).toBe(0)
      expect(getState().agentTokensUsed).toBe(0)
    })
  })

  describe('refreshSubscription', () => {
    it('updates quota fields from API response', async () => {
      useAuthStore.setState({
        user: { id: '1', email: 'test@example.com', name: 'Test' },
      })

      await getState().refreshSubscription()

      expect(getState().plan).toBe('pro')
      expect(getState().subscriptionEnd).toBe('2025-12-31')
      expect(getState().sttSecondsUsed).toBe(100)
      expect(getState().sttSecondsLimit).toBe(36000)
      expect(getState().polishTokensUsed).toBe(5000)
      expect(getState().polishTokensLimit).toBe(5000000)
      expect(getState().agentTokensUsed).toBe(12000)
      expect(getState().agentTokensLimit).toBe(200000)
    })
  })

  describe('initialize', () => {
    it('sets loading during initialization', async () => {
      const promise = getState().initialize()
      expect(getState().loading).toBe(true)
      await promise
      expect(getState().loading).toBe(false)
    })

    it('stays null user when no session exists', async () => {
      await getState().initialize()
      expect(getState().user).toBeNull()
    })
  })
})
