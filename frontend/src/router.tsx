import type { ReactNode } from 'react'
import { createBrowserRouter } from 'react-router'
import { AdminLayout } from './admin/AdminLayout'
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
import { AdminHomePage } from './pages/admin/AdminHomePage'
import { CategoriesPage } from './pages/admin/CategoriesPage'
import { EventReviewPage } from './pages/admin/EventReviewPage'
import { EventsReviewPage } from './pages/admin/EventsReviewPage'
import { OrganizersPage } from './pages/admin/OrganizersPage'
import { VenueDetailPage } from './pages/admin/VenueDetailPage'
import { VenuesPage } from './pages/admin/VenuesPage'

/** One route of the admin area, guarded by any of the given permissions. */
const guarded = (anyOf: string[], element: ReactNode) => <RequirePermission anyOf={anyOf}>{element}</RequirePermission>
const EVENT_REVIEW = ['event:approve', 'event:manage:any']

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
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
          { index: true, element: guarded(['event:approve', 'organizer:manage', 'venue:manage', 'category:manage'], <AdminHomePage />) },
          { path: 'events', element: guarded(EVENT_REVIEW, <EventsReviewPage />) },
          { path: 'events/:id', element: guarded(EVENT_REVIEW, <EventReviewPage />) },
          { path: 'organizers', element: guarded(['organizer:manage'], <OrganizersPage />) },
          { path: 'venues', element: guarded(['venue:manage'], <VenuesPage />) },
          { path: 'venues/:id', element: guarded(['venue:manage'], <VenueDetailPage />) },
          { path: 'categories', element: guarded(['category:manage'], <CategoriesPage />) },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
