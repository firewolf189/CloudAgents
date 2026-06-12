import type { Task, TaskContext } from '@agentscope-ai/agentscope/state';
import {
	CheckCircle,
	CircleStop,
	Ellipsis,
	Loader2,
	MoreHorizontal,
	Square,
	SquareCheck,
	Trash2,
} from 'lucide-react';
import { useState } from 'react';

import { taskApi } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/i18n/useI18n';
import { cn } from '@/lib/utils';

interface TaskPanelProps {
	tasksContext: TaskContext | null;
	agentId?: string | null;
	sessionId?: string | null;
	onTasksChanged?: () => void;
	className?: string;
}

function StateIcon({ state }: { state: Task['state'] }) {
	switch (state) {
		case 'completed':
			return <SquareCheck className="size-3 shrink-0" />;
		case 'in_progress':
			return <Loader2 className="size-3 animate-spin shrink-0" />;
		default:
			return <Square className="size-3 shrink-0" />;
	}
}

function filterTasksWithEllipsis(tasks: Task[]): {
	showEllipsis: boolean;
	visibleTasks: Task[];
} {
	let consecutiveCompleted = 0;
	for (const task of tasks) {
		if (task.state === 'completed') {
			consecutiveCompleted++;
		} else {
			break;
		}
	}

	const MAX_VISIBLE_COMPLETED = 3;
	if (consecutiveCompleted <= MAX_VISIBLE_COMPLETED) {
		return { showEllipsis: false, visibleTasks: tasks };
	}

	return {
		showEllipsis: true,
		visibleTasks: tasks.slice(consecutiveCompleted - MAX_VISIBLE_COMPLETED),
	};
}

export function TaskPanel({
	tasksContext,
	agentId,
	sessionId,
	onTasksChanged,
	className,
}: TaskPanelProps) {
	const { t } = useTranslation();
	const [expanded, setExpanded] = useState(false);

	if (!tasksContext || tasksContext.tasks.length === 0) {
		return null;
	}

	const canManage = !!agentId && !!sessionId;
	const { tasks } = tasksContext;
	const completed = tasks.filter((task) => task.state === 'completed').length;
	const stuckCount = tasks.filter((task) => task.state === 'in_progress').length;
	const { showEllipsis, visibleTasks } = filterTasksWithEllipsis(tasks);
	const displayedTasks = expanded ? tasks : visibleTasks;

	const handleUpdateTask = async (taskId: string, state: string) => {
		if (!agentId || !sessionId) return;
		await taskApi.update(agentId, sessionId, taskId, state);
		onTasksChanged?.();
	};

	const handleClear = async (mode: 'all' | 'completed' | 'stuck') => {
		if (!agentId || !sessionId) return;
		await taskApi.clear(agentId, sessionId, mode);
		onTasksChanged?.();
	};

	return (
		<div className={cn('flex flex-col text-sm py-2 px-3 overflow-hidden', className)}>
			<div className="flex flex-row items-center justify-between">
				<span className="font-bold text-muted-foreground">{t('task-panel.heading')}</span>
				<div className="flex items-center gap-1">
					<Badge variant={'secondary'} className="tracking-wide">
						{completed}/{tasks.length}
					</Badge>
					{canManage && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon-xs">
									<MoreHorizontal className="size-3.5" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{stuckCount > 0 && (
									<DropdownMenuItem onClick={() => handleClear('stuck')}>
										<CircleStop className="size-3.5" />
										{t('task-panel.fixStuck', { count: stuckCount })}
									</DropdownMenuItem>
								)}
								{completed > 0 && (
									<DropdownMenuItem onClick={() => handleClear('completed')}>
										<Trash2 className="size-3.5" />
										{t('task-panel.clearCompleted')}
									</DropdownMenuItem>
								)}
								<DropdownMenuItem
									variant="destructive"
									onClick={() => handleClear('all')}
								>
									<Trash2 className="size-3.5" />
									{t('task-panel.clearAll')}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			</div>

			<ul className="flex flex-col gap-y-0.5 text-xs overflow-y-auto h-full">
				{showEllipsis && !expanded && (
					<Button
						size={'xs'}
						variant={'ghost'}
						className="flex items-center justify-center w-full"
						onClick={() => setExpanded(true)}
					>
						<Ellipsis className="size-3 text-muted-foreground" />
					</Button>
				)}
				{displayedTasks.map((task) => (
					<li
						key={task.id}
						className={cn(
							'group flex gap-2 rounded px-2 py-1 items-center',
							task.state === 'completed' && 'opacity-60',
						)}
					>
						<StateIcon state={task.state} />
						<div className="flex flex-col min-w-0 gap-0.5 flex-1">
							<span className="flex items-center gap-1.5">
								<span className="text-xs font-mono text-muted-foreground">
									#{task.id}
								</span>
								<span
									className={cn(
										'truncate',
										task.state === 'completed' && 'line-through',
									)}
								>
									{task.subject}
								</span>
							</span>
							{task.blocked_by.length > 0 && (
								<span className="text-xs text-muted-foreground">
									← {t('task-panel.blockedBy')}{' '}
									{task.blocked_by.map((id) => `#${id}`).join(', ')}
								</span>
							)}
						</div>
						{canManage && task.state === 'in_progress' && (
							<Button
								variant="ghost"
								size="icon-xs"
								className="opacity-0 group-hover:opacity-100 shrink-0"
								title={t('task-panel.markComplete')}
								onClick={() => handleUpdateTask(String(task.id), 'completed')}
							>
								<CheckCircle className="size-3" />
							</Button>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}
