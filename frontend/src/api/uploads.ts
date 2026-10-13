import { api } from './client'

/** Accepted by the API (checked again there from the file's bytes). */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/** Sends the file as-is (raw body); returns the address to store, e.g. in bannerUrl. */
export async function uploadImage(file: File): Promise<{ url: string; contentType: string; size: number }> {
  return (await api.post('/uploads/images', file, { headers: { 'Content-Type': file.type } })).data.data.image
}
