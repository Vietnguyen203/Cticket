import type { ReactNode } from 'react'
import { createBrowserRouter } from 'react-router'
import { AdminLayout, OrganizerLayout } from './admin/AdminLayout'
import { ADMIN_MENU, ORGANIZER_PERMISSIONS } from './admin/permissions'
import { RequirePermission } from './admin/RequirePermission'
import { RequireAuth } from './auth/RequireAuth'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { LoginPage } from './pages/auth/LoginPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { VerifyEmailPage } from './pages/auth/VerifyEmailPage'
import { ProfilePage } from './pages/customer/ProfilePage'
import { EventDetailPage } from './pages/customer/EventDetailPage'
import { EventsPage } from './pages/customer/EventsPage'
import { MyOrdersPage } from './pages/customer/MyOrdersPage'
import { MyTicketsPage } from './pages/customer/MyTicketsPage'
import { OrderPage } from './pages/customer/OrderPage'
import { SeatSelectPage } from './pages/customer/SeatSelectPage'
import { TicketPage } from './pages/customer/TicketPage'
import { VnpayReturnPage } from './pages/customer/VnpayReturnPage'
import { WaitlistPage } from './pages/customer/WaitlistPage'
import { AdminHomePage } from './pages/admin/AdminHomePage'
import { CategoriesPage } from './pages/admin/CategoriesPage'
import { EventReviewPage } from './pages/admin/EventReviewPage'
import { EventsReviewPage } from './pages/admin/EventsReviewPage'
import { OrganizersPage } from './pages/admin/OrganizersPage'
import { VenueDetailPage } from './pages/admin/VenueDetailPage'
import { VenuesPage } from './pages/admin/VenuesPage'
import { AuditLogPage } from './pages/admin/AuditLogPage'
import { ReviewsPage } from './pages/admin/ReviewsPage'
import { OrderDetailPage } from './pages/admin/OrderDetailPage'
import { OrdersPage } from './pages/admin/OrdersPage'
import { PromotionsPage } from './pages/admin/PromotionsPage'
import { EventReportPage } from './pages/admin/EventReportPage'
import { ReportsPage } from './pages/admin/ReportsPage'
import { UsersPage } from './pages/admin/UsersPage'
import { ApplyOrganizerPage } from './pages/organizer/ApplyOrganizerPage'
import { EventEditorPage } from './pages/organizer/EventEditorPage'
import { MyEventsPage } from './pages/organizer/MyEventsPage'
import { NewEventPage } from './pages/organizer/NewEventPage'
import { CheckInHistoryPage } from './pages/staff/CheckInHistoryPage'
import { ScanPage } from './pages/staff/ScanPage'
import { StaffEventsPage } from './pages/staff/StaffEventsPage'

/** One route of the admin area, guarded by any of the given permissions. */
const guarded = (anyOf: string[], element: ReactNode) => <RequirePermission anyOf={anyOf}>{element}</RequirePermission>
const EVENT_REVIEW = ['event:approve', 'event:manage:any']
const signedIn = (element: ReactNode) => <RequireAuth>{element}</RequireAuth>

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'events/:slug', element: <EventDetailPage /> },
      { path: 'events/:slug/schedules/:scheduleId', element: <SeatSelectPage /> },
      { path: 'orders', element: signedIn(<MyOrdersPage />) },
      { path: 'orders/:id', element: signedIn(<OrderPage />) },
      // Phase 17: VNPay's vnp_ReturnUrl (VNPAY_RETURN_URL on the API).
      { path: 'payments/vnpay/return', element: signedIn(<VnpayReturnPage />) },
      { path: 'tickets', element: signedIn(<MyTicketsPage />) },
      { path: 'waitlist', element: signedIn(<WaitlistPage />) }, // Phase 18.4
      { path: 'tickets/:id', element: signedIn(<TicketPage />) },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'verify-email', element: <VerifyEmailPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      {
        path: 'account',
        element: (
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        ),
      },
      {
        path: 'admin',
        element: (
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: guarded(ADMIN_MENU[0].anyOf, <AdminHomePage />) },
          { path: 'events', element: guarded(EVENT_REVIEW, <EventsReviewPage />) },
          { path: 'events/:id', element: guarded(EVENT_REVIEW, <EventReviewPage />) },
          { path: 'organizers', element: guarded(['organizer:manage'], <OrganizersPage />) },
          { path: 'venues', element: guarded(['venue:manage'], <VenuesPage />) },
          { path: 'venues/:id', element: guarded(['venue:manage'], <VenueDetailPage />) },
          { path: 'categories', element: guarded(['category:manage'], <CategoriesPage />) },
          { path: 'users', element: guarded(['user:manage'], <UsersPage />) },
          { path: 'orders', element: guarded(['order:manage'], <OrdersPage />) },
          { path: 'orders/:id', element: guarded(['order:manage'], <OrderDetailPage />) },
          { path: 'promotions', element: guarded(['promotion:manage'], <PromotionsPage />) },
          { path: 'audit', element: guarded(['audit:read'], <AuditLogPage />) },
          { path: 'reviews', element: guarded(['review:manage'], <ReviewsPage />) }, // Phase 19
          { path: 'reports', element: guarded(['report:read:any'], <ReportsPage />) },
          { path: 'reports/events/:id', element: guarded(['report:read:any'], <EventReportPage />) },
        ],
      },
      {
        path: 'organizer/apply',
        element: (
          <RequireAuth>
            <ApplyOrganizerPage />
          </RequireAuth>
        ),
      },
      {
        path: 'organizer',
        element: (
          <RequireAuth>
            <OrganizerLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: guarded(ORGANIZER_PERMISSIONS, <MyEventsPage />) },
          { path: 'events/new', element: guarded(['event:create'], <NewEventPage />) },
          { path: 'events/:id', element: guarded(ORGANIZER_PERMISSIONS, <EventEditorPage />) },
        ],
      },
      { path: 'staff', element: guarded(['checkin:read'], <StaffEventsPage />) },
      { path: 'staff/scan/:scheduleId', element: guarded(['checkin:create'], <ScanPage />) },
      { path: 'staff/history/:scheduleId', element: guarded(['checkin:read'], <CheckInHistoryPage />) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
