import { Component, type ErrorInfo, type ReactNode } from 'react';

export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[App] Render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="min-h-screen flex items-center justify-center bg-cream-50 p-6">
      <section className="card w-full max-w-lg p-6" role="alert">
        <h1 className="font-display text-2xl font-bold text-ink-900">This page could not be displayed</h1>
        <p className="mt-3 text-sm leading-6 text-ink-600">Try reloading the page. Unsaved changes on this page may be lost. If you just submitted an action, check its status before submitting it again.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button className="btn-primary" onClick={() => window.location.reload()}>Reload page</button>
          <a className="btn-secondary" href="/">Go to home</a>
        </div>
      </section>
    </main>;
  }
}
