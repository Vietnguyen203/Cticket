/** Phase 15: small pure helpers of the two-factor screens (unit-tested). */

export const CODE_LENGTH = 6

/** What the user typed or pasted ("123 456", "123-456") → digits only, at most 6. */
export function normalizeCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, CODE_LENGTH)
}

/** The setup key in groups of 4, easier to type into an app by hand. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim()
}

/** The .txt file of recovery codes: what they are for, then one code per line. */
export function recoveryCodesFile(codes: string[], account: string, createdAt: Date): string {
  return [
    'ETP Tickets - Mã khôi phục xác thực hai lớp',
    `Tài khoản: ${account}`,
    `Tạo lúc: ${createdAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`,
    '',
    'Mỗi mã dùng được MỘT lần, khi bạn không có điện thoại.',
    'Giữ file này ở nơi an toàn; tạo bộ mã mới thì các mã này hết hiệu lực.',
    '',
    ...codes,
    '',
  ].join('\r\n')
}

/** Save text as a file, built in the browser (no extra request). */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
