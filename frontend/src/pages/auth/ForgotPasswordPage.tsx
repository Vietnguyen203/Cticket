import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { requestOtp, resetPassword } from '../../api/auth'
import { ApiError, toApiError } from '../../api/errors'
import { authState, type AuthPageState } from '../../auth/navigation'
import { Alert, Button, FormPage, PasswordField, TextField } from '../../components/ui'
import { useCooldown } from '../../utils/useCooldown'

const RESEND_COOLDOWN_SECONDS = 60

/** Two steps: send a code to the email, then the code + a new password (logs out every device). */
export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [step, setStep] = useState<'email' | 'reset'>('email')
  const [email, setEmail] = useState(authState(location.state).email ?? '')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS)

  async function sendCode(event?: FormEvent) {
    event?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await requestOtp(email, 'PASSWORD_RESET')
      cooldown.start()
      setStep('reset')
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onReset(event: FormEvent) {
    event.preventDefault()
    if (password !== confirm) {
      setFieldErrors({ confirm: 'Mật khẩu nhập lại không khớp.' })
      return
    }
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      await resetPassword(email, otp, password)
      navigate('/login', { replace: true, state: { email, flash: 'reset' } satisfies AuthPageState })
    } catch (err) {
      const apiError = toApiError(err)
      const fields = apiError.fieldErrors()
      setFieldErrors({ ...fields, ...(fields.newPassword ? { password: fields.newPassword } : {}) })
      setError(apiError)
    } finally {
      setBusy(false)
    }
  }

  if (step === 'email') {
    return (
      <FormPage title="Quên mật khẩu" subtitle="Nhập email của tài khoản, chúng tôi sẽ gửi mã 6 số để đặt lại mật khẩu.">
        <form onSubmit={sendCode} className="space-y-4" noValidate>
          {error && <Alert>{error.message}</Alert>}
          <TextField label="Email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" loading={busy} disabled={!email} className="w-full">
            Gửi mã
          </Button>
          <p className="text-center text-sm">
            <Link to="/login" className="text-brand-700 hover:underline">
              Quay lại đăng nhập
            </Link>
          </p>
        </form>
      </FormPage>
    )
  }

  return (
    <FormPage
      title="Đặt lại mật khẩu"
      subtitle={
        <>
          Nếu <strong>{email}</strong> có tài khoản, mã 6 số đã được gửi tới đó (có hiệu lực 10 phút).
        </>
      }
    >
      <form onSubmit={onReset} className="space-y-4" noValidate>
        {error && <Alert>{error.message}</Alert>}
        <TextField
          label="Mã xác minh"
          name="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
        />
        <PasswordField
          label="Mật khẩu mới"
          name="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          hint="Ít nhất 8 ký tự, có cả chữ và số. Mọi thiết bị đang đăng nhập sẽ bị đăng xuất."
        />
        <PasswordField
          label="Nhập lại mật khẩu mới"
          name="confirm"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={fieldErrors.confirm}
        />
        <Button type="submit" loading={busy} disabled={otp.length !== 6 || !password} className="w-full">
          Đổi mật khẩu
        </Button>
        <Button type="button" variant="ghost" onClick={() => sendCode()} disabled={cooldown.remaining > 0} className="w-full">
          {cooldown.remaining > 0 ? `Gửi lại mã sau ${cooldown.remaining} giây` : 'Gửi lại mã'}
        </Button>
      </form>
    </FormPage>
  )
}
