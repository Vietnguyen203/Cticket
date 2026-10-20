import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { register } from '../../api/auth'
import { ApiError, toApiError } from '../../api/errors'
import { useAuth } from '../../auth/AuthContext'
import { authState, type AuthPageState } from '../../auth/navigation'
import { rememberPendingLogin } from '../../auth/pendingLogin'
import { safeNext } from '../../auth/safeNext'
import { Alert, Button, FormPage, PasswordField, TextField } from '../../components/ui'

// Same rules as the API (backend auth.schemas): checked here first, for quick feedback.
const PASSWORD_MIN = 8
const passwordProblem = (password: string) =>
  password.length < PASSWORD_MIN
    ? `Cần ít nhất ${PASSWORD_MIN} ký tự.`
    : !/\p{L}/u.test(password) || !/\d/.test(password)
      ? 'Cần có ít nhất một chữ cái và một chữ số.'
      : null

export function RegisterPage() {
  const { status } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const next = safeNext(authState(location.state).next ?? null)
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '', confirm: '' })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  if (status === 'authenticated') return <Navigate to={next} replace />

  const set = (field: keyof typeof form) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: e.target.value }))

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const problems: Record<string, string> = {}
    const passwordIssue = passwordProblem(form.password)
    if (passwordIssue) problems.password = passwordIssue
    if (form.confirm !== form.password) problems.confirm = 'Mật khẩu nhập lại không khớp.'
    setFieldErrors(problems)
    setError(null)
    if (Object.keys(problems).length > 0) return

    setBusy(true)
    try {
      const email = form.email.trim().toLowerCase()
      await register({
        email,
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      })
      rememberPendingLogin(email, form.password)
      navigate('/verify-email', { state: { email, next } satisfies AuthPageState })
    } catch (err) {
      const apiError = toApiError(err)
      setFieldErrors(apiError.fieldErrors())
      setError(apiError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormPage
      title="Tạo tài khoản"
      subtitle={
        <>
          Đã có tài khoản?{' '}
          <Link to="/login" state={{ next } satisfies AuthPageState} className="font-semibold text-brand-700 hover:underline">
            Đăng nhập
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert>{error.message}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <TextField label="Họ" name="lastName" autoComplete="family-name" required value={form.lastName} onChange={set('lastName')} error={fieldErrors.lastName} />
          <TextField label="Tên" name="firstName" autoComplete="given-name" required value={form.firstName} onChange={set('firstName')} error={fieldErrors.firstName} />
        </div>
        <TextField label="Email" name="email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} error={fieldErrors.email} />
        <TextField
          label="Số điện thoại (không bắt buộc)"
          name="phone"
          type="tel"
          autoComplete="tel"
          value={form.phone}
          onChange={set('phone')}
          error={fieldErrors.phone}
        />
        <PasswordField
          label="Mật khẩu"
          name="password"
          autoComplete="new-password"
          required
          value={form.password}
          onChange={set('password')}
          error={fieldErrors.password}
          hint="Ít nhất 8 ký tự, có cả chữ và số."
        />
        <PasswordField
          label="Nhập lại mật khẩu"
          name="confirm"
          autoComplete="new-password"
          required
          value={form.confirm}
          onChange={set('confirm')}
          error={fieldErrors.confirm}
        />
        <Button
          type="submit"
          loading={busy}
          disabled={!form.firstName || !form.lastName || !form.email || !form.password}
          className="w-full"
        >
          Đăng ký
        </Button>
        <p className="text-center text-xs text-slate-500">Chúng tôi sẽ gửi mã 6 số tới email để xác minh tài khoản.</p>
      </form>
    </FormPage>
  )
}
