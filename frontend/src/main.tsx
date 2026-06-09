import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import DemoReforestLatam from './pages/DemoReforestLatam';
import './index.css';

// Routing simple sin react-router: /demo → DemoReforestLatam, resto → App
const isDemo = window.location.pathname.startsWith('/demo');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      {isDemo ? <DemoReforestLatam /> : <App />}
    </BrowserRouter>
  </StrictMode>
);
