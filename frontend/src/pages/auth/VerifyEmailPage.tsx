import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { requestOtp, verifyEmail } from '../../api/auth'
import { ApiError, toApiError } from '../../api/errors'
import { useAuth } from '../../auth/AuthContext'
import { authState, type AuthPageState } from '../../auth/navigation'
import { takePendingLogin } from '../../auth/pendingLogin'
import { safeNext } from '../../auth/safeNext'
import { Alert, Button, FormPage, TextField } from '../../components/ui'
import { useCooldown } from '../../utils/useCooldown'

// The API accepts a new code at most once a minute (OTP.RESEND_COOLDOWN_SECONDS).
const RESEND_COOLDOWN_SECONDS = 60

export function VerifyEmailPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = authState(location.state)
  const next = safeNext(state.next ?? null)
  const [email, setEmail] = useState(state.email ?? '')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Arriving from sign-up / login, a code was just sent.
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS, Boolean(state.email))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await verifyEmail(email, otp)
      const pending = takePendingLogin(email)
      if (pending) {
        await login(pending.email, pending.password)
        navigate(next, { replace: true })
      } else {
        navigate('/login', { replace: true, state: { email, next, flash: 'verified' } satisfies AuthPageState })
      }
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setError(null)
    try {
      await requestOtp(email, 'EMAIL_VERIFICATION')
      cooldown.start()
      setInfo('Đã gửi mã mới. Mã cũ không dùng được nữa.')
    } catch (err) {
      setError(toApiError(err))
    }
  }

  return (
    <FormPage
      title="Xác minh email"
      subtitle={
        state.email ? (
          <>
            Nhập mã 6 số vừa gửi tới <strong>{state.email}</strong>. Mã có hiệu lực 10 phút.
          </>
        ) : (
          'Nhập email và mã 6 số đã gửi tới email đó.'
        )
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error.message}</Alert>}
        {info && !error && <Alert tone="info">{info}</Alert>}
        {!state.email && (
          <TextField label="Email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
        <TextField
          label="Mã xác minh"
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="••••••"
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
          className="[&_input]:text-center [&_input]:text-2xl [&_input]:tracking-[0.5em]"
        />
        <Button type="submit" loading={busy} disabled={otp.length !== 6 || !email} className="w-full">
          Xác minh
        </Button>
        <Button type="button" variant="ghost" onClick={resend} disabled={!email || cooldown.remaining > 0} className="w-full">
          {cooldown.remaining > 0 ? `Gửi lại mã sau ${cooldown.remaining} giây` : 'Gửi lại mã'}
        </Button>
      </form>
    </FormPage>
  )
}
