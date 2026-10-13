import { useState } from 'react'
import { placeholderOf } from '../utils/placeholder'

/**
 * An event picture. Images are links typed by organizers: when there is none,
 * or it does not load (a web page instead of a picture, a dead link), show a
 * coloured panel with the title instead of a broken image.
 */
export function EventImage({ src, title, className = '' }: { src: string | null; title: string; className?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (src && failedSrc !== src) {
    return <img src={src} alt="" loading="lazy" onError={() => setFailedSrc(src)} className={`h-full w-full object-cover ${className}`} />
  }
  return (
    <div className={`flex h-full w-full items-end bg-gradient-to-br p-4 ${placeholderOf(title)} ${className}`}>
      <span className="line-clamp-2 text-lg font-bold text-white/90">{title}</span>
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
