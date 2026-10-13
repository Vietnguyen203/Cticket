import { useRef, useState } from 'react'
import { toApiError } from '../api/errors'
import { IMAGE_TYPES, MAX_IMAGE_BYTES, uploadImage } from '../api/uploads'
import { ImagePreview } from './EventImage'
import { Button } from './ui'

/**
 * An event image: paste a link to a picture, or upload one from the computer
 * (JPEG / PNG / WebP, at most 5 MB). Value: an https:// link or an /api/v1/uploads/… path.
 */
export function ImageField({
  label,
  name,
  value,
  onChange,
  disabled,
  error,
}: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  error?: string
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    setUploadError(null)
    if (!IMAGE_TYPES.includes(file.type)) return setUploadError('Chỉ nhận ảnh JPEG, PNG hoặc WebP.')
    if (file.size > MAX_IMAGE_BYTES) return setUploadError('Ảnh tối đa 5 MB.')
    setUploading(true)
    try {
      onChange((await uploadImage(file)).url)
    } catch (err) {
      setUploadError(toApiError(err).message)
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = '' // the same file can be picked again
    }
  }

  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={name}
          name={name}
          type="text"
          inputMode="url"
          placeholder="https://… hoặc tải ảnh lên"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={`min-w-0 flex-1 rounded-lg border bg-white px-3 py-2.5 text-base outline-none focus:ring-2 disabled:bg-slate-100 sm:text-sm ${
            error ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:border-brand-600 focus:ring-brand-100'
          }`}
        />
        <Button type="button" variant="secondary" loading={uploading} disabled={disabled} onClick={() => fileInput.current?.click()}>
          Tải ảnh từ máy
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      {(uploadError || error) && <p className="mt-1 text-sm text-red-600">{uploadError ?? error}</p>}
      <ImagePreview src={value.trim()} />
    </div>
  )
}
