import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import AppErrorBoundary from './components/ui/AppErrorBoundary';
import ConnectionStatus from './components/ui/ConnectionStatus';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: { fontSize: '14px' },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
    </AppErrorBoundary>
    <ConnectionStatus />
  </React.StrictMode>,
);
