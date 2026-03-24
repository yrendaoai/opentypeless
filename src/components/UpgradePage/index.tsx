import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Crown, Loader2, Zap } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useAuthStore } from '../../stores/authStore'
import { PLUS_PLAN, PRO_PLAN } from '../../lib/constants'
import { createCheckout, createPortalSession, type CheckoutParams } from '../../lib/api'

type PlanType = 'plus' | 'pro'
type IntervalType = 'monthly' | 'yearly'

export function UpgradePage() {
  const { user, plan, sttSecondsUsed, sttSecondsLimit, polishTokensUsed, polishTokensLimit, agentTokensUsed, agentTokensLimit } =
    useAuthStore()
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<PlanType>('plus')
  const [selectedInterval, setSelectedInterval] = useState<IntervalType>('monthly')

  const isPaid = plan === 'plus' || plan === 'pro'

  const handleSubscribe = async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const params: CheckoutParams = {
        plan: selectedPlan,
        interval: selectedInterval,
        origin: 'desktop',
      }
      const { url } = await createCheckout(params)
      useAuthStore.setState({ checkoutPending: true })
      await openUrl(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create checkout')
    } finally {
      setLoading(false)
    }
  }

  const handleManage = async () => {
    setLoading(true)
    setError(null)
    try {
      const { url } = await createPortalSession('desktop')
      await openUrl(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open portal')
    } finally {
      setLoading(false)
    }
  }

  const plans = [
    { key: 'plus' as const, ...PLUS_PLAN },
    { key: 'pro' as const, ...PRO_PLAN },
  ]

  return (
    <div className="max-w-[600px] mx-auto py-8 px-6 text-[13px]">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 mb-2">
          <Crown size={20} className="text-amber-500" />
          <h1 className="text-[20px] font-semibold text-text-primary">{t('upgrade.title')}</h1>
        </div>
        <p className="text-text-secondary">{t('upgrade.subtitle')}</p>
      </div>

      {/* Current plan badge */}
      <div className="flex items-center justify-center mb-6">
        <span
          className={`px-3 py-1 rounded-full text-[12px] font-medium ${
            isPaid ? 'bg-amber-500/10 text-amber-600' : 'bg-bg-secondary text-text-secondary'
          }`}
        >
          {t('upgrade.currentPlan', { plan: plan === 'pro' ? 'Pro' : plan === 'plus' ? 'Plus' : t('upgrade.free') })}
        </span>
      </div>

      {/* Usage stats for paid users */}
      {isPaid && (
        <div className="border border-border rounded-[10px] overflow-hidden mb-5">
          <div className="px-4 py-2.5 bg-bg-secondary/50 border-b border-border">
            <h3 className="text-[13px] font-medium text-text-primary">
              {t('upgrade.usageThisMonth')}
            </h3>
          </div>
          <div className="px-4 py-3 space-y-3">
            <QuotaBar
              label={t('upgrade.stt')}
              used={sttSecondsUsed}
              limit={sttSecondsLimit}
              unit="hours"
              divisor={3600}
            />
            <QuotaBar
              label="Polish"
              used={polishTokensUsed}
              limit={polishTokensLimit}
              unit="tokens"
              divisor={1_000_000}
            />
            <QuotaBar
              label="Agent"
              used={agentTokensUsed}
              limit={agentTokensLimit}
              unit="tokens"
              divisor={1_000_000}
            />
          </div>
        </div>
      )}

      {/* Plan selection for non-paid users */}
      {!isPaid && (
        <>
          {/* Interval toggle */}
          <div className="flex justify-center mb-4">
            <div className="inline-flex bg-bg-secondary rounded-lg p-1">
              <button
                onClick={() => setSelectedInterval('monthly')}
                className={`px-4 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                  selectedInterval === 'monthly'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setSelectedInterval('yearly')}
                className={`px-4 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                  selectedInterval === 'yearly'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Yearly (Save 17%)
              </button>
            </div>
          </div>

          {/* Plan cards */}
          <div className="grid grid-cols-2 gap-4 mb-5">
            {plans.map((p) => (
              <button
                key={p.key}
                onClick={() => setSelectedPlan(p.key)}
                className={`border rounded-[10px] p-4 text-left transition-all ${
                  selectedPlan === p.key
                    ? 'border-accent bg-accent/5'
                    : 'border-border hover:border-accent/50'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  {p.key === 'pro' && <Zap size={14} className="text-amber-500" />}
                  <span className="text-[14px] font-medium text-text-primary">
                    {p.key === 'plus' ? 'Plus' : 'Pro'}
                  </span>
                </div>
                <p className="text-[20px] font-semibold text-text-primary">
                  {p.price}
                  <span className="text-[12px] font-normal text-text-secondary"> / {p.period}</span>
                </p>
              </button>
            ))}
          </div>

          {/* Features */}
          <div className="border border-border rounded-[10px] overflow-hidden mb-5">
            <div className="px-4 py-3 bg-bg-secondary/50 border-b border-border">
              <h3 className="text-[13px] font-medium text-text-primary">
                {selectedPlan === 'plus' ? 'Plus' : 'Pro'} Features
              </h3>
            </div>
            <div>
              {(selectedPlan === 'plus' ? PLUS_PLAN : PRO_PLAN).features.map((f) => (
                <div
                  key={f.label}
                  className="flex items-start gap-2.5 px-4 py-2.5 border-b border-border last:border-b-0"
                >
                  <Check size={14} className="text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-text-primary">{f.label}</span>
                    <span className="text-text-tertiary ml-1.5 text-[12px]">{f.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Action buttons */}
      {isPaid ? (
        <button
          onClick={handleManage}
          disabled={loading}
          className="w-full py-2.5 rounded-[8px] border border-border text-text-primary text-[13px] font-medium cursor-pointer hover:bg-bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          {t('upgrade.manageSubscription')}
        </button>
      ) : (
        <>
          {!user && (
            <p className="text-text-tertiary text-[12px] text-center mb-3">
              {t('upgrade.signInFirst')}
            </p>
          )}
          <button
            onClick={handleSubscribe}
            disabled={loading || !user}
            className="w-full py-2.5 rounded-[8px] bg-accent text-white text-[13px] font-medium cursor-pointer border-none hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {t('upgrade.subscribeTo')} {selectedPlan === 'plus' ? 'Plus' : 'Pro'}
          </button>
          {error && <p className="text-red-500 text-[12px] mt-2 text-center">{error}</p>}
        </>
      )}
    </div>
  )
}

function QuotaBar({
  label,
  used,
  limit,
  unit,
  divisor,
}: {
  label: string
  used: number
  limit: number
  unit: string
  divisor: number
}) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0

  // Format numbers with appropriate suffix
  const formatValue = (val: number): string => {
    const display = val / divisor
    if (divisor === 1_000_000 && display >= 1) {
      return `${display.toFixed(1)}M`
    }
    if (divisor === 1000 && display >= 1) {
      return `${display.toFixed(1)}k`
    }
    return display.toFixed(1)
  }

  const usedDisplay = formatValue(used)
  const limitDisplay = formatValue(limit)

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[12px]">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-tertiary">
          {usedDisplay} / {limitDisplay} {unit}
        </span>
      </div>
      <div
        className="h-1.5 bg-bg-secondary rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
