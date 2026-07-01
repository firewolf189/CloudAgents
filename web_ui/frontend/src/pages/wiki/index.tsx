import { AlertTriangle, BookOpen, Bot, CheckCircle2, Circle, FileText, HeartPulse, Loader2, MessageSquare, Network, Pencil, Play, PlayCircle, RefreshCw, Save, Send, Settings, Trash2, Wrench } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import MDEditor from '@uiw/react-md-editor';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';

import { WikiConfigDialog } from './wiki-config-dialog';
import { WikiEditor } from './wiki-editor';
import { WikiGraph } from './wiki-graph';
import { WikiSidebar } from './wiki-sidebar';
import { WikiViewer } from './wiki-viewer';
import type { WikiPageInfo, WikiLogEntry, RawDocInfo, AgentRecord, QueryResult, LintResult, FixLinksResult, GraphData } from '@/api';
import { wikiApi, agentApi } from '@/api';
import { DeleteDialog } from '@/components/dialog/DeleteDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useI18n';

type Mode = 'view' | 'create' | 'edit' | 'raw' | 'meta' | 'query' | 'lint' | 'graph';

export default function WikiPage() {
	const { t } = useTranslation();
	const [agents, setAgents] = useState<AgentRecord[]>([]);
	const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
	const [pages, setPages] = useState<WikiPageInfo[]>([]);
	const [raws, setRaws] = useState<RawDocInfo[]>([]);
	const [selected, setSelected] = useState<WikiPageInfo | null>(null);
	const [selectedContent, setSelectedContent] = useState('');
	const [selectedRaw, setSelectedRaw] = useState<RawDocInfo | null>(null);
	const [selectedRawContent, setSelectedRawContent] = useState('');
	const [metaFile, setMetaFile] = useState<'index' | 'log' | null>(null);
	const [metaContent, setMetaContent] = useState('');
	const [logEntries, setLogEntries] = useState<WikiLogEntry[]>([]);
	const [mode, setMode] = useState<Mode>('view');
	const [configOpen, setConfigOpen] = useState(false);
	const [deleteTarget, setDeleteTarget] = useState<WikiPageInfo | null>(null);
	const [deleteRawTarget, setDeleteRawTarget] = useState<RawDocInfo | null>(null);
	const [ingesting, setIngesting] = useState<string | null>(null);
	const [ingestingAll, setIngestingAll] = useState(false);
	const [remoteIngesting, setRemoteIngesting] = useState<Set<string>>(new Set());
	const [editingRaw, setEditingRaw] = useState(false);
	const [rawContent, setRawContent] = useState('');
	const [queryInput, setQueryInput] = useState('');
	const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
	const [querying, setQuerying] = useState(false);
	const [lintResult, setLintResult] = useState<LintResult | null>(null);
	const [linting, setLinting] = useState(false);
	const [fixingLinks, setFixingLinks] = useState(false);
	const [fixLinksResult, setFixLinksResult] = useState<FixLinksResult | null>(null);
	const [rebuildingIndex, setRebuildingIndex] = useState(false);
	const [graphData, setGraphData] = useState<GraphData | null>(null);
	const [loadingGraph, setLoadingGraph] = useState(false);

	useEffect(() => {
		agentApi.list().then((res) => {
			const list = res.agents ?? res;
			setAgents(list);
			if (list.length > 0 && !selectedAgentId) {
				setSelectedAgentId(list[0].id);
			}
		});
	}, []);

	const fetchPages = useCallback(async () => {
		if (!selectedAgentId) return [];
		try {
			const list = await wikiApi.listPages(selectedAgentId);
			setPages(list);
			return list;
		} catch {
			return [];
		}
	}, [selectedAgentId]);

	const fetchRaws = useCallback(async () => {
		if (!selectedAgentId) return;
		try {
			const list = await wikiApi.listRaws(selectedAgentId);
			setRaws(list);
		} catch { /* */ }
	}, [selectedAgentId]);

	useEffect(() => {
		if (selectedAgentId) {
			setSelected(null);
			setSelectedRaw(null);
			setMetaFile(null);
			setMode('view');
			fetchPages();
			fetchRaws();
		}
	}, [selectedAgentId, fetchPages, fetchRaws]);

	// Auto-refresh when page becomes visible (e.g. user switches back from chat)
	useEffect(() => {
		const onVisible = () => {
			if (document.visibilityState === 'visible' && selectedAgentId) {
				fetchRaws();
				fetchPages();
			}
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	}, [selectedAgentId, fetchRaws, fetchPages]);

	// Poll ingest status to detect agent-triggered ingests
	const prevRemoteRef = useRef<Set<string>>(new Set());
	const isIngesting = useCallback(
		(filename: string) => ingesting === filename || remoteIngesting.has(filename),
		[ingesting, remoteIngesting],
	);
	useEffect(() => {
		if (!selectedAgentId) return;
		const timer = setInterval(async () => {
			try {
				const active = await wikiApi.ingestStatus(selectedAgentId);
				const next = new Set(active);
				setRemoteIngesting(next);
				// When a previously-active ingest finishes, refresh lists
				const prev = prevRemoteRef.current;
				if (prev.size > 0 && next.size < prev.size) {
					fetchRaws();
					fetchPages();
				}
				prevRemoteRef.current = next;
			} catch { /* */ }
		}, 3000);
		return () => clearInterval(timer);
	}, [selectedAgentId, fetchRaws, fetchPages]);

	const handleSelectPage = async (page: WikiPageInfo) => {
		if (!selectedAgentId) return;
		setSelectedRaw(null);
		setMetaFile(null);
		setSelected(page);
		setMode('view');
		try {
			const res = await wikiApi.getPage(selectedAgentId, page.path);
			setSelectedContent(res.content);
		} catch {
			setSelectedContent('');
		}
	};

	const handleSelectRaw = async (raw: RawDocInfo) => {
		if (!selectedAgentId) return;
		setSelected(null);
		setMetaFile(null);
		setSelectedRaw(raw);
		setEditingRaw(false);
		setMode('raw');
		try {
			const res = await wikiApi.getRaw(selectedAgentId, raw.filename);
			setSelectedRawContent(res.content);
		} catch {
			setSelectedRawContent('');
		}
	};

	const handleSelectMeta = async (file: 'index' | 'log') => {
		if (!selectedAgentId) return;
		setSelected(null);
		setSelectedRaw(null);
		setMetaFile(file);
		setMode('meta');
		try {
			if (file === 'index') {
				const res = await wikiApi.getIndex(selectedAgentId);
				setMetaContent(res.content);
			} else {
				const res = await wikiApi.getLog(selectedAgentId);
				setMetaContent(res.content);
				setLogEntries(res.entries ?? []);
			}
		} catch {
			setMetaContent('');
			setLogEntries([]);
		}
	};

	const handleNavigate = useCallback(
		(slug: string) => {
			const normalized = slug.startsWith('wiki/') ? slug.slice(5) : slug;
			const target = pages.find(
				(p) => p.path.includes(normalized.toLowerCase()) || p.title.toLowerCase() === normalized.toLowerCase(),
			);
			if (target) handleSelectPage(target);
		},
		[pages, selectedAgentId],
	);

	const handleCreate = async (title: string, content: string, tags: string[]) => {
		if (!selectedAgentId) return;
		const slug = title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[-\s]+/g, '-').trim();
		const path = `concepts/${slug}.md`;
		await wikiApi.createPage(selectedAgentId, path, content);
		const list = await fetchPages();
		const created = list.find((p) => p.path === path);
		if (created) {
			setSelected(created);
			setSelectedContent(content);
		}
		setMode('view');
	};

	const handleUpdate = async (_title: string, content: string, _tags: string[]) => {
		if (!selected || !selectedAgentId) return;
		await wikiApi.updatePage(selectedAgentId, selected.path, content);
		setSelectedContent(content);
		await fetchPages();
		setMode('view');
	};

	const handleDelete = async () => {
		if (!deleteTarget || !selectedAgentId) return;
		await wikiApi.deletePage(selectedAgentId, deleteTarget.path);
		if (selected?.path === deleteTarget.path) {
			setSelected(null);
			setSelectedContent('');
		}
		setDeleteTarget(null);
		await fetchPages();
	};

	const handleDeleteRaw = async () => {
		if (!deleteRawTarget || !selectedAgentId) return;
		await wikiApi.deleteRaw(selectedAgentId, deleteRawTarget.filename);
		if (selectedRaw?.filename === deleteRawTarget.filename) {
			setSelectedRaw(null);
			setMode('view');
		}
		setDeleteRawTarget(null);
		await fetchRaws();
	};

	const handleIngest = async (raw: RawDocInfo) => {
		if (!selectedAgentId) return;
		setIngesting(raw.filename);
		try {
			await wikiApi.ingest(selectedAgentId, raw.filename);
			await fetchRaws();
			await fetchPages();
		} catch {
			/* toast shown by client */
		} finally {
			setIngesting(null);
		}
	};

	return (
		<div className="flex h-full">
			{/* Sidebar */}
			<div className="w-64 border-r flex flex-col shrink-0">
				<div className="flex items-center justify-between px-3 pt-3 pb-1">
					<div className="flex items-center gap-1.5 text-sm font-medium">
						<BookOpen className="size-4" />
						{t('wiki.title')}
					</div>
					<div className="flex gap-1">
						<Button size="icon-xs" variant="ghost" title={t('wiki.queryTitle')} onClick={() => {
							setSelected(null); setSelectedRaw(null); setMetaFile(null);
							setQueryResult(null); setQueryInput(''); setMode('query');
						}}>
							<MessageSquare className="size-3.5" />
						</Button>
						<Button size="icon-xs" variant="ghost" title={t('wiki.ingestAll')} disabled={ingestingAll} onClick={async () => {
							if (!selectedAgentId) return;
							const pendingCount = raws.filter((r) => r.status !== 'ingested').length;
							if (pendingCount === 0) {
								toast.info(t('wiki.noPending'));
								return;
							}
							setIngestingAll(true);
							try {
								const results = await wikiApi.ingestAll(selectedAgentId);
								await fetchRaws();
								await fetchPages();
								toast.success(t('wiki.ingestAllDone', { count: results.length }));
							} catch { /* */ } finally { setIngestingAll(false); }
						}}>
							{ingestingAll ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />}
						</Button>
						<Button size="icon-xs" variant="ghost" title={t('wiki.graphTitle')} disabled={loadingGraph} onClick={async () => {
							if (!selectedAgentId) return;
							setSelected(null); setSelectedRaw(null); setMetaFile(null);
							setLoadingGraph(true); setMode('graph');
							try {
								const res = await wikiApi.graph(selectedAgentId);
								setGraphData(res);
							} catch { /* */ } finally { setLoadingGraph(false); }
						}}>
							<Network className="size-3.5" />
						</Button>
						<Button size="icon-xs" variant="ghost" title={t('wiki.lintTitle')} disabled={linting} onClick={async () => {
							if (!selectedAgentId) return;
							setSelected(null); setSelectedRaw(null); setMetaFile(null);
							setLinting(true); setMode('lint');
							try {
								const res = await wikiApi.lint(selectedAgentId);
								setLintResult(res);
							} catch { /* */ } finally { setLinting(false); }
						}}>
							<HeartPulse className="size-3.5" />
						</Button>
						<Button size="icon-xs" variant="ghost" onClick={() => setConfigOpen(true)}>
							<Settings className="size-3.5" />
						</Button>
					</div>
				</div>
				{/* Agent selector */}
				<div className="px-3 pb-2">
					<Select value={selectedAgentId ?? ''} onValueChange={setSelectedAgentId}>
						<SelectTrigger className="h-8 text-sm w-full">
							<SelectValue placeholder="Select agent..." />
						</SelectTrigger>
						<SelectContent>
							{agents.map((a) => (
								<SelectItem key={a.id} value={a.id}>
									<Bot className="size-3.5 text-blue-500" />
									{a.data.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<WikiSidebar
					pages={pages}
					raws={raws}
					selectedPath={selected?.path ?? null}
					selectedRawFilename={selectedRaw?.filename ?? null}
					selectedMeta={metaFile}
					ingestingFiles={useMemo(() => {
						const s = new Set(remoteIngesting);
						if (ingesting) s.add(ingesting);
						return s;
					}, [remoteIngesting, ingesting])}
					onSelectPage={handleSelectPage}
					onSelectRaw={handleSelectRaw}
					onSelectMeta={handleSelectMeta}
					onRawUploaded={fetchRaws}
					onPagesChanged={fetchPages}
					onDeletePage={(page) => setDeleteTarget(page)}
					onDeleteRaw={(raw) => setDeleteRawTarget(raw)}
					agentId={selectedAgentId}
				/>
			</div>

			{/* Main content */}
			<div className="flex-1 overflow-y-auto p-6">
				{mode === 'create' && (
					<WikiEditor onSave={handleCreate} onCancel={() => setMode('view')} />
				)}

				{mode === 'edit' && selected && (
					<WikiEditor
						initialTitle={selected.title}
						initialContent={selectedContent}
						initialTags={selected.tags}
						onSave={handleUpdate}
						onCancel={() => setMode('view')}
					/>
				)}

				{mode === 'view' && selected && (
					<div className="flex flex-col gap-4">
						<div className="flex items-center justify-between">
							<div>
								<h1 className="text-2xl font-bold">{selected.title}</h1>
								<div className="flex items-center gap-2 mt-1 flex-wrap">
									<span className="text-xs rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5">
										{selected.category}
									</span>
									<span className="text-xs text-muted-foreground">{selected.path}</span>
									{selected.created && (
										<span className="text-xs text-muted-foreground">
											{t('wiki.createdAt')}: {selected.created}
										</span>
									)}
									{selected.updated && (
										<span className="text-xs text-muted-foreground">
											{t('wiki.modifiedAt')}: {selected.updated}
										</span>
									)}
								</div>
							</div>
							<div className="flex gap-2">
								<Button size="sm" variant="ghost" onClick={() => setMode('edit')}>
									<Pencil className="size-3.5 mr-1" />
									{t('wiki.editPage')}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									className="text-destructive"
									onClick={() => setDeleteTarget(selected)}
								>
									<Trash2 className="size-3.5 mr-1" />
									{t('wiki.deletePage')}
								</Button>
							</div>
						</div>
						<WikiViewer content={selectedContent} allPages={pages} onNavigate={handleNavigate} />
					</div>
				)}

				{mode === 'raw' && selectedRaw && (
					<div className="flex flex-col gap-4">
						<div className="flex items-center justify-between">
							<div>
								<h1 className="text-2xl font-bold">{selectedRaw.filename}</h1>
								<div className="flex items-center gap-2 mt-1 flex-wrap">
									<span className={`text-xs rounded px-2 py-0.5 ${
										selectedRaw.status === 'ingested'
											? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
											: selectedRaw.status === 'modified'
												? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300'
												: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300'
									}`}>
										{t(`wiki.status_${selectedRaw.status}`)}
									</span>
									<span className="text-xs text-muted-foreground">raw/{selectedRaw.filename}</span>
									{selectedRaw.created_at && (
										<span className="text-xs text-muted-foreground">
											{t('wiki.createdAt')}: {selectedRaw.created_at}
										</span>
									)}
									{selectedRaw.modified_at && (
										<span className="text-xs text-muted-foreground">
											{t('wiki.modifiedAt')}: {selectedRaw.modified_at}
										</span>
									)}
								</div>
							</div>
							<div className="flex gap-2">
								{editingRaw ? (
									<>
										<Button
											size="sm"
											variant="default"
											onClick={async () => {
												if (!selectedAgentId) return;
												await wikiApi.updateRaw(selectedAgentId, selectedRaw.filename, rawContent);
												setSelectedRawContent(rawContent);
												setEditingRaw(false);
												await fetchRaws();
											}}
										>
											<Save className="size-3.5 mr-1" />
											{t('wiki.save')}
										</Button>
										<Button
											size="sm"
											variant="ghost"
											onClick={() => setEditingRaw(false)}
										>
											{t('wiki.cancel')}
										</Button>
									</>
								) : (
									<Button
										size="sm"
										variant="ghost"
										onClick={() => {
											setRawContent(selectedRawContent);
											setEditingRaw(true);
										}}
									>
										<Pencil className="size-3.5 mr-1" />
										{t('wiki.editPage')}
									</Button>
								)}
								{selectedRaw.status !== 'ingested' && (
									<Button
										size="sm"
										variant="default"
										disabled={isIngesting(selectedRaw.filename)}
										onClick={() => handleIngest(selectedRaw)}
									>
										{isIngesting(selectedRaw.filename) ? (
											<Loader2 className="size-3.5 mr-1 animate-spin" />
										) : (
											<Play className="size-3.5 mr-1" />
										)}
										{isIngesting(selectedRaw.filename) ? t('wiki.ingesting') : t('wiki.ingest')}
									</Button>
								)}
								{selectedRaw.status === 'ingested' && (
									<Button
										size="sm"
										variant="outline"
										disabled={isIngesting(selectedRaw.filename)}
										onClick={() => handleIngest(selectedRaw)}
									>
										{isIngesting(selectedRaw.filename) ? (
											<Loader2 className="size-3.5 mr-1 animate-spin" />
										) : (
											<Play className="size-3.5 mr-1" />
										)}
										{isIngesting(selectedRaw.filename) ? t('wiki.ingesting') : t('wiki.reingest')}
									</Button>
								)}
								<Button
									size="sm"
									variant="ghost"
									className="text-destructive"
									onClick={() => setDeleteRawTarget(selectedRaw)}
								>
									<Trash2 className="size-3.5 mr-1" />
									{t('wiki.deletePage')}
								</Button>
							</div>
						</div>
						{editingRaw ? (
							<div data-color-mode={document.documentElement.classList.contains('dark') ? 'dark' : 'light'}>
								<MDEditor
									value={rawContent}
									onChange={(val) => setRawContent(val ?? '')}
									height="calc(100vh - 220px)"
									preview="live"
									previewOptions={{ remarkPlugins: [remarkGfm] }}
								/>
							</div>
						) : (
							<div className="prose prose-sm dark:prose-invert max-w-none border rounded-lg p-4 bg-muted/30">
								<Markdown remarkPlugins={[remarkGfm]}>{selectedRawContent}</Markdown>
							</div>
						)}
					</div>
				)}

				{mode === 'meta' && metaFile === 'index' && (
					<div className="flex flex-col gap-4">
						<div className="flex items-center gap-2">
							<FileText className="size-5" />
							<h1 className="text-2xl font-bold">index.md</h1>
							<Button
								size="sm"
								variant="outline"
								className="ml-auto"
								disabled={rebuildingIndex}
								onClick={async () => {
									if (!selectedAgentId) return;
									setRebuildingIndex(true);
									try {
										const res = await wikiApi.rebuildIndex(selectedAgentId);
										setMetaContent(res.content);
										toast.success(t('wiki.rebuildIndexDone'));
									} catch { /* */ } finally { setRebuildingIndex(false); }
								}}
							>
								{rebuildingIndex ? (
									<Loader2 className="size-3.5 mr-1 animate-spin" />
								) : (
									<RefreshCw className="size-3.5 mr-1" />
								)}
								{t('wiki.rebuildIndex')}
							</Button>
						</div>
						<WikiViewer content={metaContent} allPages={pages} onNavigate={handleNavigate} />
					</div>
				)}

				{mode === 'meta' && metaFile === 'log' && (
					<div className="flex flex-col gap-4">
						<div className="flex items-center gap-2">
							<FileText className="size-5" />
							<h1 className="text-2xl font-bold">log.md</h1>
						</div>
						{logEntries.length > 0 ? (
							<div className="relative pl-6">
								{/* Timeline line */}
								<div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />
								{logEntries.map((entry, i) => {
									const opColor = entry.operation === 'ingest'
										? 'text-green-500'
										: entry.operation === 'lint'
											? 'text-yellow-500'
											: 'text-blue-500';
									return (
										<div key={i} className="relative pb-6 last:pb-0">
											{/* Timeline dot */}
											<Circle className={`absolute -left-[15px] top-1 size-3 fill-current ${opColor}`} />
											<div className="border rounded-lg p-4 bg-card">
												<div className="flex items-center gap-2 mb-2">
													<span className={`text-xs font-semibold uppercase px-2 py-0.5 rounded ${
														entry.operation === 'ingest'
															? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
															: entry.operation === 'lint'
																? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300'
																: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
													}`}>
														{entry.operation}
													</span>
													<span className="text-sm font-medium">{entry.source}</span>
													<span className="ml-auto text-xs text-muted-foreground">{entry.timestamp}</span>
												</div>
												{entry.details.length > 0 && (
													<ul className="text-sm text-muted-foreground space-y-0.5">
														{entry.details.map((d, j) => (
															<li key={j} className="flex gap-1.5">
																<span className="text-muted-foreground/50">·</span>
																<span>{d}</span>
															</li>
														))}
													</ul>
												)}
											</div>
										</div>
									);
								})}
							</div>
						) : (
							<div className="prose prose-sm dark:prose-invert max-w-none border rounded-lg p-4 bg-muted/30">
								<Markdown remarkPlugins={[remarkGfm]}>{metaContent}</Markdown>
							</div>
						)}
					</div>
				)}

				{/* Query */}
				{mode === 'query' && (
					<div className="flex flex-col gap-4 h-full">
						<div className="flex items-center gap-2">
							<MessageSquare className="size-5" />
							<h1 className="text-2xl font-bold">{t('wiki.queryTitle')}</h1>
						</div>
						<div className="flex gap-2">
							<Input
								value={queryInput}
								onChange={(e) => setQueryInput(e.target.value)}
								placeholder={t('wiki.queryPlaceholder')}
								className="flex-1"
								onKeyDown={(e) => {
									if (e.key === 'Enter' && queryInput.trim() && !querying) {
										(async () => {
											if (!selectedAgentId) return;
											setQuerying(true);
											try {
												const res = await wikiApi.query(selectedAgentId, queryInput.trim());
												setQueryResult(res);
												if (res.analysis_path) await fetchPages();
											} catch { /* */ } finally { setQuerying(false); }
										})();
									}
								}}
							/>
							<Button
								disabled={!queryInput.trim() || querying}
								onClick={async () => {
									if (!selectedAgentId || !queryInput.trim()) return;
									setQuerying(true);
									try {
										const res = await wikiApi.query(selectedAgentId, queryInput.trim());
										setQueryResult(res);
										if (res.analysis_path) await fetchPages();
									} catch { /* */ } finally { setQuerying(false); }
								}}
							>
								{querying ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
							</Button>
						</div>
						{querying && !queryResult && (
							<div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
								<Loader2 className="size-5 animate-spin" />
								<span>{t('wiki.queryLoading')}</span>
							</div>
						)}
						{queryResult && (
							<div className="flex flex-col gap-3 flex-1 overflow-y-auto">
								{queryResult.analysis_path && (
									<div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
										<CheckCircle2 className="size-4" />
										{t('wiki.querySaved', { path: queryResult.analysis_path })}
									</div>
								)}
								<div className="prose prose-sm dark:prose-invert max-w-none border rounded-lg p-4 bg-card">
									<Markdown remarkPlugins={[remarkGfm]}>{queryResult.answer}</Markdown>
								</div>
								{queryResult.sources.length > 0 && (
									<div className="text-xs text-muted-foreground">
										<span className="font-medium">{t('wiki.querySources')}:</span>{' '}
										{queryResult.sources.map((s, i) => (
											<span key={s}>
												{i > 0 && ', '}
												<button
													className="text-blue-500 hover:underline"
													onClick={() => {
														const page = pages.find((p) => p.path === s);
														if (page) handleSelectPage(page);
													}}
												>{s}</button>
											</span>
										))}
									</div>
								)}
							</div>
						)}
					</div>
				)}

				{/* Graph */}
				{mode === 'graph' && (
					<div className="flex flex-col gap-4 h-full">
						<div className="flex items-center gap-2">
							<Network className="size-5" />
							<h1 className="text-2xl font-bold">{t('wiki.graphTitle')}</h1>
							{graphData && (
								<span className="text-sm text-muted-foreground ml-2">
									{graphData.nodes.length} nodes · {graphData.edges.length} edges
								</span>
							)}
						</div>
						{loadingGraph && (
							<div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
								<Loader2 className="size-5 animate-spin" />
							</div>
						)}
						{graphData && !loadingGraph && (
							<div className="flex-1 border rounded-lg overflow-hidden bg-white dark:bg-zinc-950">
								<WikiGraph
									data={graphData}
									onSelectNode={(path) => {
										const page = pages.find((p) => p.path === path);
										if (page) handleSelectPage(page);
									}}
								/>
							</div>
						)}
					</div>
				)}

				{/* Lint */}
				{mode === 'lint' && (
					<div className="flex flex-col gap-4">
						<div className="flex items-center gap-2">
							<HeartPulse className="size-5" />
							<h1 className="text-2xl font-bold">{t('wiki.lintTitle')}</h1>
						</div>
						{linting && (
							<div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
								<Loader2 className="size-5 animate-spin" />
								<span>{t('wiki.lintLoading')}</span>
							</div>
						)}
						{lintResult && !linting && (
							<div className="flex flex-col gap-4">
								{/* Score */}
								<div className="flex items-center gap-4 border rounded-lg p-4">
									<div className={`text-4xl font-bold ${
										lintResult.score >= 80 ? 'text-green-500' :
										lintResult.score >= 50 ? 'text-yellow-500' : 'text-red-500'
									}`}>
										{lintResult.score}
									</div>
									<div>
										<div className="font-medium">{t('wiki.lintScore')}</div>
										<div className="text-sm text-muted-foreground">
											{lintResult.total_pages} {t('wiki.lintPages')}, {lintResult.total_issues} {t('wiki.lintIssues')}
										</div>
									</div>
									<div className="ml-auto flex items-center gap-2">
										{lintResult.total_issues > 0 && (
											<Button
												size="sm"
												variant="default"
												disabled={fixingLinks}
												onClick={async () => {
													if (!selectedAgentId) return;
													setFixingLinks(true);
													setFixLinksResult(null);
													try {
														const res = await wikiApi.fixLinks(selectedAgentId);
														setFixLinksResult(res);
														await fetchPages();
														const lr = await wikiApi.lint(selectedAgentId);
														setLintResult(lr);
													} catch { /* */ } finally { setFixingLinks(false); }
												}}
											>
												{fixingLinks ? (
													<Loader2 className="size-3.5 mr-1 animate-spin" />
												) : (
													<Wrench className="size-3.5 mr-1" />
												)}
												{fixingLinks ? t('wiki.fixingLinks') : t('wiki.fixLinks')}
											</Button>
										)}
										{lintResult.score >= 80 ? (
											<CheckCircle2 className="size-8 text-green-500" />
										) : (
											<AlertTriangle className="size-8 text-yellow-500" />
										)}
									</div>
								</div>

								{/* Fix result */}
								{fixLinksResult && (
									<div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
										<CheckCircle2 className="size-4 shrink-0" />
										{fixLinksResult.summary}
									</div>
								)}

								{/* Issues */}
								{lintResult.broken_links.length > 0 && (
									<div className="border rounded-lg p-4">
										<h3 className="font-medium text-sm mb-2 text-red-600 dark:text-red-400">
											{t('wiki.lintBrokenLinks')} ({lintResult.broken_links.length})
										</h3>
										<ul className="text-sm space-y-1">
											{lintResult.broken_links.map((bl, i) => (
												<li key={i} className="flex items-center gap-2">
													<AlertTriangle className="size-3 text-red-500 shrink-0" />
													<span className="text-muted-foreground">{bl.page}</span>
													<span>→</span>
													<span className="text-red-500">[[{bl.link}]]</span>
												</li>
											))}
										</ul>
									</div>
								)}

								{lintResult.orphans.length > 0 && (
									<div className="border rounded-lg p-4">
										<h3 className="font-medium text-sm mb-2 text-yellow-600 dark:text-yellow-400">
											{t('wiki.lintOrphans')} ({lintResult.orphans.length})
										</h3>
										<ul className="text-sm space-y-1">
											{lintResult.orphans.map((o) => (
												<li key={o} className="flex items-center gap-2">
													<span className="text-muted-foreground/50">·</span>
													<button
														className="text-blue-500 hover:underline"
														onClick={() => {
															const page = pages.find((p) => p.path === o);
															if (page) handleSelectPage(page);
														}}
													>{o}</button>
												</li>
											))}
										</ul>
									</div>
								)}

								{lintResult.missing_from_index.length > 0 && (
									<div className="border rounded-lg p-4">
										<h3 className="font-medium text-sm mb-2 text-orange-600 dark:text-orange-400">
											{t('wiki.lintMissingIndex')} ({lintResult.missing_from_index.length})
										</h3>
										<ul className="text-sm space-y-1">
											{lintResult.missing_from_index.map((m) => (
												<li key={m} className="flex items-center gap-2">
													<span className="text-muted-foreground/50">·</span>
													<span>{m}</span>
												</li>
											))}
										</ul>
									</div>
								)}

								{lintResult.no_sources.length > 0 && (
									<div className="border rounded-lg p-4">
										<h3 className="font-medium text-sm mb-2 text-muted-foreground">
											{t('wiki.lintNoSources')} ({lintResult.no_sources.length})
										</h3>
										<ul className="text-sm space-y-1">
											{lintResult.no_sources.map((n) => (
												<li key={n} className="flex items-center gap-2">
													<span className="text-muted-foreground/50">·</span>
													<span>{n}</span>
												</li>
											))}
										</ul>
									</div>
								)}

								{lintResult.total_issues === 0 && (
									<div className="flex items-center gap-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-4 py-3">
										<CheckCircle2 className="size-5" />
										<span>{t('wiki.lintAllGood')}</span>
									</div>
								)}
							</div>
						)}
					</div>
				)}

				{mode === 'view' && !selected && !selectedRaw && !metaFile && (
					<div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-4">
						<BookOpen className="size-12 opacity-30" />
						<p className="text-sm">{t('wiki.selectOrCreate')}</p>
						<p className="text-xs max-w-md text-center">
							{t('wiki.introText')}
						</p>
					</div>
				)}
			</div>

			{selectedAgentId && (
				<WikiConfigDialog open={configOpen} onOpenChange={setConfigOpen} agentId={selectedAgentId} />
			)}
			<DeleteDialog
				open={!!deleteTarget}
				onOpenChange={(open) => !open && setDeleteTarget(null)}
				onConfirm={handleDelete}
				title={t('common.deleteTitle', { entity: t('wiki.pageEntity'), name: deleteTarget?.title ?? '' })}
				description={t('wiki.deleteConfirm')}
			/>
			<DeleteDialog
				open={!!deleteRawTarget}
				onOpenChange={(open) => !open && setDeleteRawTarget(null)}
				onConfirm={handleDeleteRaw}
				title={t('common.deleteTitle', { entity: t('wiki.rawDocEntity'), name: deleteRawTarget?.filename ?? '' })}
				description={t('wiki.deleteRawConfirm')}
			/>
		</div>
	);
}
