import { Navigate, useParams } from 'react-router-dom';

/** Compatibility target for the pre-unification documentation URLs. */
export default function AdminDocumentationRedirect() {
  const { eventId } = useParams<{ eventId: string }>();
  const legacyPath = window.location.pathname.endsWith('/stage2-review');
  return <Navigate to={`/admin/applications/${eventId ?? ''}/controls?tab=${legacyPath ? 'stage2' : 'stage1'}`} replace />;
}
