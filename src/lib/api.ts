import { API_BASE_URL } from './constants'

const DEFAULT_TIMEOUT_MS = 30_000

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('session_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options ?? {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...fetchOptions,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...fetchOptions?.headers,
      },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new ApiError(res.status, body.error ?? res.statusText)
    }

    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// ─── Subscription Status ───
// 适配云API返回格式

interface CloudQuotaItem {
  used: number
  limit: number
  unit: string
}

interface CloudSubscriptionStatus {
  plan: 'free' | 'plus' | 'pro'
  subscription: {
    id: string
    status: string
    currentPeriodStart: string | Date
    currentPeriodEnd: string | Date
    cancelAtPeriodEnd: boolean
  } | null
  quota: {
    stt: CloudQuotaItem
    polish: CloudQuotaItem
    agent: CloudQuotaItem
    trial: CloudQuotaItem
    free: { used: number; unit: string }
    search: CloudQuotaItem
  }
}

export interface SubscriptionStatus {
  plan: 'free' | 'plus' | 'pro'
  subscriptionEnd: string | null
  cancelAtPeriodEnd: boolean
  // STT配额
  sttSecondsUsed: number
  sttSecondsLimit: number
  // Polish配额（润色功能）
  polishTokensUsed: number
  polishTokensLimit: number
  // Agent配额
  agentTokensUsed: number
  agentTokensLimit: number
  // 试用配额
  trialTokensUsed: number
  trialTokensLimit: number
  // 搜索配额
  searchRequestsUsed: number
  searchRequestsLimit: number
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  const data: CloudSubscriptionStatus = await request('/api/subscription/status')

  return {
    plan: data.plan,
    subscriptionEnd: data.subscription?.currentPeriodEnd
      ? new Date(data.subscription.currentPeriodEnd).toISOString()
      : null,
    cancelAtPeriodEnd: data.subscription?.cancelAtPeriodEnd ?? false,
    // STT
    sttSecondsUsed: data.quota?.stt?.used ?? 0,
    sttSecondsLimit: data.quota?.stt?.limit ?? 900,
    // Polish
    polishTokensUsed: data.quota?.polish?.used ?? 0,
    polishTokensLimit: data.quota?.polish?.limit ?? 100000,
    // Agent
    agentTokensUsed: data.quota?.agent?.used ?? 0,
    agentTokensLimit: data.quota?.agent?.limit ?? 100000,
    // Trial
    trialTokensUsed: data.quota?.trial?.used ?? 0,
    trialTokensLimit: data.quota?.trial?.limit ?? 30000,
    // Search
    searchRequestsUsed: data.quota?.search?.used ?? 0,
    searchRequestsLimit: data.quota?.search?.limit ?? 50,
  }
}

// ─── Checkout ───

export interface CheckoutResponse {
  sessionId: string
  url: string
}

export interface CheckoutParams {
  plan: 'plus' | 'pro'
  interval: 'monthly' | 'yearly'
  origin?: 'desktop' | 'web'
}

export function createCheckout(params: CheckoutParams): Promise<CheckoutResponse> {
  return request('/api/stripe/checkout', {
    method: 'POST',
    body: JSON.stringify({
      plan: params.plan,
      interval: params.interval,
      origin: params.origin ?? 'desktop',
    }),
  })
}

// ─── Portal ───

export function createPortalSession(origin: 'desktop' | 'web' = 'desktop'): Promise<{ url: string }> {
  return request('/api/stripe/portal', {
    method: 'POST',
    body: JSON.stringify({ origin }),
  })
}

// ─── Proxy STT ───

export async function proxyStt(audioBlob: Blob, language: string): Promise<{ text: string }> {
  const formData = new FormData()
  formData.append('audio', audioBlob)
  formData.append('language', language)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)

  try {
    const res = await fetch(`${API_BASE_URL}/api/proxy/stt`, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers: authHeaders(),
      body: formData,
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new ApiError(res.status, body.error ?? res.statusText)
    }

    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

// ─── Proxy LLM ───

export interface ProxyLlmParams {
  messages: Array<{ role: string; content: string }>
  model?: string
  type?: 'polish' | 'agent'
  stream?: boolean
}

export interface ProxyLlmResponse {
  text: string
  model: string
  tokens: number
}

export function proxyLlm(params: ProxyLlmParams): Promise<ProxyLlmResponse> {
  return request('/api/proxy/llm', {
    method: 'POST',
    body: JSON.stringify({
      messages: params.messages,
      model: params.model,
      type: params.type ?? 'polish',
      stream: params.stream ?? false,
    }),
  })
}

// ─── Backup ───

export function uploadBackup(data: {
  history?: unknown
  dictionary?: unknown
  settings?: unknown
}): Promise<{ success: boolean }> {
  return request('/api/backup/upload', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function downloadBackup(): Promise<{
  history?: unknown
  dictionary?: unknown
  settings?: unknown
}> {
  return request('/api/backup/download')
}

// ─── Models ───

export interface ModelInfo {
  id: string
  name: string
  description?: string
  type: 'polish' | 'agent'
  category: 'free' | 'value' | 'standard' | 'premium'
  costPerMillion?: number
  contextWindow?: number
  maxOutput?: number
  recommended?: boolean
  available: boolean
  reason?: string
}

export function getModels(): Promise<{ models: ModelInfo[] }> {
  return request('/api/models')
}

// ─── Proxy Search ───

export interface ProxySearchParams {
  query: string
  maxResults?: number
  country?: string
  searchLang?: string
  freshness?: string
}

export interface ProxySearchResult {
  title: string
  url: string
  description: string
  extra_snippets?: string[]
}

export interface ProxySearchResponse {
  results: ProxySearchResult[]
  query: string
  quota: {
    used: number
    limit: number
  }
}

export function proxySearch(params: ProxySearchParams): Promise<ProxySearchResponse> {
  return request('/api/proxy/search', {
    method: 'POST',
    body: JSON.stringify({
      query: params.query,
      maxResults: params.maxResults ?? 5,
      country: params.country,
      searchLang: params.searchLang,
      freshness: params.freshness,
    }),
  })
}

// ─── Scene Packs ───

export interface ScenePack {
  id: string
  name: string
  description: string
  category: string
  promptTemplate: string
  dictionaryTerms: Array<{ term: string; definition: string }>
  isPro: boolean
}

export function getScenePacks(): Promise<ScenePack[]> {
  return request('/api/scenes')
}
