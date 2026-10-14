import { useState } from 'react'
import type { TwoFactorSetup } from '../api/types'
import { Alert, Button, TextField } from '../components/ui'
import { CODE_LENGTH, downloadText, groupSecret, normalizeCode, recoveryCodesFile } from './twoFactor'

/** Phase 15: the pieces shared by the login page and the account page. */

/**
 * The 6-digit code: numeric keyboard on phones, one-time-code autofill, and
 * `onComplete` as soon as 6 digits are there (no need to press the button).
 */
export function CodeField({
  value,
  onChange,
  onComplete,
  label = 'Mã xác thực',
  autoFocus = false,
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  onComplete?: (code: string) => void
  label?: string
  autoFocus?: boolean
  disabled?: boolean
}) {
  return (
    <TextField
      label={label}
      name="code"
      inputMode="numeric"
      autoComplete="one-time-code"
      // Paste "123 456" works: spaces / dashes are dropped before the length counts.
      maxLength={CODE_LENGTH + 2}
      autoFocus={autoFocus}
      disabled={disabled}
      value={value}
      onChange={(e) => {
        const code = normalizeCode(e.target.value)
        onChange(code)
        if (code.length === CODE_LENGTH) onComplete?.(code)
      }}
      className="[&_input]:text-center [&_input]:font-mono [&_input]:text-xl [&_input]:tracking-[0.5em]"
    />
  )
}

/** Scan the QR code with an authenticator app, or type the key in. */
export function SetupInstructions({ setup }: { setup: TwoFactorSetup }) {
  return (
    <div className="space-y-3 text-sm text-slate-700">
      <ol className="list-decimal space-y-1 pl-5">
        <li>Cài một ứng dụng xác thực trên điện thoại: Google Authenticator, Microsoft Authenticator hoặc Authy.</li>
        <li>Trong ứng dụng, chọn thêm tài khoản rồi quét mã QR bên dưới.</li>
        <li>Nhập mã 6 số mà ứng dụng hiện ra.</li>
      </ol>
      <img src={setup.qrDataUrl} alt="Mã QR để quét bằng ứng dụng xác thực" className="mx-auto h-48 w-48 rounded-lg border border-slate-200" />
      <details className="rounded-lg bg-slate-50 px-3 py-2">
        <summary className="cursor-pointer font-medium">Không quét được? Nhập khóa bằng tay</summary>
        <p className="mt-2 text-xs text-slate-500">Chọn "nhập khóa thiết lập", loại "theo thời gian", rồi gõ:</p>
        <code aria-label="Khóa thiết lập" className="mt-1 block font-mono text-base font-semibold break-words">
          {groupSecret(setup.secret)}
        </code>
      </details>
    </div>
  )
}

/** The 10 recovery codes, shown once: copy or download them, tick "saved", then go on. */
export function RecoveryCodesPanel({ codes, account, doneLabel, onDone }: { codes: string[]; account: string; doneLabel: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle')

  async function copyCodes() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopy('done')
    } catch {
      setCopy('failed') // no clipboard outside HTTPS / localhost
    }
  }

  return (
    <div className="space-y-4">
      <Alert tone="warning">
        Lưu 10 mã khôi phục này ở nơi an toàn. Mỗi mã dùng được <strong>một lần</strong> để đăng nhập khi bạn không có điện thoại. Các mã chỉ hiện ra lần
        này.
      </Alert>
      <ul aria-label="Mã khôi phục" className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-center font-mono text-sm font-semibold">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => void copyCodes()}>
          {copy === 'done' ? 'Đã sao chép' : 'Sao chép'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => downloadText('etp-ma-khoi-phuc.txt', recoveryCodesFile(codes, account, new Date()))}
        >
          Tải về (.txt)
        </Button>
      </div>
      {copy === 'failed' && <p className="text-sm text-red-600">Trình duyệt không cho sao chép ở đây; hãy tải file về.</p>}
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        Tôi đã lưu các mã này ở nơi an toàn
      </label>
      <Button type="button" className="w-full" disabled={!saved} onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  )
}
