import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'telamon/tokens.css';
import 'telamon/styles.css';
import './playground.css';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
