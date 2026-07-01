import { Onborda, OnbordaProvider } from 'onborda';
import { useMemo, useState } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';

import { AppLayout } from '@/components/layout/AppLayout';
import { buildChatTour, buildEmployeeTour } from '@/components/tour/chatTourSteps';
import { TourCard } from '@/components/tour/TourCard';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/i18n/useI18n';
import { ChatPage } from '@/pages/chat';
import { CredentialPage } from '@/pages/credential';
import { SchedulePage } from '@/pages/schedule';
import { SetupPage } from '@/pages/setup';
import { UserPage } from '@/pages/user';
import WikiPage from '@/pages/wiki';

function SetupPageRoute() {
	const navigate = useNavigate();
	return (
		<>
			<div className="h-screen">
				<SetupPage onComplete={() => navigate('/')} />
			</div>
			<Toaster richColors position="top-right" />
		</>
	);
}

const router = createBrowserRouter([
	{
		element: <AppLayout />,
		children: [
			{ path: '/', element: <Navigate to="/chat" replace /> },
			{
				path: '/chat/:agentId?/:sessionId?/:memberId?',
				element: <ChatPage />,
			},
			{ path: '/schedule', element: <SchedulePage /> },
			{ path: '/wiki', element: <WikiPage /> },
			{ path: '/credential', element: <CredentialPage /> },
			{ path: '/users', element: <UserPage /> },
		],
	},
	{ path: '/setup', element: <SetupPageRoute /> },
]);

function AppInner() {
	const { t } = useTranslation();
	const { user, loading, isAdmin } = useAuth();
	const [setupComplete, setSetupComplete] = useState(
		() => !!localStorage.getItem('server_url') && !!localStorage.getItem('auth_token'),
	);

	const tours = useMemo(
		() => isAdmin ? [buildChatTour(t)] : [buildEmployeeTour(t)],
		[t, isAdmin],
	);

	if (loading) {
		return null;
	}

	if (!setupComplete || !user) {
		return <SetupPage onComplete={() => setSetupComplete(true)} />;
	}

	return (
		<OnbordaProvider>
			<Onborda
				steps={tours}
				cardComponent={TourCard}
				shadowOpacity="0.6"
				cardTransition={{ type: 'spring', duration: 0.4 }}
			>
				<RouterProvider router={router} />
				<Toaster richColors position="top-right" />
			</Onborda>
		</OnbordaProvider>
	);
}

function App() {
	return (
		<AuthProvider>
			<AppInner />
		</AuthProvider>
	);
}

export default App;
