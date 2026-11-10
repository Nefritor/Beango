import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/golos-text';
import '@fontsource-variable/unbounded';
import { App } from './App.js';
import { gameClient } from './store.js';
import './styles.css';

history.scrollRestoration = 'manual';
gameClient.initialize();
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
