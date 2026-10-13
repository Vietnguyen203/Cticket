import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { requestOtp } from '../../api/auth'
import { ApiError, toApiError } from '../../api/errors'
import { useAuth } from '../../auth/AuthContext'
import { authState, type AuthPageState } from '../../auth/navigation'
import { rememberPendingLogin } from '../../auth/pendingLogin'
import { safeNext } from '../../auth/safeNext'
import { Alert, Button, FormPage, TextField } from '../../components/ui'

const FLASH = {
  verified: 'Email đã được xác minh. Mời bạn đăng nhập.',
  reset: 'Đã đổi mật khẩu. Mời bạn đăng nhập bằng mật khẩu mới.',
}

export function LoginPage() {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const state = authState(location.state)
  const next = safeNext(params.get('next') ?? state.next ?? null)
  const [email, setEmail] = useState(state.email ?? '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  if (status === 'authenticated') return <Navigate to={next} replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password, remember)
      navigate(next, { replace: true })
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  // The account exists but its email was never verified: send a new code and go enter it.
  async function verifyNow() {
    setBusy(true)
    try {
      await requestOtp(email, 'EMAIL_VERIFICATION')
      rememberPendingLogin(email, password)
      navigate('/verify-email', { state: { email, next } satisfies AuthPageState })
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormPage
      title="Đăng nhập"
      subtitle={
        <>
          Chưa có tài khoản?{' '}
          <Link to="/register" state={{ next } satisfies AuthPageState} className="font-semibold text-brand-700 hover:underline">
            Đăng ký
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {state.flash && !error && <Alert tone="success">{FLASH[state.flash]}</Alert>}
        {error && (
          <Alert>
            {error.message}
            {error.code === 'EMAIL_NOT_VERIFIED' && (
              <button type="button" onClick={verifyNow} className="ml-1 font-semibold underline">
                Gửi mã xác minh
              </button>
            )}
          </Alert>
        )}
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Mật khẩu"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Ghi nhớ đăng nhập (7 ngày)
          </label>
          <Link to="/forgot-password" state={{ email } satisfies AuthPageState} className="text-sm text-brand-700 hover:underline">
            Quên mật khẩu?
          </Link>
        </div>
        <Button type="submit" loading={busy} disabled={!email || !password} className="w-full">
          Đăng nhập
        </Button>
      </form>
    </FormPage>
  )
}
