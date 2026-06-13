import { BotMessageSquare, Copy, Key, Loader2, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { agentApi, userApi, type AgentRecord, type UserListItem, type UserRecord } from '@/api';
import { DeleteDialog } from '@/components/dialog/DeleteDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useTranslation } from '@/i18n/useI18n';
import { toast } from 'sonner';

function CopyButton({ text }: { text: string }) {
	return (
		<Button
			variant="ghost"
			size="icon-xs"
			onClick={async () => {
				await navigator.clipboard.writeText(text);
				toast.success('已复制');
			}}
		>
			<Copy className="size-3" />
		</Button>
	);
}

export const UserPage = () => {
	const { t } = useTranslation();
	const [users, setUsers] = useState<UserListItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);

	const [createOpen, setCreateOpen] = useState(false);
	const [createName, setCreateName] = useState('');
	const [creating, setCreating] = useState(false);
	const [createdToken, setCreatedToken] = useState<string | null>(null);

	const [deleteOpen, setDeleteOpen] = useState(false);
	const [regenerating, setRegenerating] = useState(false);

	// Agent assignment state
	const [allAgents, setAllAgents] = useState<AgentRecord[]>([]);
	const [assignedAgentIds, setAssignedAgentIds] = useState<Set<string>>(new Set());
	const [assigningAgentId, setAssigningAgentId] = useState('');

	const fetchUsers = useCallback(async () => {
		setLoading(true);
		try {
			const data = await userApi.list();
			setUsers(data);
		} catch {
			setUsers([]);
		} finally {
			setLoading(false);
		}
	}, []);

	const fetchAgents = useCallback(async () => {
		try {
			const res = await agentApi.list();
			setAllAgents(res.agents);
		} catch {
			setAllAgents([]);
		}
	}, []);

	const fetchAssignments = useCallback(async (userId: string) => {
		try {
			const assignments = await userApi.listAssignments();
			const ids = new Set(
				assignments
					.filter((a) => a.assigned_to === userId)
					.map((a) => a.agent_id),
			);
			setAssignedAgentIds(ids);
		} catch {
			setAssignedAgentIds(new Set());
		}
	}, []);

	useEffect(() => {
		fetchUsers();
		fetchAgents();
	}, [fetchUsers, fetchAgents]);

	useEffect(() => {
		if (!selectedId) {
			setSelectedUser(null);
			setAssignedAgentIds(new Set());
			return;
		}
		setDetailLoading(true);
		Promise.all([
			userApi.get(selectedId),
			fetchAssignments(selectedId),
		])
			.then(([user]) => setSelectedUser(user))
			.catch(() => setSelectedUser(null))
			.finally(() => setDetailLoading(false));
	}, [selectedId, fetchAssignments]);

	const handleCreate = async () => {
		if (!createName.trim()) return;
		setCreating(true);
		try {
			const record = await userApi.create(createName.trim());
			setCreatedToken(record.token);
			await fetchUsers();
			setSelectedId(record.user_id);
		} catch {
			// handled by client
		} finally {
			setCreating(false);
		}
	};

	const handleDelete = async () => {
		if (!selectedId) return;
		await userApi.remove(selectedId);
		setSelectedId(null);
		await fetchUsers();
	};

	const handleRegenerate = async () => {
		if (!selectedId) return;
		setRegenerating(true);
		try {
			const updated = await userApi.regenerateToken(selectedId);
			setSelectedUser(updated);
			toast.success('Token 已重新生成');
		} finally {
			setRegenerating(false);
		}
	};

	const handleAssignAgent = async () => {
		if (!selectedId || !assigningAgentId) return;
		await userApi.assignAgent(assigningAgentId, selectedId);
		setAssignedAgentIds((prev) => new Set(prev).add(assigningAgentId));
		setAssigningAgentId('');
	};

	const handleUnassignAgent = async (agentId: string) => {
		if (!selectedId) return;
		await userApi.unassignAgent(agentId);
		setAssignedAgentIds((prev) => {
			const next = new Set(prev);
			next.delete(agentId);
			return next;
		});
	};

	const assignedAgents = allAgents.filter((a) => assignedAgentIds.has(a.id));
	const unassignedAgents = allAgents.filter((a) => !assignedAgentIds.has(a.id));

	return (
		<div className="flex h-full w-full">
			{/* Left sidebar */}
			<Sidebar collapsible="none" className="w-72 border-r">
				<SidebarHeader className="flex flex-col mt-5 gap-y-1">
					<div className="text-lg font-semibold">{t('common.users')}</div>
					<div className="text-muted-foreground text-xs">{t('user-mgmt.subtitle')}</div>
				</SidebarHeader>
				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupLabel className="text-sm font-bold text-sidebar-foreground tracking-normal">
							{t('user-mgmt.employees')}
						</SidebarGroupLabel>
						<SidebarGroupContent className="pl-3">
							{loading ? (
								<div className="flex justify-center py-4">
									<Loader2 className="size-4 animate-spin text-muted-foreground" />
								</div>
							) : users.length === 0 ? (
								<p className="text-xs text-muted-foreground/50 px-2 py-1">
									{t('user-mgmt.noEmployees')}
								</p>
							) : (
								<SidebarMenu>
									{users.map((u) => (
										<SidebarMenuItem key={u.user_id}>
											<SidebarMenuButton
												isActive={selectedId === u.user_id}
												onClick={() => setSelectedId(u.user_id)}
											>
												<span className="truncate text-muted-foreground">
													{u.name}
												</span>
											</SidebarMenuButton>
										</SidebarMenuItem>
									))}
								</SidebarMenu>
							)}
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>

				<div className="p-3">
					<Dialog
						open={createOpen}
						onOpenChange={(o) => {
							setCreateOpen(o);
							if (!o) {
								setCreateName('');
								setCreatedToken(null);
							}
						}}
					>
						<DialogTrigger asChild>
							<Button className="w-full gap-1.5" size="sm">
								<UserPlus className="size-4" />
								{t('user-mgmt.addEmployee')}
							</Button>
						</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>{t('user-mgmt.addEmployee')}</DialogTitle>
								<DialogDescription>
									{t('user-mgmt.addEmployeeDesc')}
								</DialogDescription>
							</DialogHeader>
							{createdToken ? (
								<div className="flex flex-col gap-3">
									<p className="text-sm text-green-600 font-medium">
										{t('user-mgmt.created')}
									</p>
									<div className="flex flex-col gap-1">
										<span className="text-xs text-muted-foreground">
											{t('user-mgmt.tokenLabel')}
										</span>
										<div className="flex items-center gap-2 bg-muted rounded px-3 py-2">
											<code className="text-xs font-mono break-all flex-1">
												{createdToken}
											</code>
											<CopyButton text={createdToken} />
										</div>
										<p className="text-xs text-muted-foreground">
											{t('user-mgmt.tokenHint')}
										</p>
									</div>
									<DialogFooter>
										<DialogClose asChild>
											<Button>{t('common.close')}</Button>
										</DialogClose>
									</DialogFooter>
								</div>
							) : (
								<div className="flex flex-col gap-3">
									<Input
										placeholder={t('user-mgmt.namePlaceholder')}
										value={createName}
										onChange={(e) => setCreateName(e.target.value)}
										onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
									/>
									<DialogFooter>
										<DialogClose asChild>
											<Button variant="outline">{t('common.cancel')}</Button>
										</DialogClose>
										<Button
											onClick={handleCreate}
											disabled={creating || !createName.trim()}
										>
											{creating ? t('common.creating') : t('common.create')}
										</Button>
									</DialogFooter>
								</div>
							)}
						</DialogContent>
					</Dialog>
				</div>
			</Sidebar>

			{/* Right detail */}
			<main className="flex-1 min-h-0 overflow-hidden">
				{detailLoading ? (
					<div className="flex items-center justify-center h-full">
						<Loader2 className="size-6 animate-spin text-muted-foreground" />
					</div>
				) : selectedUser ? (
					<div className="flex flex-col gap-y-6 p-6 overflow-y-auto h-full">
						<div className="flex items-start justify-between gap-x-4">
							<div>
								<h2 className="text-lg font-semibold">{selectedUser.name}</h2>
								<p className="text-muted-foreground text-sm">
									ID: {selectedUser.user_id}
								</p>
							</div>
							<Button
								size="icon-sm"
								variant="destructive"
								onClick={() => setDeleteOpen(true)}
							>
								<Trash2 />
							</Button>
						</div>

						<Separator />

						{/* Token section */}
						<div className="flex flex-col gap-y-3">
							<div className="flex flex-col gap-y-1">
								<span className="text-xs text-muted-foreground uppercase tracking-wide">
									{t('user-mgmt.tokenLabel')}
								</span>
								<div className="flex items-center gap-2 bg-muted rounded px-3 py-2">
									<code className="text-xs font-mono break-all flex-1">
										{selectedUser.token}
									</code>
									<CopyButton text={selectedUser.token} />
								</div>
							</div>

							<Button
								variant="outline"
								size="sm"
								className="w-fit gap-1.5"
								onClick={handleRegenerate}
								disabled={regenerating}
							>
								<Key className="size-3.5" />
								{regenerating
									? t('common.loading')
									: t('user-mgmt.regenerateToken')}
							</Button>

							<div className="flex flex-col gap-y-1">
								<span className="text-xs text-muted-foreground uppercase tracking-wide">
									{t('user-mgmt.createdAt')}
								</span>
								<span className="text-sm">
									{new Date(selectedUser.created_at).toLocaleString()}
								</span>
							</div>
						</div>

						<Separator />

						{/* Agent assignment section */}
						<div className="flex flex-col gap-y-3">
							<h3 className="text-sm font-semibold">
								{t('user-mgmt.assignedAgents')}
							</h3>

							{/* Assigned agents list */}
							{assignedAgents.length === 0 ? (
								<p className="text-xs text-muted-foreground">
									{t('user-mgmt.noAssignedAgents')}
								</p>
							) : (
								<div className="flex flex-col gap-1">
									{assignedAgents.map((agent) => (
										<div
											key={agent.id}
											className="flex items-center justify-between bg-muted rounded px-3 py-2"
										>
											<div className="flex items-center gap-2">
												<BotMessageSquare className="size-4 text-muted-foreground" />
												<span className="text-sm">{agent.data.name}</span>
											</div>
											<Button
												variant="ghost"
												size="icon-xs"
												onClick={() => handleUnassignAgent(agent.id)}
											>
												<X className="size-3" />
											</Button>
										</div>
									))}
								</div>
							)}

							{/* Assign new agent */}
							{unassignedAgents.length > 0 && (
								<div className="flex items-center gap-2">
									<Select
										value={assigningAgentId}
										onValueChange={setAssigningAgentId}
									>
										<SelectTrigger className="flex-1" size="sm">
											<SelectValue placeholder={t('user-mgmt.selectAgent')} />
										</SelectTrigger>
										<SelectContent>
											{unassignedAgents.map((a) => (
												<SelectItem key={a.id} value={a.id}>
													{a.data.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<Button
										size="sm"
										disabled={!assigningAgentId}
										onClick={handleAssignAgent}
									>
										<Plus className="size-3.5" />
										{t('user-mgmt.assign')}
									</Button>
								</div>
							)}
						</div>
					</div>
				) : (
					<div className="flex h-full items-center justify-center">
						<Empty className="border-none">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<UserPlus />
								</EmptyMedia>
								<EmptyTitle>{t('user-mgmt.selectHint')}</EmptyTitle>
								<EmptyDescription>
									{t('user-mgmt.selectHintDesc')}
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					</div>
				)}
			</main>

			{selectedUser && (
				<DeleteDialog
					open={deleteOpen}
					onOpenChange={setDeleteOpen}
					title={t('common.deleteTitle', {
						entity: t('user-mgmt.entity'),
						name: selectedUser.name,
					})}
					description={t('common.deleteDescription')}
					onConfirm={handleDelete}
				/>
			)}
		</div>
	);
};
