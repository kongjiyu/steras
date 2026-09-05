import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncidentEvidenceGallery } from './IncidentEvidenceGallery';

const mocks = vi.hoisted(() => ({ callable: vi.fn() }));

vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => mocks.callable) }));
vi.mock('../../config/firebase', () => ({ functions: {} }));

describe('IncidentEvidenceGallery', () => {
  beforeEach(() => {
    mocks.callable.mockReset();
    mocks.callable.mockResolvedValue({ data: { url: 'https://example.com/incident.jpg', expiresAt: Date.now() + 60_000 } });
  });

  it('loads and displays image evidence inline without requiring a click', async () => {
    render(<IncidentEvidenceGallery incidentId="incident-1" evidence={[{
      path: 'incident_evidence/user/incident.jpg',
      name: 'incident-observation.jpg',
      mimeType: 'image/jpeg',
      size: 2048,
      uploadedBy: 'user-1',
      uploadedAt: 1,
    }]} setError={vi.fn()} />);

    const image = await screen.findByRole('img', { name: 'incident-observation.jpg' });
    expect(image).toHaveAttribute('src', 'https://example.com/incident.jpg');
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(mocks.callable).toHaveBeenCalledWith({ incidentId: 'incident-1', path: 'incident_evidence/user/incident.jpg' });
  });
});
