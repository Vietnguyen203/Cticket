import type { ReactNode } from 'react'
import { createBrowserRouter } from 'react-router'
import { AdminLayout, OrganizerLayout } from './admin/AdminLayout'
import { ORGANIZER_PERMISSIONS } from './admin/permissions'
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
import { AdminHomePage } from './pages/admin/AdminHomePage'
import { CategoriesPage } from './pages/admin/CategoriesPage'
import { EventReviewPage } from './pages/admin/EventReviewPage'
import { EventsReviewPage } from './pages/admin/EventsReviewPage'
import { OrganizersPage } from './pages/admin/OrganizersPage'
import { VenueDetailPage } from './pages/admin/VenueDetailPage'
import { VenuesPage } from './pages/admin/VenuesPage'
import { ApplyOrganizerPage } from './pages/organizer/ApplyOrganizerPage'
import { EventEditorPage } from './pages/organizer/EventEditorPage'
import { MyEventsPage } from './pages/organizer/MyEventsPage'
import { NewEventPage } from './pages/organizer/NewEventPage'

/** One route of the admin area, guarded by any of the given permissions. */
const guarded = (anyOf: string[], element: ReactNode) => <RequirePermission anyOf={anyOf}>{element}</RequirePermission>
const EVENT_REVIEW = ['event:approve', 'event:manage:any']

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'events', element: <EventsPage /> },
      { path: 'events/:slug', element: <EventDetailPage /> },
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
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
