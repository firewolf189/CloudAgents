import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Polyfill for HTTP (non-HTTPS) environments where crypto.randomUUID is unavailable
if (typeof crypto !== 'undefined' && !crypto.randomUUID) {
	crypto.randomUUID = () =>
		'10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
			(+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16),
		) as `${string}-${string}-${string}-${string}-${string}`;
}

// Auto-login from admin portal — must run before React to set localStorage
// before AuthProvider reads it
const _params = new URLSearchParams(window.location.search);
const _autoToken = _params.get('auto_token');
const _serverUrl = _params.get('server_url');
if (_autoToken && _serverUrl) {
	localStorage.setItem('server_url', _serverUrl);
	localStorage.setItem('auth_token', _autoToken);
	localStorage.setItem('username', 'admin');
	const url = new URL(window.location.href);
	url.searchParams.delete('auto_token');
	url.searchParams.delete('server_url');
	window.history.replaceState({}, '', url.pathname);
}

import './index.css';
import './i18n';
import App from './App.tsx';
import { TooltipProvider } from '@/components/ui/tooltip.tsx';

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<TooltipProvider>
			<App />
		</TooltipProvider>
	</StrictMode>,
);
