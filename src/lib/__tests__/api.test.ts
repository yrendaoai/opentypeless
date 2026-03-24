import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError } from '../api'
import { API_BASE_URL } from '../constants'

const API_BASE = API_BASE_URL

describe('ApiError', () => {
  it('stores status and message', () => {
    const err = new ApiError(404, 'Not found')
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not found')
    expect(err.name).toBe('ApiError')
    expect(err).toBeInstanceOf(Error)
  })
})

describe('request() via getSubscriptionStatus', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            plan: 'pro',
            subscription: {
              id: 'sub_123',
              status: 'active',
              currentPeriodEnd: '2025-12-31',
              cancelAtPeriodEnd: false,
            },
            quota: {
              stt: { used: 100, limit: 36000, unit: 'seconds' },
              polish: { used: 5000, limit: 5000000, unit: 'tokens' },
              agent: { used: 1000, limit: 20000000, unit: 'tokens' },
              trial: { used: 0, limit: 0, unit: 'tokens' },
              free: { used: 500, unit: 'tokens' },
              search: { used: 10, limit: 800, unit: 'requests' },
            },
          }),
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls fetch with correct URL and options', async () => {
    const { getSubscriptionStatus } = await import('../api')
    await getSubscriptionStatus()

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/subscription/status`,
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('returns parsed JSON with transformed quota fields', async () => {
    const { getSubscriptionStatus } = await import('../api')
    const result = await getSubscriptionStatus()
    expect(result.plan).toBe('pro')
    expect(result.sttSecondsLimit).toBe(36000)
    expect(result.polishTokensLimit).toBe(5000000)
    expect(result.agentTokensLimit).toBe(20000000)
  })
})

describe('request() error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws ApiError with body.error on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () => Promise.resolve({ error: 'Subscription required' }),
      }),
    )

    const { getSubscriptionStatus } = await import('../api')
    await expect(getSubscriptionStatus()).rejects.toThrow('Subscription required')
    await expect(getSubscriptionStatus()).rejects.toBeInstanceOf(ApiError)
  })

  it('falls back to statusText when body has no error field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      }),
    )

    const { getSubscriptionStatus } = await import('../api')
    await expect(getSubscriptionStatus()).rejects.toThrow('Internal Server Error')
  })
})

describe('createCheckout', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends POST with origin in body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ url: 'https://checkout.stripe.com/xxx' }),
      }),
    )

    const { createCheckout } = await import('../api')
    const result = await createCheckout({ plan: 'plus', interval: 'monthly', origin: 'web' })

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/stripe/checkout`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ plan: 'plus', interval: 'monthly', origin: 'web' }),
      }),
    )
    expect(result.url).toBe('https://checkout.stripe.com/xxx')
  })
})

describe('proxyLlm', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends messages array as POST body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'polished text' }),
      }),
    )

    const { proxyLlm } = await import('../api')
    const messages = [{ role: 'user', content: 'hello' }]
    const result = await proxyLlm({ messages })

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/proxy/llm`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ messages, model: undefined, type: 'polish', stream: false }),
      }),
    )
    expect(result.text).toBe('polished text')
  })
})
