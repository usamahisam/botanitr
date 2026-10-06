import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

class ErrorGuard extends React.Component<{ children: React.ReactNode }, { error: string }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: '' };
  }
  static getDerivedStateFromError(e: any) {
    return { error: String(e?.message || e) };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontSize: 14, color: '#f0b90b', fontFamily: 'sans-serif' }}>
          <div style={{ fontWeight: 'bold', marginBottom: 8 }}>Halaman gagal dimuat:</div>
          <div style={{ wordBreak: 'break-word' }}>{this.state.error}</div>
          <div style={{ marginTop: 12, color: '#8b98a9' }}>Coba muat ulang (Tarik-refresh). Bila tetap, kirim teks ini ke admin.</div>
          <button
            style={{ marginTop: 12, padding: '8px 16px', borderRadius: 6, border: '1px solid #4f7cff', background: 'transparent', color: '#fff' }}
            onClick={() => { caches?.keys?.().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {}); location.reload(); }}
          >
            Bersihkan cache &amp; muat ulang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorGuard>
        <App />
      </ErrorGuard>
    </BrowserRouter>
  </React.StrictMode>
);

// Daftarkan service worker (produksi saja) agar bisa di-install di Android
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
