import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth/auth';
import './styles.css';

// Versão nova publicada com a aba aberta: as telas antigas saíram do ar. Recarrega uma vez só,
// para não entrar em laço se o problema for outro (ex.: sem internet).
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('palmer:reloaded-for-update')) return;
    sessionStorage.setItem('palmer:reloaded-for-update', '1');
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});
window.addEventListener('load', () => {
  // Carregou bem: libera nova recarga para a próxima publicação.
  setTimeout(() => {
    try {
      sessionStorage.removeItem('palmer:reloaded-for-update');
    } catch {
      // Sem storage, só perde a proteção contra laço.
    }
  }, 10_000);
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
