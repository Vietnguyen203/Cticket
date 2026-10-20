import { useEffect, useRef, useState } from 'react'
import { toApiError } from '../api/errors'
import { IMAGE_TYPES, MAX_IMAGE_BYTES, uploadImage } from '../api/uploads'
import { ImagePreview } from './EventImage'
import { ImageCropDialog } from './ImageCropDialog'
import { Button } from './ui'

/**
 * A picture from the computer may be bigger than what the API takes: it is
 * cropped to 1600 × 900 and re-encoded as JPEG before upload (well under 5 MB).
 */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024
/** Pictures uploaded here (same site): they can be placed again in the frame. */
const OWN_UPLOAD = /^\/api\/v1\/uploads\/images\/[0-9a-f-]{36}\.(jpg|png|webp)$/

/**
 * An event image: paste a link to a picture, or upload one from the computer
 * (JPEG / PNG / WebP), placed first in the 16:9 frame events are shown in
 * (ImageCropDialog). Value: an https:// link or an /api/v1/uploads/… path.
 */
export function ImageField({
  label,
  name,
  value,
  onChange,
  disabled,
  error,
  previewTitle,
}: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  error?: string
  /** The event's title, for the card preview of the crop dialog. */
  previewTitle?: string
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // The picture being placed: a local file (object URL, freed on close) or an earlier upload.
  const [cropping, setCropping] = useState<{ src: string; local: boolean } | null>(null)

  useEffect(
    () => () => {
      if (cropping?.local) URL.revokeObjectURL(cropping.src)
    },
    [cropping],
  )

  function onFile(file: File | undefined) {
    if (fileInput.current) fileInput.current.value = '' // the same file can be picked again
    if (!file) return
    setUploadError(null)
    if (!IMAGE_TYPES.includes(file.type)) return setUploadError('Chỉ nhận ảnh JPEG, PNG hoặc WebP.')
    if (file.size > MAX_SOURCE_BYTES) return setUploadError('Ảnh tối đa 20 MB.')
    setCropping({ src: URL.createObjectURL(file), local: true })
  }

  async function upload(file: File) {
    if (file.size > MAX_IMAGE_BYTES) return setUploadError('Ảnh sau khi cắt vẫn lớn hơn 5 MB. Hãy chọn ảnh khác.')
    setUploading(true)
    setUploadError(null)
    try {
      onChange((await uploadImage(file)).url)
      setCropping(null)
    } catch (err) {
      setUploadError(toApiError(err).message)
    } finally {
      setUploading(false)
    }
  }

  const ownUpload = OWN_UPLOAD.test(value.trim())
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={name}
          name={name}
          type="text"
          inputMode="url"
          placeholder="https://… hoặc tải ảnh lên"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={`h-11 min-w-0 flex-1 basis-60 rounded-control border bg-white px-3.5 text-base text-ink outline-none transition focus:ring-4 disabled:bg-slate-100 sm:text-sm ${
            error ? 'border-red-400 focus:ring-red-100' : 'border-line hover:border-slate-300 focus:border-brand-600 focus:ring-brand-100'
          }`}
        />
        <Button type="button" variant="secondary" loading={uploading && !cropping} disabled={disabled} onClick={() => fileInput.current?.click()}>
          Tải ảnh từ máy
        </Button>
        {ownUpload && (
          <Button type="button" variant="ghost" disabled={disabled} onClick={() => setCropping({ src: value.trim(), local: false })}>
            Căn chỉnh lại
          </Button>
        )}
        <input ref={fileInput} type="file" accept={IMAGE_TYPES.join(',')} className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
      {(uploadError || error) && !cropping && <p className="mt-1.5 text-sm text-red-600">{uploadError ?? error}</p>}
      <ImagePreview src={value.trim()} />
      {cropping && (
        <ImageCropDialog
          src={cropping.src}
          title={previewTitle}
          busy={uploading}
          error={uploadError}
          onConfirm={(file) => void upload(file)}
          onCancel={() => {
            setCropping(null)
            setUploadError(null)
          }}
        />
      )}
    </div>
  )
}
