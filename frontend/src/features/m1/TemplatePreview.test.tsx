import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import TemplatePreview from './TemplatePreview';
import { M1_CORE_TEMPLATE, scenarioTemplateFor } from './templateRegistry';

vi.mock('react-pdf', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
    Document: ({ file, onLoadSuccess, children }: {
      file: string;
      onLoadSuccess: (value: { numPages: number }) => void;
      children: ReactNode;
    }) => {
      const onLoadRef = useRef(onLoadSuccess);
      onLoadRef.current = onLoadSuccess;
      useEffect(() => {
        onLoadRef.current({ numPages: file.includes('Cultural') ? 6 : file.includes('Entertainment') ? 9 : 7 });
      }, [file]);
      return <div data-testid="document" data-file={file}>{children}</div>;
    },
    Page: ({ pageNumber }: { pageNumber: number }) => <div data-testid="page">Page canvas {pageNumber}</div>,
  };
});

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
});

describe('TemplatePreview adversarial state changes', () => {
  it('resets an out-of-range page when the recommended scenario changes', async () => {
    const entertainment = scenarioTemplateFor('entertainment_performance', 'indoor');
    const cultural = scenarioTemplateFor('cultural_heritage_festival', 'indoor');
    const { rerender } = render(<TemplatePreview core={M1_CORE_TEMPLATE} scenario={entertainment} />);

    fireEvent.click(screen.getByRole('button', { name: /Scenario template/ }));
    await waitFor(() => expect(screen.getByText('1 / 9')).toBeInTheDocument());
    for (let page = 1; page < 9; page += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    }
    expect(screen.getByText('9 / 9')).toBeInTheDocument();

    rerender(<TemplatePreview core={M1_CORE_TEMPLATE} scenario={cultural} />);
    await waitFor(() => expect(screen.getByText('1 / 6')).toBeInTheDocument());
    expect(screen.getByTestId('page')).toHaveTextContent('Page canvas 1');
    expect(screen.getByTestId('document')).toHaveAttribute('data-file', expect.stringContaining('Cultural'));
  });
});
