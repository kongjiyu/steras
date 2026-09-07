import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppErrorBoundary from './AppErrorBoundary';
import ConnectionStatus from './ConnectionStatus';

it('contains render failures and provides recovery without exposing the exception', () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  function Broken(): never { throw new Error('private-backend-details'); }
  render(<AppErrorBoundary><Broken /></AppErrorBoundary>);
  expect(screen.getByRole('alert')).toHaveTextContent('This page could not be displayed');
  expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument();
  expect(screen.queryByText('private-backend-details')).not.toBeInTheDocument();
  log.mockRestore();
});

describe('connection status', () => {
  it('announces offline state and clears it after reconnection', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get');
    online.mockReturnValue(true);
    render(<ConnectionStatus />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    online.mockReturnValue(false);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByRole('alert')).toHaveTextContent('You are offline');
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    online.mockRestore();
  });
});
