/** Reusable low-level UI primitives for Persat Finance */
import { cn } from '../lib/utils'

export function Card({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl border p-5', className)}
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      {...props}
    >
      {children}
    </div>
  )
}

export function Badge({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold',
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className,
  disabled,
  style,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all disabled:cursor-not-allowed'
  const sizes = { sm: 'px-3 py-1.5 text-xs sm:text-sm whitespace-nowrap', md: 'px-4 py-2 text-sm text-center', lg: 'px-5 py-2.5 text-sm sm:px-6 sm:py-3 sm:text-base text-center' }
  const variants = {
    primary: 'text-[#0d1b2f]',
    secondary: 'text-[var(--ink)]',
    danger: 'text-white',
    ghost: 'text-[var(--subtle)]',
  }
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--accent)', color: '#0d1b2f' },
    secondary: { background: 'var(--surface-strong)', border: '1px solid var(--border)', color: 'var(--ink)' },
    danger: { background: 'var(--danger)', color: '#fff' },
    ghost: { background: 'transparent', color: 'var(--subtle)' },
  }
  // A disabled button looks the same whatever its variant, so the one action you can take is the only coloured one.
  const disabledStyle: React.CSSProperties = { background: 'transparent', border: '1px dashed var(--border)', color: 'var(--subtle)', opacity: 0.7 }
  return (
    <button
      className={cn(base, sizes[size], variants[variant], className)}
      style={disabled ? { ...styles[variant], ...style, ...disabledStyle } : { ...styles[variant], ...style }}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}

export function Input({
  label,
  hint,
  error,
  suffix,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string
  hint?: string
  error?: string
  suffix?: string
}) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      {label && (
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
          {label}
        </label>
      )}
      <div className="relative">
        <input
          className={cn(
            'w-full rounded-xl px-3 py-2.5 text-sm outline-none transition-all',
            'placeholder:text-[var(--subtle)]',
            suffix && 'pr-16 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
            className,
          )}
          style={{
            background: 'var(--surface-muted)',
            border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
            color: 'var(--ink)',
          }}
          {...props}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold" style={{ color: 'var(--subtle)' }}>
            {suffix}
          </span>
        )}
      </div>
      {hint && !error && <p className="text-xs" style={{ color: 'var(--subtle)' }}>{hint}</p>}
      {error && <p className="text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className="animate-spin"
      style={{ color: 'var(--accent)' }}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: React.ReactNode
  sub?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--subtle)' }}>
        {label}
      </p>
      <p className="display text-xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
        {value}
      </p>
      {sub && <p className="text-xs" style={{ color: 'var(--muted)' }}>{sub}</p>}
    </div>
  )
}

export function TxStatus({
  isPending,
  isConfirming,
  isSuccess,
  error,
  explorerUrl,
}: {
  isPending: boolean
  isConfirming: boolean
  isSuccess: boolean
  error?: string | null
  explorerUrl?: string
}) {
  if (!isPending && !isConfirming && !isSuccess && !error) return null
  return (
    <div
      className="rounded-xl px-4 py-3 text-sm flex items-center gap-2"
      style={{
        background: isSuccess
          ? 'rgba(141,216,159,0.1)'
          : error
          ? 'rgba(232,109,122,0.1)'
          : 'var(--surface)',
        border: `1px solid ${isSuccess ? 'var(--success)' : error ? 'var(--danger)' : 'var(--border)'}`,
        color: isSuccess ? 'var(--success)' : error ? 'var(--danger)' : 'var(--ink)',
      }}
    >
      {(isPending || isConfirming) && <Spinner size={14} />}
      <span>
        {isPending
          ? 'Confirm in wallet...'
          : isConfirming
          ? 'Confirming on-chain...'
          : isSuccess
          ? 'Transaction confirmed!'
          : error}
      </span>
      {isSuccess && explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto text-xs underline"
          style={{ color: 'var(--accent)' }}
        >
          View
        </a>
      )}
    </div>
  )
}
