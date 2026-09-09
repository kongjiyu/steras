import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import AppErrorBoundary from './components/ui/AppErrorBoundary';
import ConnectionStatus from './components/ui/ConnectionStatus';
import BackToTop from './components/ui/BackToTop';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <BackToTop />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: '#fffdf8',
              border: '1px solid #d8cebd',
              borderRadius: '10px',
              boxShadow: '0 16px 40px rgba(45, 54, 28, 0.16)',
              color: '#303528',
              fontSize: '14px',
              lineHeight: '1.45',
              maxWidth: 'min(420px, calc(100vw - 32px))',
              padding: '13px 16px',
            },
            success: { iconTheme: { primary: '#52651c', secondary: '#fffdf8' } },
            error: { iconTheme: { primary: '#b42318', secondary: '#fffdf8' } },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
    </AppErrorBoundary>
    <ConnectionStatus />
  </React.StrictMode>,
);
