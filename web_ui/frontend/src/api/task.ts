import { client } from './client';

export const taskApi = {
	update: (agentId: string, sessionId: string, taskId: string, state: string) =>
		client.patch<{ status: string }>(`/tasks/${taskId}`, { state }, {
			agent_id: agentId,
			session_id: sessionId,
		}),

	clear: (agentId: string, sessionId: string, mode: 'all' | 'completed' | 'stuck') =>
		client.post<{ status: string; affected: number }>('/tasks/clear', { mode }, {
			agent_id: agentId,
			session_id: sessionId,
		}),
};
