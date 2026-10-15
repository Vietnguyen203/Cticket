import { api } from './client'
import type { Order, PageMeta } from './types'

export interface NewOrder {
  /** Physical seat ids (seat map `seatId`) */
  seatIds?: string[]
  /** Standing / general-admission tickets */
  items?: Array<{ ticketTypeId: string; quantity: number }>
}

/** Holds the seats / tickets for 10 minutes. Prices are computed by the API, never sent. */
export async function createOrder(scheduleId: string, order: NewOrder): Promise<Order> {
  return (await api.post(`/schedules/${scheduleId}/orders`, order)).data.data.order
}

/**
 * BKG-02: replace what my HELD order holds with this WHOLE content (same shape
 * as when booking). Sending it twice changes nothing; the hold's time does not move.
 */
export async function updateOrderItems(orderId: string, content: NewOrder): Promise<Order> {
  return (await api.put(`/orders/${orderId}/items`, content)).data.data.order
}

/** BKG-02: take one seat out of my HELD order (it goes back on sale at once). */
export async function removeOrderSeat(orderId: string, seatId: string): Promise<Order> {
  return (await api.delete(`/orders/${orderId}/seats/${seatId}`)).data.data.order
}

export async function getOrder(orderId: string): Promise<Order> {
  return (await api.get(`/orders/${orderId}`)).data.data.order
}

export async function cancelOrder(orderId: string): Promise<Order> {
  return (await api.post(`/orders/${orderId}/cancel`)).data.data.order
}

export async function listMyOrders(params: { status?: string; scheduleId?: string; page?: number; pageSize?: number }) {
  const res = await api.get('/orders', { params })
  return { orders: res.data.data.orders as Order[], meta: res.data.meta as PageMeta }
}

/** HELD → PAYMENT_PENDING: totals frozen (discount applied), time extended to pay. */
export async function checkoutOrder(orderId: string, promotionCode?: string): Promise<Order> {
  return (await api.post(`/orders/${orderId}/checkout`, promotionCode ? { promotionCode } : {})).data.data.order
}

export interface PromotionPreview {
  code: string
  name: string
  subtotal: number
  discountAmount: number
  totalAmount: number
}

/** What a code would do, without using it up (PRO-01). */
export async function previewPromotion(orderId: string, code: string): Promise<PromotionPreview> {
  return (await api.post('/promotions/validate', { orderId, code })).data.data.preview
}

export interface Payment {
  id: string
  orderId: string
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REFUNDED'
  amount: number
  failureCode: string | null
  failureMessage: string | null
}

/**
 * Pay (simulated provider). ONE Idempotency-Key per click of the Pay button:
 * if the network fails, the same request is sent again with the SAME key, and
 * the API answers with the first result instead of charging twice.
 */
export async function payOrder(orderId: string, idempotencyKey: string, simulate: 'SUCCESS' | 'FAILED' = 'SUCCESS'): Promise<Payment> {
  const send = () => api.post('/payments', { orderId, simulate }, { headers: { 'Idempotency-Key': idempotencyKey } })
  try {
    return (await send()).data.data.payment
  } catch (err) {
    if ((err as { code?: string }).code !== 'NETWORK_ERROR') throw err
    return (await send()).data.data.payment // the answer to the first try may have been lost
  }
}

// --- Phase 17: VNPay -----------------------------------------------------------

/** What this server offers: 'VNPAY' when configured, 'SIMULATOR' when on (off in production). */
export async function getPaymentMethods(): Promise<string[]> {
  return (await api.get('/payments/methods')).data.data.methods
}

/** A new VNPay attempt: the browser then goes to paymentUrl (VNPay's page). */
export async function startVnpayPayment(orderId: string): Promise<{ paymentId: string; paymentUrl: string }> {
  return (await api.post('/payments/vnpay', { orderId })).data.data
}

export interface VnpayResult {
  paymentId: string
  orderId: string
  /** What the API knows after asking VNPay: PENDING = VNPay has not confirmed yet */
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'REFUNDED'
  responseCode: string | null
}

/**
 * Back from VNPay: forward VNPay's query string as it came. The API checks
 * its signature and asks VNPay what happened (the URL alone proves nothing).
 */
export async function confirmVnpayReturn(search: string): Promise<VnpayResult> {
  const params = Object.fromEntries(new URLSearchParams(search))
  return (await api.get('/payments/vnpay/return', { params })).data.data.payment
}
