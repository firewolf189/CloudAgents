import { client, getBaseUrl, getUserId, getAuthToken } from './client';
import type { AddSkillRequest, FileEntry, MCPClient, MCPClientStatus, Skill, ToolsOverview } from './types';

interface InstallSkillRequest {
	source: string;
	skill?: string;
}

interface InstallSkillResponse {
	success: boolean;
	output: string;
	error: string | null;
}

export const workspaceApi = {
	tools: {
		list: (agentId: string, sessionId: string) =>
			client.get<ToolsOverview>('/workspace/tools', {
				agent_id: agentId,
				session_id: sessionId,
			}),
	},

	mcp: {
		list: (agentId: string, sessionId: string) =>
			client.get<MCPClientStatus[]>('/workspace/mcp', {
				agent_id: agentId,
				session_id: sessionId,
			}),

		add: (agentId: string, sessionId: string, mcp: MCPClient) =>
			client.post<void>('/workspace/mcp', mcp, { agent_id: agentId, session_id: sessionId }),

		remove: (mcpName: string, agentId: string, sessionId: string) =>
			client.delete(`/workspace/mcp/${mcpName}`, {
				agent_id: agentId,
				session_id: sessionId,
			}),
	},

	skill: {
		list: (agentId: string, sessionId: string) =>
			client.get<Skill[]>('/workspace/skill', { agent_id: agentId, session_id: sessionId }),

		add: (agentId: string, sessionId: string, body: AddSkillRequest) =>
			client.post<void>('/workspace/skill', body, {
				agent_id: agentId,
				session_id: sessionId,
			}),

		remove: (skillName: string, agentId: string, sessionId: string) =>
			client.delete(`/workspace/skill/${skillName}`, {
				agent_id: agentId,
				session_id: sessionId,
			}),

		install: (agentId: string, sessionId: string, body: InstallSkillRequest) =>
			client.post<InstallSkillResponse>('/workspace/skill/install', body, {
				agent_id: agentId,
				session_id: sessionId,
			}),

		upload: async (agentId: string, sessionId: string, file: File): Promise<{ status: string }> => {
			const url = new URL('/workspace/skill/upload', getBaseUrl());
			url.searchParams.set('agent_id', agentId);
			url.searchParams.set('session_id', sessionId);
			const form = new FormData();
			form.append('file', file);
			const headers: Record<string, string> = { 'X-User-ID': getUserId() };
			const token = getAuthToken();
			if (token) {
				headers['Authorization'] = `Bearer ${token}`;
			}
			const res = await fetch(url.toString(), {
				method: 'POST',
				headers,
				body: form,
			});
			if (!res.ok) {
				const text = await res.text();
				let detail = text;
				try { detail = (JSON.parse(text) as { detail?: string }).detail ?? text; } catch { /* */ }
				throw new Error(detail);
			}
			return res.json() as Promise<{ status: string }>;
		},
	},

	files: {
		list: (agentId: string, sessionId: string, path?: string) =>
			client.get<FileEntry[]>('/workspace/files', {
				agent_id: agentId,
				session_id: sessionId,
				...(path ? { path } : {}),
			}),

		read: (agentId: string, sessionId: string, path: string) =>
			client.get<{ content: string; name: string; size: number }>(
				'/workspace/file-content',
				{ agent_id: agentId, session_id: sessionId, path },
			),

		save: (agentId: string, sessionId: string, path: string, content: string) =>
			client.post<{ status: string }>(
				'/workspace/file-content',
				{ content },
				{ agent_id: agentId, session_id: sessionId, path },
			),
	},
};
