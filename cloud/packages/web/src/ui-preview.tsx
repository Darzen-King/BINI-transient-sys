import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App.js';
import './styles.css';

/** Local Vite-only visual QA entry. It is not part of the Firebase production build. */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
