import { useEffect, useRef, useState } from 'react'
import { createQrDetector } from './qrDetector'

type CameraState = 'starting' | 'running' | 'insecure' | 'denied' | 'unavailable'

const SCAN_EVERY_MS = 250

const MESSAGES: Record<Exclude<CameraState, 'starting' | 'running'>, string> = {
  insecure: 'Trình duyệt chỉ mở camera trên HTTPS hoặc localhost. Trên điện thoại, mở web bằng địa chỉ https:// (npm run dev:https).',
  denied: 'Bạn đã chặn quyền camera. Cho phép camera cho trang này trong cài đặt trình duyệt, rồi tải lại trang.',
  unavailable: 'Không mở được camera trên thiết bị này. Dùng ô dán mã bên dưới.',
}

/**
 * The back camera, read 4 times a second for a QR code. `paused` stops
 * reading (while a scan is being checked / its result is shown) without
 * closing the camera.
 */
export function QrScanner({ onCode, paused }: { onCode: (code: string) => void; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const onCodeRef = useRef(onCode)
  const pausedRef = useRef(paused)
  const [secure] = useState(() => window.isSecureContext && Boolean(navigator.mediaDevices))
  const [state, setState] = useState<CameraState>(secure ? 'starting' : 'insecure')

  useEffect(() => {
    onCodeRef.current = onCode
    pausedRef.current = paused
  })

  useEffect(() => {
    if (!secure) return undefined
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setInterval> | null = null
    let stopped = false

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (stopped || !video.current) return
        video.current.srcObject = stream
        await video.current.play()
        const detector = await createQrDetector()
        if (stopped) return
        setState('running')
        let busy = false
        timer = setInterval(async () => {
          const el = video.current
          if (busy || pausedRef.current || !el || el.readyState < 2) return
          busy = true
          try {
            const [found] = await detector.detect(el)
            if (found?.rawValue) onCodeRef.current(found.rawValue)
          } catch {
            // a frame that cannot be decoded: try the next one
          } finally {
            busy = false
          }
        }, SCAN_EVERY_MS)
      } catch (err) {
        if (!stopped) setState((err as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable')
      }
    })()

    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [secure])

  if (state !== 'starting' && state !== 'running') {
    return <div className="rounded-2xl bg-slate-900 p-6 text-center text-sm text-slate-100">{MESSAGES[state]}</div>
  }
  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video ref={video} muted playsInline className="aspect-square w-full object-cover" />
      {/* Aiming frame */}
      <div className="pointer-events-none absolute inset-[18%] rounded-xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
      {state === 'starting' && <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white">Đang mở camera…</p>}
      {paused && state === 'running' && <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white">Đang kiểm tra…</p>}
    </div>
  )
}
