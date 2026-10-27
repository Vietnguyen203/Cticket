import { useState } from 'react'
import { TicketIcon } from './icons'

/**
 * An event picture. Images are links typed by organizers: when there is none,
 * or it does not load (a web page instead of a picture, a dead link), show a
 * calm decorative panel instead of a broken image. No title on it: every place
 * that shows a picture shows the event's title right beside it (it read twice).
 */
export function EventImage({ src, className = '' }: { src: string | null; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (src && failedSrc !== src) {
    return <img src={src} alt="" loading="lazy" onError={() => setFailedSrc(src)} className={`h-full w-full object-cover ${className}`} />
  }
  // One calm style for every event without a picture (ink panel, brand line), not a random colour.
  return (
    <div aria-hidden="true" className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-night ${className}`}>
      <span className="absolute -right-10 -top-10 h-40 w-40 rounded-full border-[18px] border-brand-500/25" />
      <span className="absolute -bottom-12 -left-8 h-32 w-32 rounded-full border-[14px] border-brand-500/15" />
      <span className="absolute inset-x-0 top-0 h-1 bg-brand-500" />
      <TicketIcon size={44} className="relative text-brand-400/70" />
    </div>
  )
}

/** In forms: shows whether the link really is a picture. */
export function ImagePreview({ src }: { src: string }) {
  const [state, setState] = useState<{ src: string; ok: boolean } | null>(null)
  if (!/^(https?:\/\/\S+|\/api\/v1\/uploads\/\S+)$/.test(src)) return null
  const known = state?.src === src ? state.ok : undefined
  return (
    <div className="mt-2 flex items-center gap-3 text-xs">
      <img
        src={src}
        alt=""
        onLoad={() => setState({ src, ok: true })}
        onError={() => setState({ src, ok: false })}
        className={`h-14 w-24 rounded object-cover ring-1 ring-slate-200 ${known === false ? 'hidden' : ''}`}
      />
      {known === false && <span className="text-red-600">Không tải được ảnh từ đường dẫn này. Hãy dùng link trực tiếp tới file ảnh (.jpg, .png, .webp).</span>}
      {known === true && <span className="text-emerald-700">Ảnh hợp lệ.</span>}
    </div>
  )
}
