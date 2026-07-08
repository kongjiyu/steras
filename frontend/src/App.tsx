import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import AppLayout from './components/layout/AppLayout';
import ProtectedRoute from './components/layout/ProtectedRoute';
import LoadingScreen from './components/ui/LoadingScreen';

// Public pages
import PublicHome from './pages/public/PublicHome';
import PublicCalendar from './pages/public/PublicCalendar';
import PublicEventDetail from './pages/public/PublicEventDetail';

// Auth pages
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';

// Organizer pages
import OrganizerDashboard from './pages/organizer/OrganizerDashboard';
import NewEvent from './pages/organizer/NewEvent';
import MyEvents from './pages/organizer/MyEvents';
import EventDetail from './pages/organizer/EventDetail';

// Authority pages
import AuthorityDashboard from './pages/authority/AuthorityDashboard';
import ReviewQueue from './pages/authority/ReviewQueue';
import AuthorityEventReview from './pages/authority/AuthorityEventReview';
import Analytics from './pages/authority/Analytics';

export default function App() {
  const { loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return (
    <Routes>
      {/* Public routes (no auth required) */}
      <Route path="/" element={<PublicHome />} />
      <Route path="/calendar" element={<PublicCalendar />} />
      <Route path="/events/:eventId" element={<PublicEventDetail />} />

      {/* Auth routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      {/* Organizer routes (auth + role=organizer) */}
      <Route
        element={
          <ProtectedRoute requiredRole="organizer">
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/organizer" element={<OrganizerDashboard />} />
        <Route path="/organizer/events/new" element={<NewEvent />} />
        <Route path="/organizer/events" element={<MyEvents />} />
        <Route path="/organizer/events/:eventId" element={<EventDetail />} />
      </Route>

      {/* Authority routes (auth + role=authority) */}
      <Route
        element={
          <ProtectedRoute requiredRole="authority">
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/authority" element={<AuthorityDashboard />} />
        <Route path="/authority/queue" element={<ReviewQueue />} />
        <Route path="/authority/events/:eventId" element={<AuthorityEventReview />} />
        <Route path="/authority/analytics" element={<Analytics />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
