import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { authApi, type MeResponse } from '@/api';

interface AuthState {
	token: string | null;
	user: MeResponse | null;
	isAdmin: boolean;
	loading: boolean;
	login: (token: string, user: MeResponse) => void;
	logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
	const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'));
	const [user, setUser] = useState<MeResponse | null>(null);
	const [loading, setLoading] = useState(!!localStorage.getItem('auth_token'));

	const login = useCallback((jwt: string, me: MeResponse) => {
		localStorage.setItem('auth_token', jwt);
		setToken(jwt);
		setUser(me);
	}, []);

	const logout = useCallback(() => {
		localStorage.removeItem('auth_token');
		setToken(null);
		setUser(null);
	}, []);

	useEffect(() => {
		if (!token) {
			setLoading(false);
			return;
		}
		authApi
			.me()
			.then((me) => {
				setUser(me);
			})
			.catch(() => {
				logout();
			})
			.finally(() => setLoading(false));
	}, [token, logout]);

	return (
		<AuthContext value={{
			token,
			user,
			isAdmin: user?.role === 'admin',
			loading,
			login,
			logout,
		}}>
			{children}
		</AuthContext>
	);
}

export function useAuth(): AuthState {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
	return ctx;
}
