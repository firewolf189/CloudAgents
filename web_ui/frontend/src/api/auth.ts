import { client } from './client';

export interface LoginResponse {
	token: string;
	role: string;
	user_id: string;
	name: string;
}

export interface MeResponse {
	user_id: string;
	role: string;
	name: string;
	has_credentials: boolean;
}

export const authApi = {
	loginAdmin: (username: string, password: string) =>
		client.post<LoginResponse>('/auth/login', { username, password }),

	loginToken: (token: string) =>
		client.post<LoginResponse>('/auth/login/token', { token }),

	setCredentials: (username: string, password: string) =>
		client.post<{ ok: boolean }>('/auth/set-credentials', { username, password }),

	me: () => client.get<MeResponse>('/auth/me'),
};
