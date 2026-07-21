import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getRoleHome } from '../../routing';

export default function RoleAwareFallback() {
  const { user, profile } = useAuth();
  const home = user ? getRoleHome(profile?.role) : null;
  return <Navigate to={home ?? '/'} replace />;
}
