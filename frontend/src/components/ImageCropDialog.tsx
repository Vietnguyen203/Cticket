import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { FRAME_H, FRAME_W, MAX_ZOOM, centered, containZoom, hasGaps, moveBy, placement, zoomTo, type Fit, type Placement } from '../utils/imageCrop'
import { MapPinIcon } from './icons'
import { Alert, Button } from './ui'

export type Backdrop = 'blur' | 'light' | 'dark'

const BACKDROPS: Array<[Backdrop, string]> = [
  ['blur', 'Mờ từ ảnh'],
  ['light', 'Trắng'],
  ['dark', 'Tối'],
]
const DARK = '#0f0a1f' // --color-night
const JPEG_QUALITY = 0.88
const KEY_STEP = 20 // frame units per arrow key (×4 with Shift)

/**
 * The picture in the frame, drawn with CSS from the same placement the
 * canvas uses (percentages of the frame), so the preview is the result.
 */
function Framed({ src, at, backdrop, className = '' }: { src: string; at: Placement; backdrop: Backdrop; className?: string }) {
  const gaps = hasGaps(at)
  return (
    <div className={`relative aspect-video overflow-hidden ${backdrop === 'light' ? 'bg-white' : 'bg-night'} ${className}`}>
      {gaps && backdrop === 'blur' && (
        <img src={src} alt="" aria-hidden="true" draggable={false} className="absolute inset-0 h-full w-full scale-110 object-cover opacity-80 blur-2xl" />
      )}
      <img
        src={src}
        alt=""
        draggable={false}
        className="absolute max-w-none select-none"
        style={{
          left: `${(at.x / FRAME_W) * 100}%`,
          top: `${(at.y / FRAME_H) * 100}%`,
          width: `${(at.width / FRAME_W) * 100}%`,
          height: `${(at.height / FRAME_H) * 100}%`,
        }}
      />
    </div>
  )
}

/** Draw the result at FRAME_W × FRAME_H and give it back as a JPEG file. */
async function render(image: HTMLImageElement, at: Placement, backdrop: Backdrop): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = FRAME_W
  canvas.height = FRAME_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Trình duyệt không hỗ trợ vẽ ảnh (canvas).')
  ctx.fillStyle = backdrop === 'light' ? '#ffffff' : DARK
  ctx.fillRect(0, 0, FRAME_W, FRAME_H)
  if (hasGaps(at) && backdrop === 'blur' && 'filter' in ctx) {
    // The picture itself, covering the frame and blurred, behind the bands.
    const cover = placement(image.naturalWidth, image.naturalHeight, centered(image.naturalWidth, image.naturalHeight, 1.1))
    ctx.filter = 'blur(40px)'
    ctx.globalAlpha = 0.85
    ctx.drawImage(image, cover.x, cover.y, cover.width, cover.height)
    ctx.filter = 'none'
    ctx.globalAlpha = 1
  }
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, at.x, at.y, at.width, at.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new Error('Không tạo được ảnh. Hãy thử ảnh khác.')
  return new File([blob], 'anh-su-kien.jpg', { type: 'image/jpeg' })
}

/**
 * Before an event picture is uploaded: place it in the 16:9 frame it will be
 * shown in (drag, zoom, "fill the frame" / "show it all", background of the
 * empty bands), with a preview of the event card. `onConfirm` gets the
 * cropped JPEG; cancelling changes nothing.
 */
export function ImageCropDialog({
  src,
  title,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  src: string
  title?: string
  busy: boolean
  error: string | null
  onConfirm: (file: File) => void
  onCancel: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fit, setFit] = useState<Fit | null>(null)
  const [backdrop, setBackdrop] = useState<Backdrop>('blur')
  const [rendering, setRendering] = useState(false)

  useEffect(() => {
    dialog.current?.showModal()
  }, [])

  // Load the picture once (its natural size drives the geometry).
  useEffect(() => {
    let current = true
    const img = new Image()
    img.decoding = 'async'
    img.src = src
    img
      .decode()
      .then(() => {
        if (!current) return
        setImage(img)
        setFit(centered(img.naturalWidth, img.naturalHeight, 1))
      })
      .catch(() => current && setLoadError('Không mở được ảnh này. Hãy chọn ảnh JPEG, PNG hoặc WebP khác.'))
    return () => {
      current = false
    }
  }, [src])

  const w = image?.naturalWidth ?? 1
  const h = image?.naturalHeight ?? 1
  const at = image && fit ? placement(w, h, fit) : null
  const minZoom = image ? containZoom(w, h) : 1
  const working = busy || rendering

  /** Screen pixels → frame units (the stage is shown smaller than 1600 × 900). */
  const toFrame = (px: number) => (px * FRAME_W) / (stage.current?.clientWidth || FRAME_W)

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!fit) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY }
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !fit) return
    const dx = toFrame(event.clientX - drag.current.x)
    const dy = toFrame(event.clientY - drag.current.y)
    drag.current = { x: event.clientX, y: event.clientY }
    setFit(moveBy(w, h, fit, dx, dy))
  }
  function onPointerUp() {
    drag.current = null
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!fit) return
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[event.key]) {
      event.preventDefault()
      setFit(moveBy(w, h, fit, ...moves[event.key]))
    } else if (event.key === '+' || event.key === '=') {
      setFit(zoomTo(w, h, fit, fit.zoom * 1.1))
    } else if (event.key === '-') {
      setFit(zoomTo(w, h, fit, fit.zoom / 1.1))
    }
  }

  async function confirm() {
    if (!image || !at) return
    setRendering(true)
    try {
      onConfirm(await render(image, at, backdrop))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Không tạo được ảnh.')
    } finally {
      setRendering(false)
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="can-chinh-anh"
      onCancel={(event) => {
        event.preventDefault() // Esc: close through onCancel (the parent unmounts us)
        if (!working) onCancel()
      }}
      className="m-auto w-[min(100%-2rem,56rem)] animate-scale-in rounded-panel border border-line bg-surface p-0 text-ink shadow-raised backdrop:bg-night/60 backdrop:backdrop-blur-sm"
    >
      <div className="max-h-[90dvh] overflow-y-auto p-5 sm:p-6">
        <h2 id="can-chinh-anh" className="text-xl font-bold">
          Căn chỉnh ảnh
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Ảnh sự kiện hiển thị theo khung ngang 16:9 (thẻ sự kiện, trang sự kiện). Kéo ảnh để chọn phần hiện ra, phóng to / thu nhỏ, hoặc chọn "Hiện trọn
          ảnh" để không bị cắt mất chữ.
        </p>

        {loadError && (
          <div className="mt-4">
            <Alert>{loadError}</Alert>
          </div>
        )}

        <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_15rem]">
          <div className="min-w-0 space-y-4">
            <div
              ref={stage}
              role="application"
              tabIndex={0}
              aria-label="Khung ảnh: kéo để di chuyển, phím mũi tên để dịch, + và − để phóng to, thu nhỏ"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={onKeyDown}
              className={`relative touch-none overflow-hidden rounded-card ring-1 ring-line ${at ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {at ? (
                <Framed src={src} at={at} backdrop={backdrop} />
              ) : (
                <div className="skeleton aspect-video animate-shimmer" />
              )}
              {/* Thirds: help to place faces and titles. */}
              {at && (
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                  {Array.from({ length: 9 }, (_, i) => (
                    <span key={i} className="border border-white/25" />
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <label htmlFor="zoom-anh" className="shrink-0 text-sm font-medium">
                Thu phóng
              </label>
              <input
                id="zoom-anh"
                type="range"
                min={minZoom}
                max={MAX_ZOOM}
                step={0.01}
                value={fit?.zoom ?? 1}
                disabled={!fit}
                onChange={(e) => fit && setFit(zoomTo(w, h, fit, Number(e.target.value)))}
                className="min-w-0 flex-1 accent-brand-700"
              />
              <span className="w-12 shrink-0 text-right text-sm tabular-nums text-slate-600">{Math.round((fit?.zoom ?? 1) * 100)}%</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={!fit} onClick={() => setFit(centered(w, h, 1))}>
                Lấp đầy khung
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={!fit} onClick={() => setFit(centered(w, h, minZoom))}>
                Hiện trọn ảnh
              </Button>
            </div>
            {at && hasGaps(at) && (
              <fieldset className="flex flex-wrap items-center gap-2">
                <legend className="mb-1.5 text-sm font-medium">Nền phần trống</legend>
                {BACKDROPS.map(([value, label]) => (
                  <label
                    key={value}
                    className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition ${backdrop === value ? 'border-night bg-night text-white' : 'border-line hover:border-slate-300'}`}
                  >
                    <input type="radio" name="nen-anh" value={value} checked={backdrop === value} onChange={() => setBackdrop(value)} className="sr-only" />
                    {label}
                  </label>
                ))}
              </fieldset>
            )}
          </div>

          <aside className="space-y-2">
            <p className="text-sm font-medium">Xem trước thẻ sự kiện</p>
            <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
              {at ? <Framed src={src} at={at} backdrop={backdrop} /> : <div className="skeleton aspect-video animate-shimmer" />}
              <div className="space-y-1 p-3">
                <p className="line-clamp-2 text-sm font-semibold">{title?.trim() || 'Tên sự kiện'}</p>
                <p className="flex items-center gap-1 text-xs text-slate-500">
                  <MapPinIcon size={13} /> Thành phố
                </p>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-slate-500">Ảnh được lưu ở cỡ 1600 × 900 (JPEG), hiển thị đúng như khung bên trái.</p>
          </aside>
        </div>

        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" disabled={working} onClick={onCancel}>
            Hủy
          </Button>
          <Button type="button" loading={working} disabled={!at} onClick={() => void confirm()}>
            Dùng ảnh này
          </Button>
        </div>
      </div>
    </dialog>
  )
}
