import { useState, type FormEvent } from 'react'
import { ApiError, toApiError } from '../../api/errors'
import type { TwoFactorSetup } from '../../api/types'
import { confirmTwoFactorSetup, disableTwoFactor, getTwoFactorStatus, regenerateRecoveryCodes, startTwoFactorSetup } from '../../api/twoFactor'
import { setAccessToken } from '../../auth/session'
import { CodeField, RecoveryCodesPanel, SetupInstructions } from '../../auth/TwoFactorParts'
import { Alert, Button, Card, PasswordField } from '../../components/ui'
import { formatDateTime } from '../../utils/format'
import { useAsync } from '../../utils/useAsync'

type Mode =
  | { kind: 'idle' }
  | { kind: 'password' } // turning on: the password again
  | { kind: 'scan'; setup: TwoFactorSetup }
  | { kind: 'codes'; codes: string[] }
  | { kind: 'disable' }
  | { kind: 'regenerate' }

/** Phase 15, account page: turn two-factor on / off, new recovery codes. */
export function TwoFactorSection({ email }: { email: string }) {
  const status = useAsync(getTwoFactorStatus, 'two-factor-status')
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const s = status.data

  function open(next: Mode) {
    setMode(next)
    setPassword('')
    setCode('')
    setError(null)
    setDone(null)
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(toApiError(err))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const submit = (action: () => Promise<void>) => (event: FormEvent) => {
    event.preventDefault()
    void run(action)
  }

  const turnOn = (value = code) =>
    void run(async () => {
      if (mode.kind !== 'scan') return
      const result = await confirmTwoFactorSetup(value)
      // A new session replaces this one (other devices must sign in again).
      setAccessToken(result.accessToken)
      open({ kind: 'codes', codes: result.recoveryCodes })
    })

  const cancel = (
    <Button type="button" variant="ghost" onClick={() => open({ kind: 'idle' })}>
      Hủy
    </Button>
  )

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Xác thực hai lớp</h2>
        {s && (
          <p className="mt-1 text-sm text-slate-600">
            {s.enabled
              ? `Đang bật từ ${formatDateTime(s.enabledAt!)}. Còn ${s.recoveryCodesLeft} mã khôi phục.`
              : 'Chưa bật. Khi bật, đăng nhập cần thêm mã 6 số từ ứng dụng xác thực trên điện thoại: lộ mật khẩu cũng không vào được tài khoản.'}
            {s.required && ' Bắt buộc với quản trị viên.'}
          </p>
        )}
      </div>
      {status.error && <Alert>{status.error.message}</Alert>}
      {error && <Alert>{error.message}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}

      {mode.kind === 'idle' && s && (
        <div className="flex flex-wrap gap-2">
          {!s.enabled && <Button onClick={() => open({ kind: 'password' })}>Bật xác thực hai lớp</Button>}
          {s.enabled && (
            <Button variant="secondary" onClick={() => open({ kind: 'regenerate' })}>
              Tạo lại mã khôi phục
            </Button>
          )}
          {s.enabled && !s.required && (
            <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={() => open({ kind: 'disable' })}>
              Tắt
            </Button>
          )}
        </div>
      )}

      {mode.kind === 'password' && (
        <form onSubmit={submit(async () => open({ kind: 'scan', setup: await startTwoFactorSetup(password) }))} className="space-y-3">
          <PasswordField label="Mật khẩu hiện tại" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={!password}>
              Tiếp tục
            </Button>
            {cancel}
          </div>
        </form>
      )}

      {mode.kind === 'scan' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            turnOn()
          }}
          className="space-y-3"
        >
          <SetupInstructions setup={mode.setup} />
          <CodeField value={code} onChange={setCode} onComplete={(value) => !busy && turnOn(value)} disabled={busy} />
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              Bật xác thực hai lớp
            </Button>
            {cancel}
          </div>
        </form>
      )}

      {mode.kind === 'codes' && (
        <RecoveryCodesPanel
          codes={mode.codes}
          account={email}
          doneLabel="Xong"
          onDone={() => {
            open({ kind: 'idle' })
            setDone('Đã lưu. Lần đăng nhập tới sẽ hỏi mã từ ứng dụng.')
            status.reload()
          }}
        />
      )}

      {mode.kind === 'regenerate' && (
        <form
          onSubmit={submit(async () => open({ kind: 'codes', codes: await regenerateRecoveryCodes(code) }))}
          className="space-y-3"
        >
          <p className="text-sm text-slate-600">10 mã mới thay cho bộ cũ (các mã cũ hết hiệu lực). Nhập mã từ ứng dụng để xác nhận.</p>
          <CodeField value={code} onChange={setCode} autoFocus disabled={busy} />
          <div className="flex gap-2">
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              Tạo mã mới
            </Button>
            {cancel}
          </div>
        </form>
      )}

      {mode.kind === 'disable' && (
        <form
          onSubmit={submit(async () => {
            await disableTwoFactor(password, code)
            open({ kind: 'idle' })
            setDone('Đã tắt xác thực hai lớp.')
            status.reload()
          })}
          className="space-y-3"
        >
          <PasswordField label="Mật khẩu hiện tại" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          <CodeField value={code} onChange={setCode} disabled={busy} />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" loading={busy} disabled={!password || code.length !== 6}>
              Tắt xác thực hai lớp
            </Button>
            {cancel}
          </div>
        </form>
      )}
    </Card>
  )
}
