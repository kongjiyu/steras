import { lazy, Suspense } from 'react';
const TermsPage = lazy(() => import('./pages/public/TermsPage'));
const ResetPasswordPage = lazy(() => import('./pages/auth/ResetPasswordPage'));
const ProfilePage = lazy(() => import('./pages/organizer/ProfilePage'));
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import AppLayout from './components/layout/AppLayout';
import AuthorityLayout from './components/layout/AuthorityLayout';
import ProtectedRoute from './components/layout/ProtectedRoute';
import LoadingScreen from './components/ui/LoadingScreen';
import RoleAwareFallback from './components/layout/RoleAwareFallback';
const DashboardPreview = lazy(() => import('./pages/DashboardPreview'));
import { getIncidentPath } from './routing';

// Public pages
import PublicHome from './pages/public/PublicHome';
const PublicCalendar = lazy(() => import('./pages/public/PublicCalendar'));
const PublicEventDetail = lazy(() => import('./pages/public/PublicEventDetail'));

// Auth pages
const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'));

// Organizer pages
const OrganizerDashboard = lazy(() => import('./pages/organizer/OrganizerDashboard'));
const NewEvent = lazy(() => import('./pages/organizer/NewEvent'));
const TemplateRecommendationPage = lazy(() => import('./pages/organizer/TemplateRecommendationPage'));
const MyEvents = lazy(() => import('./pages/organizer/MyEvents'));
const EventDetail = lazy(() => import('./pages/organizer/EventDetail'));

// Authority pages
const AuthorityDashboard = lazy(() => import('./pages/authority/AuthorityDashboard'));
const ReviewQueue = lazy(() => import('./pages/authority/ReviewQueue'));
const AuthorityEventReview = lazy(() => import('./pages/authority/AuthorityEventReview'));
const RiskAssessments = lazy(() => import('./pages/authority/RiskAssessments'));
const ResourceRecommendations = lazy(() => import('./pages/authority/ResourceRecommendations'));

// Admin pages
import AdminLayout from './components/layout/AdminLayout';
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminApplicationQueue = lazy(() => import('./pages/admin/AdminApplicationQueue'));
const AdminApplicationReview = lazy(() => import('./pages/admin/AdminApplicationReview'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminVenues = lazy(() => import('./pages/admin/AdminVenues'));
const AdminAnalytics = lazy(() => import('./pages/admin/AdminAnalytics'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit'));
const AdminAssignment = lazy(() => import('./pages/admin/AdminAssignment'));
const AdminControlListEditor = lazy(() => import('./pages/admin/AdminControlListEditor'));
const AdminStage2Review = lazy(() => import('./pages/admin/AdminStage2Review'));
const OrganizerEventControls = lazy(() => import('./pages/organizer/OrganizerEventControls'));
const Incidents = lazy(() => import('./pages/incidents/Incidents'));

function IncidentRouteEntry() {
  const { profile } = useAuth();
  if (profile?.role === 'public') return <Incidents />;
  return <Navigate to={getIncidentPath(profile?.role)} replace />;
}

export default function App() {
  const { loading } = useAuth();

  const { pathname } = useLocation();
  const publicRoute = ['/', '/login', '/register', '/terms', '/reset-password', '/calendar'].includes(pathname) || pathname.startsWith('/events/');
  if (loading && !publicRoute) return <LoadingScreen />;

  return (
    <Suspense fallback={<LoadingScreen />}><Routes>
      {/* Public routes (no auth required) */}
      <Route path="/" element={<PublicHome />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/calendar" element={<PublicCalendar />} />
      <Route path="/events/:eventId" element={<PublicEventDetail />} />

      {/* Auth routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/dashboard-preview" element={import.meta.env.DEV ? <DashboardPreview /> : <Navigate to="/" replace />} />
      <Route path="/incidents" element={<ProtectedRoute><IncidentRouteEntry /></ProtectedRoute>} />

      {/* Organizer routes (auth + role=organizer) */}
      <Route
        element={
          <ProtectedRoute requiredRole="organizer">
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/organizer/profile" element={<ProfilePage />} />
        <Route path="/organizer" element={<OrganizerDashboard />} />
        <Route path="/organizer/events/new" element={<TemplateRecommendationPage />} />
        <Route path="/organizer/events/new/details" element={<NewEvent />} />
        <Route path="/organizer/events/:eventId/edit" element={<NewEvent />} />
        <Route path="/organizer/events" element={<MyEvents />} />
        <Route path="/organizer/events/:eventId" element={<EventDetail />} />
        <Route path="/organizer/events/:eventId/controls" element={<OrganizerEventControls />} />
        <Route path="/organizer/incidents" element={<Incidents />} />
      </Route>

      {/* Authority routes (auth + role=authority) — sidebar layout */}
      <Route
        element={
          <ProtectedRoute requiredRole="authority">
            <AuthorityLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/authority" element={<AuthorityDashboard />} />
        <Route path="/authority/applications" element={<ReviewQueue />} />
        <Route path="/authority/risk" element={<RiskAssessments />} />
        <Route path="/authority/resources" element={<ResourceRecommendations />} />
        <Route path="/authority/incidents" element={<Incidents />} />
        {/* M5 is Admin-only. Keep the legacy authority URL inside its own workspace. */}
        <Route path="/authority/reports" element={<Navigate to="/authority" replace />} />
        <Route path="/authority/calendar" element={<Navigate to="/calendar" replace />} />
        <Route path="/authority/audit" element={<Navigate to="/authority/applications" replace />} />
        <Route path="/authority/users" element={<Navigate to="/authority" replace />} />
        <Route path="/authority/settings" element={<Navigate to="/authority" replace />} />
        <Route path="/authority/events/:eventId" element={<AuthorityEventReview />} />
      </Route>

      {/* Admin routes (auth + role=admin) */}
      <Route
        element={
          <ProtectedRoute requiredRole="admin">
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/applications" element={<AdminApplicationQueue />} />
        <Route path="/admin/applications/:eventId" element={<AdminApplicationReview />} />
        <Route path="/admin/applications/:eventId/assign" element={<AdminAssignment />} />
        <Route path="/admin/applications/:eventId/controls" element={<AdminControlListEditor />} />
        <Route path="/admin/applications/:eventId/stage2-review" element={<AdminStage2Review />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="/admin/venues" element={<AdminVenues />} />
        <Route path="/admin/analytics" element={<AdminAnalytics />} />
        <Route path="/admin/audit" element={<AdminAudit />} />
        <Route path="/admin/incidents" element={<Incidents />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<RoleAwareFallback />} />
    </Routes></Suspense>
  );
}
