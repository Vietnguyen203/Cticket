import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router'
import { confirmLoginSetup, requestOtp, startLoginSetup, verifyLoginCode } from '../../api/auth'
import { ApiError, toApiError } from '../../api/errors'
import type { LoginResult, TwoFactorSetup } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { authState, type AuthPageState } from '../../auth/navigation'
import { rememberPendingLogin } from '../../auth/pendingLogin'
import { safeNext } from '../../auth/safeNext'
import { CodeField, RecoveryCodesPanel, SetupInstructions } from '../../auth/TwoFactorParts'
import { Alert, Button, FormPage, PasswordField, TextField } from '../../components/ui'

const FLASH = {
  verified: 'Email đã được xác minh. Mời bạn đăng nhập.',
  reset: 'Đã đổi mật khẩu. Mời bạn đăng nhập bằng mật khẩu mới.',
}

/**
 * Phase 15: after the password, maybe a second step.
 * - code: two-factor is on, enter a code from the app (or a recovery code);
 * - setup: an admin without two-factor sets it up now (scan, first code);
 * - codes: the recovery codes of a new set-up, shown once before going in.
 * The mfaToken lives only in this page's state.
 */
type Step =
  | { kind: 'password' }
  | { kind: 'code'; mfaToken: string; recovery: boolean }
  | { kind: 'setup'; mfaToken: string; setup: TwoFactorSetup | null }
  | { kind: 'codes'; result: LoginResult; codes: string[] }

const TITLES: Record<Step['kind'], string> = {
  password: 'Đăng nhập',
  code: 'Xác thực hai lớp',
  setup: 'Thiết lập xác thực hai lớp',
  codes: 'Lưu mã khôi phục',
}

export function LoginPage() {
  const { status, login, completeLogin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const state = authState(location.state)
  const next = safeNext(params.get('next') ?? state.next ?? null)
  const [email, setEmail] = useState(state.email ?? '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [step, setStep] = useState<Step>({ kind: 'password' })
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)

  if (status === 'authenticated' && step.kind !== 'codes') return <Navigate to={next} replace />

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      const apiError = toApiError(err)
      // The sign-in step expired or ran out of tries: start again from the password.
      if (apiError.code === 'MFA_TOKEN_INVALID') setStep({ kind: 'password' })
      setError(apiError)
    } finally {
      setBusy(false)
    }
  }

  async function signIn(result: LoginResult) {
    await completeLogin(result)
    navigate(next, { replace: true })
  }

  const onPassword = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const challenge = await login(email, password, remember)
      if (!challenge) {
        navigate(next, { replace: true })
        return
      }
      setCode('')
      if (challenge.mfaRequired) {
        setStep({ kind: 'code', mfaToken: challenge.mfaToken, recovery: false })
        return
      }
      setStep({ kind: 'setup', mfaToken: challenge.mfaToken, setup: null })
      setStep({ kind: 'setup', mfaToken: challenge.mfaToken, setup: await startLoginSetup(challenge.mfaToken) })
    })
  }

  const submitCode = (value = code) => {
    if (step.kind !== 'code' || busy) return
    void run(async () => {
      const answer = step.recovery ? { recoveryCode } : { code: value }
      try {
        await signIn(await verifyLoginCode(step.mfaToken, answer))
      } finally {
        setCode('')
      }
    })
  }

  const confirmSetup = (value = code) => {
    if (step.kind !== 'setup' || busy) return
    void run(async () => {
      try {
        const result = await confirmLoginSetup(step.mfaToken, value)
        setStep({ kind: 'codes', result, codes: result.recoveryCodes })
      } finally {
        setCode('')
      }
    })
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

  const attemptsLeft = (error?.details as { attemptsLeft?: number } | undefined)?.attemptsLeft
  // Phase 18.1: how long the email stays locked.
  const lockedSeconds = (error?.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds
  const errorAlert = error && (
    <Alert>
      {error.message}
      {attemptsLeft !== undefined && ` Còn ${attemptsLeft} lần thử.`}
      {error.code === 'LOGIN_LOCKED' && (
        <>
          {' '}
          Thử lại sau {Math.max(1, Math.ceil((lockedSeconds ?? 60) / 60))} phút, hoặc{' '}
          <Link to="/forgot-password" className="font-semibold underline">
            đặt lại mật khẩu
          </Link>{' '}
          để vào ngay.
        </>
      )}
      {error.code === 'EMAIL_NOT_VERIFIED' && (
        <button type="button" onClick={verifyNow} className="ml-1 font-semibold underline">
          Gửi mã xác minh
        </button>
      )}
    </Alert>
  )
  const backToPassword = (
    <button type="button" onClick={() => setStep({ kind: 'password' })} className="text-sm text-brand-700 hover:underline">
      ← Đăng nhập bằng tài khoản khác
    </button>
  )

  if (step.kind === 'code') {
    return (
      <FormPage title={TITLES.code} subtitle={email}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submitCode()
          }}
          className="space-y-4"
          noValidate
        >
          {errorAlert}
          {step.recovery ? (
            <TextField
              label="Mã khôi phục"
              name="recoveryCode"
              autoComplete="off"
              autoFocus
              hint="Một trong 10 mã bạn đã lưu khi bật xác thực hai lớp (dạng ABCDE-FGH23). Mỗi mã dùng một lần."
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
            />
          ) : (
            <>
              <p className="text-sm text-slate-600">Mở ứng dụng xác thực trên điện thoại và nhập mã 6 số đang hiện.</p>
              <CodeField value={code} onChange={setCode} onComplete={submitCode} autoFocus disabled={busy} />
            </>
          )}
          <Button type="submit" loading={busy} disabled={step.recovery ? recoveryCode.trim().length < 8 : code.length !== 6} className="w-full">
            Xác nhận
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {backToPassword}
            <button
              type="button"
              onClick={() => {
                setError(null)
                setStep({ ...step, recovery: !step.recovery })
              }}
              className="text-sm font-semibold text-brand-700 hover:underline"
            >
              {step.recovery ? 'Dùng mã từ ứng dụng' : 'Không có điện thoại? Dùng mã khôi phục'}
            </button>
          </div>
        </form>
      </FormPage>
    )
  }

  if (step.kind === 'setup') {
    return (
      <FormPage title={TITLES.setup} subtitle="Tài khoản quản trị bắt buộc dùng xác thực hai lớp. Thiết lập một lần, khoảng 1 phút.">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            confirmSetup()
          }}
          className="space-y-4"
          noValidate
        >
          {errorAlert}
          {step.setup ? <SetupInstructions setup={step.setup} /> : <p className="text-sm text-slate-500">Đang tạo mã QR…</p>}
          <CodeField value={code} onChange={setCode} onComplete={confirmSetup} disabled={busy || !step.setup} />
          <Button type="submit" loading={busy} disabled={code.length !== 6 || !step.setup} className="w-full">
            Bật xác thực hai lớp
          </Button>
          {backToPassword}
        </form>
      </FormPage>
    )
  }

  if (step.kind === 'codes') {
    return (
      <FormPage title={TITLES.codes} subtitle="Xác thực hai lớp đã bật.">
        <RecoveryCodesPanel codes={step.codes} account={email} doneLabel="Tiếp tục" onDone={() => void run(() => signIn(step.result))} />
      </FormPage>
    )
  }

  return (
    <FormPage
      title={TITLES.password}
      subtitle={
        <>
          Chưa có tài khoản?{' '}
          <Link to="/register" state={{ next } satisfies AuthPageState} className="font-semibold text-brand-700 hover:underline">
            Đăng ký
          </Link>
        </>
      }
    >
      <form onSubmit={onPassword} className="space-y-4" noValidate>
        {state.flash && !error && <Alert tone="success">{FLASH[state.flash]}</Alert>}
        {errorAlert}
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label="Mật khẩu"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Ghi nhớ đăng nhập
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
