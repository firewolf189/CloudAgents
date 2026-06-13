import { client } from './client';

export interface UserRecord {
	user_id: string;
	name: string;
	token: string;
	created_at: string;
}

export interface UserListItem {
	user_id: string;
	name: string;
	created_at: string;
}

export interface AgentAssignment {
	agent_id: string;
	assigned_to: string | null;
}

export const userApi = {
	list: () => client.get<UserListItem[]>('/users/'),

	get: (userId: string) => client.get<UserRecord>(`/users/${userId}`),

	create: (name: string) =>
		client.post<UserRecord>('/users/', { name }),

	remove: (userId: string) => client.delete(`/users/${userId}`),

	regenerateToken: (userId: string) =>
		client.post<UserRecord>(`/users/${userId}/regenerate-token`),

	listAssignments: () =>
		client.get<AgentAssignment[]>('/agent/assignments'),

	assignAgent: (agentId: string, assignedTo: string) =>
		client.patch<{ status: string }>(`/agent/${agentId}/assign`, { assigned_to: assignedTo }),

	unassignAgent: (agentId: string) =>
		client.delete(`/agent/${agentId}/assign`),
};
