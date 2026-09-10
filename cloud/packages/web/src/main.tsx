import React from 'react';
import ReactDOM from 'react-dom/client';

import { AuthGate } from './auth/AuthGate.js';
import { createFirebaseClient } from './firebase-client.js';
import './styles.css';

const client = createFirebaseClient(import.meta.env);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthGate client={client} />
  </React.StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
