import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App.js';
import { LocaleProvider } from './i18n/locale.js';
import { previewGateways, previewSession } from './preview/preview-gateways.js';
import './design-system/tokens.css';
import './design-system/components.css';
import './styles.css';

/** Local Vite-only visual QA entry with fictional data. It is not part of the Firebase production build. */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocaleProvider><App {...previewGateways} session={previewSession} onSwitchProperty={() => undefined} /></LocaleProvider>
  </React.StrictMode>,
);
