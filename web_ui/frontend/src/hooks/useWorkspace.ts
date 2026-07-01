import { useState, useEffect, useCallback } from 'react';

import { workspaceApi } from '@/api';
import type { MCPClient, MCPClientStatus, Skill, ToolGroupInfo } from '@/api';

export function useWorkspace(agentId: string | null, sessionId: string | null) {
	const [mcps, setMcps] = useState<MCPClientStatus[]>([]);
	const [skills, setSkills] = useState<Skill[]>([]);
	const [toolGroups, setToolGroups] = useState<ToolGroupInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [skillsLoading, setSkillsLoading] = useState(false);
	const [toolsLoading, setToolsLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	const refetch = useCallback(async () => {
		if (!agentId || !sessionId) {
			setMcps([]);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			setMcps(await workspaceApi.mcp.list(agentId, sessionId));
		} catch (e) {
			setError(e as Error);
		} finally {
			setLoading(false);
		}
	}, [agentId, sessionId]);

	const refetchSkills = useCallback(async () => {
		if (!agentId || !sessionId) {
			setSkills([]);
			return;
		}
		setSkillsLoading(true);
		try {
			setSkills(await workspaceApi.skill.list(agentId, sessionId));
		} catch (e) {
			setError(e as Error);
		} finally {
			setSkillsLoading(false);
		}
	}, [agentId, sessionId]);

	const refetchTools = useCallback(async () => {
		if (!agentId || !sessionId) {
			setToolGroups([]);
			return;
		}
		setToolsLoading(true);
		try {
			const overview = await workspaceApi.tools.list(agentId, sessionId);
			setToolGroups(overview.groups);
		} catch (e) {
			setError(e as Error);
		} finally {
			setToolsLoading(false);
		}
	}, [agentId, sessionId]);

	useEffect(() => {
		refetch();
	}, [refetch]);
	useEffect(() => {
		refetchSkills();
	}, [refetchSkills]);
	useEffect(() => {
		refetchTools();
	}, [refetchTools]);

	const addMcps = useCallback(
		async (clients: MCPClient[]) => {
			if (!agentId || !sessionId) throw new Error('No agent/session selected');
			const existingNames = new Set(mcps.map((m) => m.name));
			for (const mcp of clients) {
				if (existingNames.has(mcp.name)) {
					throw new Error(`MCP server "${mcp.name}" already exists in this workspace.`);
				}
			}
			const batchNames = new Set<string>();
			for (const mcp of clients) {
				if (batchNames.has(mcp.name)) {
					throw new Error(`Duplicate MCP server name "${mcp.name}" in configuration.`);
				}
				batchNames.add(mcp.name);
			}
			for (const mcp of clients) {
				await workspaceApi.mcp.add(agentId, sessionId, mcp);
			}
			await refetch();
		},
		[agentId, sessionId, mcps, refetch],
	);

	const removeMcp = useCallback(
		async (mcpName: string) => {
			if (!agentId || !sessionId) throw new Error('No agent/session selected');
			await workspaceApi.mcp.remove(mcpName, agentId, sessionId);
			await refetch();
		},
		[agentId, sessionId, refetch],
	);

	const updateMcp = useCallback(
		async (oldName: string, newMcp: MCPClient) => {
			if (!agentId || !sessionId) throw new Error('No agent/session selected');
			await workspaceApi.mcp.remove(oldName, agentId, sessionId);
			await workspaceApi.mcp.add(agentId, sessionId, newMcp);
			await refetch();
		},
		[agentId, sessionId, refetch],
	);

	const addSkill = useCallback(
		async (skillPath: string) => {
			if (!agentId || !sessionId) throw new Error('No agent/session selected');
			await workspaceApi.skill.add(agentId, sessionId, { skill_path: skillPath });
			await refetchSkills();
		},
		[agentId, sessionId, refetchSkills],
	);

	const removeSkill = useCallback(
		async (skillName: string) => {
			if (!agentId || !sessionId) throw new Error('No agent/session selected');
			await workspaceApi.skill.remove(skillName, agentId, sessionId);
			await refetchSkills();
		},
		[agentId, sessionId, refetchSkills],
	);

	const installSkill = useCallback(
		async (source: string, skill?: string) => {
			if (!agentId || !sessionId) throw new Error('No agent/session selected');
			const res = await workspaceApi.skill.install(agentId, sessionId, { source, skill });
			await refetchSkills();
			return res;
		},
		[agentId, sessionId, refetchSkills],
	);

	const uploadSkill = useCallback(
		async (file: File) => {
			if (!agentId || !sessionId) throw new Error('No agent/session selected');
			await workspaceApi.skill.upload(agentId, sessionId, file);
			await refetchSkills();
		},
		[agentId, sessionId, refetchSkills],
	);

	return {
		mcps,
		loading,
		error,
		refetch,
		addMcps,
		removeMcp,
		updateMcp,
		skills,
		skillsLoading,
		addSkill,
		removeSkill,
		installSkill,
		uploadSkill,
		toolGroups,
		toolsLoading,
	};
}
