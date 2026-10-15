import { api } from './client'
import type { PageMeta } from './types'

/** Phase 19: event reviews. */
export interface Review {
  id: string
  eventId: string
  rating: number
  comment: string | null
  status: 'PUBLISHED' | 'HIDDEN'
  /** "Lan N." (never the email) */
  authorName: string | null
  /** Only people who went in can write one */
  attended: boolean
  createdAt: string
  updatedAt: string
  reply: { text: string; at: string } | null
  /** The author and admins only */
  hiddenReason?: string | null
  /** Admin list only */
  authorEmail?: string
  event?: { title: string; slug: string }
}

export interface ReviewSummary {
  average: number | null
  count: number
  /** stars → number of published reviews */
  distribution: Record<string, number>
}

export type ReviewSort = 'newest' | 'highest' | 'lowest'

export async function listEventReviews(idOrSlug: string, params: { sort?: ReviewSort; rating?: number; page?: number; pageSize?: number }) {
  const res = await api.get(`/events/${idOrSlug}/reviews`, { params })
  return {
    summary: res.data.data.summary as ReviewSummary,
    canReply: res.data.data.canReply as boolean,
    reviews: res.data.data.reviews as Review[],
    meta: res.data.meta as PageMeta,
  }
}

export interface MyReview {
  review: Review | null
  canReview: boolean
  /** NOT_ATTENDED, CLOSED, EVENT_CANCELLED, HIDDEN */
  reason: string | null
  editableUntil: string | null
}

export async function getMyReview(eventId: string): Promise<MyReview> {
  return (await api.get(`/events/${eventId}/reviews/mine`)).data.data
}

export async function saveMyReview(eventId: string, review: { rating: number; comment?: string | null }): Promise<Review> {
  return (await api.put(`/events/${eventId}/reviews/mine`, review)).data.data.review
}

export async function deleteMyReview(eventId: string): Promise<void> {
  await api.delete(`/events/${eventId}/reviews/mine`)
}

export async function replyToReview(reviewId: string, reply: string): Promise<Review> {
  return (await api.put(`/reviews/${reviewId}/reply`, { reply })).data.data.review
}

export async function deleteReply(reviewId: string): Promise<Review> {
  return (await api.delete(`/reviews/${reviewId}/reply`)).data.data.review
}

export async function listReviewsForAdmin(params: { eventId?: string; rating?: number; status?: string; q?: string; page?: number; pageSize?: number }) {
  const res = await api.get('/admin/reviews', { params })
  return { reviews: res.data.data.reviews as Review[], meta: res.data.meta as PageMeta }
}

export async function hideReview(id: string, reason: string): Promise<Review> {
  return (await api.post(`/admin/reviews/${id}/hide`, { reason })).data.data.review
}

export async function unhideReview(id: string): Promise<Review> {
  return (await api.post(`/admin/reviews/${id}/unhide`)).data.data.review
}
