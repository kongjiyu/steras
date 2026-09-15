import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminAnalytics from './AdminAnalytics';

vi.mock('../authority/Analytics', () => ({
  default: ({ embedded }: { embedded?: boolean }) => <div>{embedded ? 'Embedded analytics' : 'Standalone analytics'}</div>,
}));

describe('AdminAnalytics', () => {
  it('embeds M5 inside the existing protected Admin shell', () => {
    render(<AdminAnalytics />);
    expect(screen.getByText('Embedded analytics')).toBeInTheDocument();
    expect(screen.queryByText('Standalone analytics')).not.toBeInTheDocument();
  });
});
