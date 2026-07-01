import { BookOpen, ChevronRight, FileText, FolderOpen, FolderPlus, Loader2, Plus, ScrollText, Search, Trash2, Upload, X } from 'lucide-react';
import { useState, useMemo, useRef, useCallback, type FC } from 'react';

import type { WikiPageInfo, RawDocInfo } from '@/api';
import { wikiApi } from '@/api';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/useI18n';

const CATEGORY_LABELS: Record<string, string> = {
	concepts: 'concepts/',
	entities: 'entities/',
	topics: 'topics/',
	analysis: 'analysis/',
	journal: 'journal/',
};

const CATEGORY_ORDER = ['concepts', 'entities', 'topics', 'analysis', 'journal'];

const CATEGORY_COLORS: Record<string, string> = {
	concepts: '#3b82f6',
	entities: '#22c55e',
	topics: '#a855f7',
	analysis: '#f97316',
	journal: '#eab308',
};

interface WikiSidebarProps {
	pages: WikiPageInfo[];
	raws: RawDocInfo[];
	selectedPath: string | null;
	selectedRawFilename: string | null;
	selectedMeta: 'index' | 'log' | null;
	ingestingFiles: Set<string>;
	onSelectPage: (page: WikiPageInfo) => void;
	onSelectRaw: (raw: RawDocInfo) => void;
	onSelectMeta: (file: 'index' | 'log') => void;
	onRawUploaded: () => void;
	onPagesChanged: () => void;
	onDeletePage: (page: WikiPageInfo) => void;
	onDeleteRaw: (raw: RawDocInfo) => void;
	agentId: string | null;
}

interface ContextMenuState {
	x: number;
	y: number;
	type: 'raw-folder' | 'raw-file' | 'wiki-folder' | 'wiki-subdir' | 'wiki-file';
	target?: string; // filename, path, or category
}

export const WikiSidebar: FC<WikiSidebarProps> = ({
	pages,
	raws,
	selectedPath,
	selectedRawFilename,
	selectedMeta,
	ingestingFiles,
	onSelectPage,
	onSelectRaw,
	onSelectMeta,
	onRawUploaded,
	onPagesChanged,
	onDeletePage,
	onDeleteRaw,
	agentId,
}) => {
	const { t } = useTranslation();
	const [search, setSearch] = useState('');
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const uploadTargetRef = useRef<string | null>(null);

	const filtered = useMemo(() => {
		if (!search.trim()) return pages;
		const keywords = search.toLowerCase().split(/\s+/).filter(Boolean);
		return pages.filter((p) => {
			const haystack = `${p.title} ${p.path} ${p.tags.join(' ')} ${p.category}`.toLowerCase();
			return keywords.every((kw) => haystack.includes(kw));
		});
	}, [pages, search]);

	const filteredRaws = useMemo(() => {
		if (!search.trim()) return raws;
		const keywords = search.toLowerCase().split(/\s+/).filter(Boolean);
		return raws.filter((r) => {
			const haystack = r.filename.toLowerCase();
			return keywords.every((kw) => haystack.includes(kw));
		});
	}, [raws, search]);

	const grouped = useMemo(() => {
		const groups: Record<string, WikiPageInfo[]> = {};
		for (const p of filtered) {
			const cat = p.category || 'other';
			(groups[cat] ??= []).push(p);
		}
		return groups;
	}, [filtered]);

	const toggleCategory = (cat: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(cat)) next.delete(cat);
			else next.add(cat);
			return next;
		});
	};

	const isSearching = search.trim().length > 0;
	const isExpanded = (cat: string) => isSearching || !collapsed.has(cat);

	const openCtx = useCallback((e: React.MouseEvent, state: ContextMenuState) => {
		e.preventDefault();
		e.stopPropagation();
		setCtxMenu({ ...state, x: e.clientX, y: e.clientY });
	}, []);

	const closeCtx = () => setCtxMenu(null);

	const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files;
		if (!files || !agentId) return;
		const target = uploadTargetRef.current;
		for (const file of Array.from(files)) {
			const content = await file.text();
			if (target === 'raw') {
				await wikiApi.uploadRaw(agentId, file.name, content);
			} else if (target) {
				const path = `${target}/${file.name}`;
				await wikiApi.createPage(agentId, path, content);
			}
		}
		e.target.value = '';
		uploadTargetRef.current = null;
		onRawUploaded();
		onPagesChanged();
	};

	const triggerUpload = (target: string) => {
		uploadTargetRef.current = target;
		fileInputRef.current?.click();
		closeCtx();
	};

	const handleNewDoc = async (dir: string) => {
		closeCtx();
		const name = prompt(t('wiki.newDocPrompt'));
		if (!name || !agentId) return;
		const filename = name.endsWith('.md') ? name : `${name}.md`;
		if (dir === 'raw') {
			await wikiApi.uploadRaw(agentId, filename, '');
			onRawUploaded();
		} else {
			const path = `${dir}/${filename}`;
			await wikiApi.createPage(agentId, path, '');
			onPagesChanged();
		}
	};

	const handleNewDir = async () => {
		closeCtx();
		const name = prompt(t('wiki.newDirPrompt'));
		if (!name || !agentId) return;
		const parent = ctxMenu?.target || '';
		const path = parent ? `${parent}/${name}` : name;
		await wikiApi.createDir(agentId, path);
		onPagesChanged();
	};

	const handleDeleteDir = async () => {
		closeCtx();
		if (!ctxMenu?.target || !agentId) return;
		if (!confirm(t('wiki.deleteDirConfirm', { name: ctxMenu.target }))) return;
		await wikiApi.deleteDir(agentId, ctxMenu.target);
		onPagesChanged();
	};

	const handleDeleteFile = () => {
		closeCtx();
		if (!ctxMenu?.target) return;
		if (ctxMenu.type === 'raw-file') {
			const raw = raws.find((r) => r.filename === ctxMenu.target);
			if (raw) onDeleteRaw(raw);
		} else if (ctxMenu.type === 'wiki-file') {
			const page = pages.find((p) => p.path === ctxMenu.target);
			if (page) onDeletePage(page);
		}
	};

	return (
		<div className="flex flex-col h-full">
			<div className="px-2 pb-1">
				<div className="relative">
					<Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground pointer-events-none" />
					<input
						placeholder={t('wiki.search')}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="w-full rounded-md border border-input bg-transparent text-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
						style={{ height: 26, paddingLeft: 22, paddingRight: 22, fontSize: 12 }}
					/>
					{search && (
						<button
							onClick={() => setSearch('')}
							className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						>
							<X className="size-3" />
						</button>
					)}
				</div>
				{search.trim() && (
					<div className="text-[10px] text-muted-foreground mt-0.5 px-0.5">
						{filtered.length + filteredRaws.length} {t('wiki.searchResults')}
					</div>
				)}
			</div>
			<div className="flex-1 overflow-y-auto px-2 pb-2 text-sm">
				{/* Meta files */}
				<div className="mb-2">
					<button
						onClick={() => onSelectMeta('index')}
						className={cn(
							'w-full text-left rounded-md px-3 py-1.5 transition-colors hover:bg-accent flex items-center gap-2',
							selectedMeta === 'index' && 'bg-accent font-medium',
						)}
					>
						<BookOpen className="size-3.5 shrink-0 text-emerald-500" />
						<span className="font-bold text-emerald-600 dark:text-emerald-400">index.md</span>
					</button>
					<button
						onClick={() => onSelectMeta('log')}
						className={cn(
							'w-full text-left rounded-md px-3 py-1.5 transition-colors hover:bg-accent flex items-center gap-2',
							selectedMeta === 'log' && 'bg-accent font-medium',
						)}
					>
						<ScrollText className="size-3.5 shrink-0 text-orange-500" />
						<span className="font-bold text-orange-500">log.md</span>
					</button>
				</div>

				{/* raw/ directory */}
				<div className="mb-2">
					<button
						onClick={() => toggleCategory('raw')}
						onContextMenu={(e) => openCtx(e, { x: 0, y: 0, type: 'raw-folder', target: 'raw' })}
						className="flex items-center gap-1 w-full text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 hover:text-foreground"
					>
						<ChevronRight className={cn('size-3 transition-transform', isExpanded('raw') && 'rotate-90')} />
						<FolderOpen className="size-3 text-yellow-600" />
						<span className="font-bold text-yellow-600">raw/ ({raws.length})</span>
					</button>
					{isExpanded('raw') && (
						<div className="flex flex-col gap-0.5 mt-0.5 ml-3">
							{filteredRaws.map((raw) => (
								<button
									key={raw.filename}
									onClick={() => onSelectRaw(raw)}
									onContextMenu={(e) => openCtx(e, { x: 0, y: 0, type: 'raw-file', target: raw.filename })}
									className={cn(
										'w-full text-left rounded-md px-3 py-1 transition-colors hover:bg-accent flex items-center gap-2',
										selectedRawFilename === raw.filename && 'bg-accent font-medium',
									)}
								>
									<FileText className="size-3.5 shrink-0 text-muted-foreground" />
									<span className="truncate">{raw.filename}</span>
									{ingestingFiles.has(raw.filename) ? (
										<Loader2 className="ml-auto size-3.5 animate-spin text-blue-500 shrink-0" />
									) : raw.status === 'ingested' ? (
										<span className="ml-auto text-xs text-green-600 dark:text-green-400 shrink-0">✓</span>
									) : raw.status === 'modified' ? (
										<span className="ml-auto text-xs text-orange-600 dark:text-orange-400 shrink-0">●</span>
									) : (
										<span className="ml-auto text-xs text-yellow-600 dark:text-yellow-400 shrink-0">○</span>
									)}
								</button>
							))}
							{raws.length === 0 && (
								<p className="text-xs text-muted-foreground px-3 py-1">{t('wiki.noRawDocs')}</p>
							)}
						</div>
					)}
				</div>

				{/* wiki/ directory */}
				<div className="mb-2">
					<button
						onClick={() => toggleCategory('wiki')}
						onContextMenu={(e) => openCtx(e, { x: 0, y: 0, type: 'wiki-folder', target: '' })}
						className="flex items-center gap-1 w-full text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 py-1 hover:text-foreground"
					>
						<ChevronRight className={cn('size-3 transition-transform', isExpanded('wiki') && 'rotate-90')} />
						<FolderOpen className="size-3 text-blue-600" />
						<span className="font-bold text-blue-600 dark:text-blue-400">wiki/ ({pages.length})</span>
					</button>
					{isExpanded('wiki') && (
						<div className="ml-3">
							{CATEGORY_ORDER.map((cat) => {
								const catPages = grouped[cat];
								return (
									<div key={cat} className="mb-1">
										<button
											onClick={() => toggleCategory(`wiki-${cat}`)}
											onContextMenu={(e) => openCtx(e, { x: 0, y: 0, type: 'wiki-subdir', target: cat })}
											className="flex items-center gap-1 w-full text-xs text-muted-foreground px-2 py-0.5 hover:text-foreground"
										>
											<ChevronRight className={cn('size-3 transition-transform', isExpanded(`wiki-${cat}`) && 'rotate-90')} />
											<FolderOpen className="size-3" style={{ color: CATEGORY_COLORS[cat] }} />
											<span className="font-bold" style={{ color: CATEGORY_COLORS[cat] }}>
												{CATEGORY_LABELS[cat]}
												{catPages?.length ? ` (${catPages.length})` : ''}
											</span>
										</button>
										{isExpanded(`wiki-${cat}`) && catPages && (
											<div className="flex flex-col gap-0.5 mt-0.5 ml-4">
												{catPages.map((page) => (
													<button
														key={page.path}
														onClick={() => onSelectPage(page)}
														onContextMenu={(e) => openCtx(e, { x: 0, y: 0, type: 'wiki-file', target: page.path })}
														className={cn(
															'w-full text-left rounded-md px-2 py-1 transition-colors hover:bg-accent flex items-center gap-1.5',
															selectedPath === page.path && 'bg-accent font-medium',
														)}
													>
														<FileText className="size-3 shrink-0" style={{ color: CATEGORY_COLORS[cat] }} />
														<span className="truncate" style={{ color: CATEGORY_COLORS[cat] }}>{page.title}</span>
													</button>
												))}
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}
				</div>

				{filtered.length === 0 && pages.length === 0 && raws.length === 0 && (
					<p className="text-xs text-muted-foreground text-center py-4">{t('wiki.noPages')}</p>
				)}
			</div>

			{/* Right-click context menu */}
			{ctxMenu && (
				<DropdownMenu open onOpenChange={(open) => !open && closeCtx()}>
					<DropdownMenuTrigger asChild>
						<span className="fixed" style={{ left: ctxMenu.x, top: ctxMenu.y, width: 0, height: 0 }} />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" side="bottom">
						{/* raw folder */}
						{ctxMenu.type === 'raw-folder' && (
							<>
								<DropdownMenuItem onSelect={() => triggerUpload('raw')}>
									<Upload className="size-4 mr-2" />
									{t('wiki.uploadDoc')}
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => handleNewDoc('raw')}>
									<Plus className="size-4 mr-2" />
									{t('wiki.newDoc')}
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={handleNewDir}>
									<FolderPlus className="size-4 mr-2" />
									{t('wiki.newDir')}
								</DropdownMenuItem>
							</>
						)}

						{/* raw file */}
						{ctxMenu.type === 'raw-file' && (
							<DropdownMenuItem onSelect={handleDeleteFile} className="text-destructive">
								<Trash2 className="size-4 mr-2" />
								{t('wiki.deletePage')}
							</DropdownMenuItem>
						)}

						{/* wiki root folder */}
						{ctxMenu.type === 'wiki-folder' && (
							<>
								<DropdownMenuItem disabled>
									<Plus className="size-4 mr-2" />
									{t('wiki.newDoc')}
								</DropdownMenuItem>
								<DropdownMenuItem disabled>
									<Upload className="size-4 mr-2" />
									{t('wiki.uploadDoc')}
								</DropdownMenuItem>
							</>
						)}

						{/* wiki subdirectory */}
						{ctxMenu.type === 'wiki-subdir' && (
							<>
								<DropdownMenuItem disabled>
									<Plus className="size-4 mr-2" />
									{t('wiki.newDoc')}
								</DropdownMenuItem>
								<DropdownMenuItem disabled>
									<Upload className="size-4 mr-2" />
									{t('wiki.uploadDoc')}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem disabled className="text-destructive">
									<Trash2 className="size-4 mr-2" />
									{t('wiki.deleteDir')}
								</DropdownMenuItem>
							</>
						)}

						{/* wiki file */}
						{ctxMenu.type === 'wiki-file' && (
							<DropdownMenuItem disabled className="text-destructive">
								<Trash2 className="size-4 mr-2" />
								{t('wiki.deletePage')}
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			)}

			<input
				ref={fileInputRef}
				type="file"
				accept=".md,.txt,.markdown"
				multiple
				onChange={handleFileUpload}
				className="hidden"
			/>
		</div>
	);
};
