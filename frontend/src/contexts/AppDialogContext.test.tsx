import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { AppDialogProvider, useAppDialog } from './AppDialogContext';

function DialogHarness() {
  const dialog = useAppDialog();
  const [result, setResult] = useState('waiting');
  return <>
    <button type="button" onClick={async () => setResult(String(await dialog.confirm({ title: 'Cancel application?', description: 'This cannot be undone.', confirmLabel: 'Cancel application', cancelLabel: 'Keep application', tone: 'danger' })))}>Open confirmation</button>
    <button type="button" onClick={async () => setResult(String(await dialog.prompt({ title: 'Withdraw?', description: 'Give a reason.', inputLabel: 'Reason', minLength: 10, maxLength: 20, confirmLabel: 'Withdraw' })))}>Open prompt</button>
    <output>{result}</output>
  </>;
}

describe('AppDialogProvider', () => {
  it('uses an accessible modal and resolves the explicit confirmation', async () => {
    render(<AppDialogProvider><DialogHarness /></AppDialogProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }));
    expect(screen.getByRole('dialog', { name: 'Cancel application?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel application' }));
    expect(await screen.findByText('true')).toBeInTheDocument();
  });

  it('cancels without performing the confirmed action', async () => {
    render(<AppDialogProvider><DialogHarness /></AppDialogProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open confirmation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep application' }));
    expect(await screen.findByText('false')).toBeInTheDocument();
  });

  it('validates and returns text entered in a prompt modal', async () => {
    render(<AppDialogProvider><DialogHarness /></AppDialogProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open prompt' }));
    const submit = screen.getByRole('button', { name: 'Withdraw' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Reason' }), { target: { value: 'Valid reason' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(await screen.findByText('Valid reason')).toBeInTheDocument();
  });
});
