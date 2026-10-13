import { api } from './client'
import type { Order } from './types'

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

export async function getOrder(orderId: string): Promise<Order> {
  return (await api.get(`/orders/${orderId}`)).data.data.order
}

export async function cancelOrder(orderId: string): Promise<Order> {
  return (await api.post(`/orders/${orderId}/cancel`)).data.data.order
}
