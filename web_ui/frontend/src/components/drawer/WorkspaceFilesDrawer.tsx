import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';
import {
	ChevronRight,
	Code2,
	Eye,
	FileText,
	Folder,
	Home,
	Loader2,
	Pencil,
	Save,
	X,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FileEntry } from '@/api';
import { workspaceApi } from '@/api';
import { getBaseUrl, getUserId } from '@/api/client';
import { Button } from '@/components/ui/button';
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from '@/components/ui/drawer';

interface WorkspaceFilesDrawerProps {
	agentId: string | null;
	sessionId: string | null;
	children: ReactNode;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EXT_LANG_MAP: Record<string, string> = {
	py: 'python',
	js: 'javascript',
	ts: 'typescript',
	tsx: 'typescript',
	jsx: 'javascript',
	html: 'xml',
	htm: 'xml',
	css: 'css',
	json: 'json',
	md: 'markdown',
	yaml: 'yaml',
	yml: 'yaml',
	sh: 'bash',
	bash: 'bash',
	sql: 'sql',
	xml: 'xml',
	java: 'java',
	go: 'go',
	rs: 'rust',
	c: 'c',
	cpp: 'cpp',
	h: 'c',
	toml: 'ini',
	ini: 'ini',
	dockerfile: 'dockerfile',
};

const EXT_LABEL_MAP: Record<string, string> = {
	py: 'Python',
	js: 'JavaScript',
	ts: 'TypeScript',
	tsx: 'TSX',
	jsx: 'JSX',
	html: 'HTML',
	htm: 'HTML',
	css: 'CSS',
	json: 'JSON',
	md: 'Markdown',
	yaml: 'YAML',
	yml: 'YAML',
	sh: 'Shell',
	bash: 'Shell',
	sql: 'SQL',
	xml: 'XML',
	java: 'Java',
	go: 'Go',
	rs: 'Rust',
	c: 'C',
	cpp: 'C++',
	h: 'C Header',
	toml: 'TOML',
	ini: 'INI',
	txt: 'Text',
	log: 'Log',
	dockerfile: 'Dockerfile',
};

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']);
const HTML_EXTS = new Set(['html', 'htm']);

function getExt(filename: string): string {
	const lower = filename.toLowerCase();
	if (lower === 'dockerfile') return 'dockerfile';
	if (lower === 'makefile') return 'makefile';
	return filename.split('.').pop()?.toLowerCase() ?? '';
}

function isImageFile(filename: string): boolean {
	return IMAGE_EXTS.has(getExt(filename));
}

function isHtmlFile(filename: string): boolean {
	return HTML_EXTS.has(getExt(filename));
}

function getLangLabel(filename: string): string {
	const ext = getExt(filename);
	return EXT_LABEL_MAP[ext] ?? (ext.toUpperCase() || 'Text');
}

function getHljsLang(filename: string): string | undefined {
	return EXT_LANG_MAP[getExt(filename)];
}

function buildRawUrl(agentId: string, sessionId: string, path: string): string {
	const url = new URL('/workspace/file-raw', getBaseUrl());
	url.searchParams.set('agent_id', agentId);
	url.searchParams.set('session_id', sessionId);
	url.searchParams.set('path', path);
	url.searchParams.set('user_id', getUserId());
	return url.toString();
}

type ViewMode = 'preview' | 'code' | 'edit';

export function WorkspaceFilesDrawer({
	agentId,
	sessionId,
	children,
}: WorkspaceFilesDrawerProps) {
	const [open, setOpen] = useState(false);
	const [currentPath, setCurrentPath] = useState('');
	const [entries, setEntries] = useState<FileEntry[]>([]);
	const [loading, setLoading] = useState(false);

	const [selectedFile, setSelectedFile] = useState<string | null>(null);
	const [fileContent, setFileContent] = useState<string | null>(null);
	const [fileLoading, setFileLoading] = useState(false);
	const [fileError, setFileError] = useState<string | null>(null);

	const [viewMode, setViewMode] = useState<ViewMode>('code');
	const [editContent, setEditContent] = useState('');
	const [saving, setSaving] = useState(false);

	const codeRef = useRef<HTMLElement>(null);

	const fetchFiles = useCallback(
		async (path: string) => {
			if (!agentId || !sessionId) return;
			setLoading(true);
			try {
				const data = await workspaceApi.files.list(agentId, sessionId, path || undefined);
				setEntries(data);
			} catch {
				setEntries([]);
			} finally {
				setLoading(false);
			}
		},
		[agentId, sessionId],
	);

	useEffect(() => {
		if (open) {
			setCurrentPath('');
			setSelectedFile(null);
			setFileContent(null);
			setViewMode('code');
			fetchFiles('');
		}
	}, [open, fetchFiles]);

	const navigateTo = (path: string) => {
		setCurrentPath(path);
		setSelectedFile(null);
		setFileContent(null);
		setViewMode('code');
		fetchFiles(path);
	};

	const handleFileClick = async (fileName: string) => {
		if (!agentId || !sessionId) return;
		const filePath = currentPath ? `${currentPath}/${fileName}` : fileName;
		setSelectedFile(filePath);
		setFileContent(null);
		setFileError(null);
		setViewMode(isHtmlFile(fileName) ? 'preview' : 'code');

		if (isImageFile(fileName)) {
			setFileLoading(false);
			return;
		}

		setFileLoading(true);
		try {
			const data = await workspaceApi.files.read(agentId, sessionId, filePath);
			setFileContent(data.content);
			setEditContent(data.content);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Failed to load file';
			setFileError(msg);
		} finally {
			setFileLoading(false);
		}
	};

	const handleSave = async () => {
		if (!agentId || !sessionId || !selectedFile) return;
		setSaving(true);
		try {
			await workspaceApi.files.save(agentId, sessionId, selectedFile, editContent);
			setFileContent(editContent);
		} catch {
			// error toast could go here
		} finally {
			setSaving(false);
		}
	};

	// Syntax-highlighted HTML
	const highlightedHtml = useMemo(() => {
		if (!fileContent || !selectedFile) return '';
		const lang = getHljsLang(selectedFile.split('/').pop() ?? '');
		try {
			if (lang) {
				return hljs.highlight(fileContent, { language: lang }).value;
			}
			return hljs.highlightAuto(fileContent).value;
		} catch {
			return fileContent
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;');
		}
	}, [fileContent, selectedFile]);

	// Apply highlight when content or mode changes
	useEffect(() => {
		if (viewMode === 'code' && codeRef.current && highlightedHtml) {
			codeRef.current.innerHTML = highlightedHtml;
		}
	}, [viewMode, highlightedHtml]);

	const pathSegments = currentPath ? currentPath.split('/') : [];
	const selectedFileName = selectedFile?.split('/').pop() ?? '';
	const isImg = isImageFile(selectedFileName);
	const isHtml = isHtmlFile(selectedFileName);
	const isDirty = fileContent !== null && editContent !== fileContent;

	return (
		<Drawer direction="right" open={open} onOpenChange={setOpen}>
			<DrawerTrigger asChild>{children}</DrawerTrigger>
			<DrawerContent className={selectedFile ? 'sm:max-w-4xl!' : ''}>
				<DrawerHeader>
					<DrawerTitle>Workspace</DrawerTitle>
					<DrawerDescription>浏览 Agent 工作目录中的文件。</DrawerDescription>
				</DrawerHeader>
				<div className="flex flex-1 overflow-hidden">
					{/* Left: file list */}
					<div
						className={`flex flex-col overflow-hidden px-4 pb-4 gap-y-3 ${selectedFile ? 'w-72 shrink-0 border-r' : 'flex-1'}`}
					>
						{/* Breadcrumb */}
						<nav className="flex items-center gap-1 text-sm flex-wrap">
							<button
								type="button"
								onClick={() => navigateTo('')}
								className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors"
							>
								<Home className="size-3.5" />
							</button>
							{pathSegments.map((seg, i) => {
								const segPath = pathSegments.slice(0, i + 1).join('/');
								const isLast = i === pathSegments.length - 1;
								return (
									<span key={segPath} className="flex items-center gap-1">
										<ChevronRight className="size-3 text-muted-foreground" />
										{isLast ? (
											<span className="font-medium text-foreground">
												{seg}
											</span>
										) : (
											<button
												type="button"
												onClick={() => navigateTo(segPath)}
												className="text-muted-foreground hover:text-foreground transition-colors"
											>
												{seg}
											</button>
										)}
									</span>
								);
							})}
						</nav>

						{/* File list */}
						<div className="flex-1 overflow-y-auto no-scrollbar">
							{loading ? (
								<div className="flex items-center justify-center py-8">
									<Loader2 className="size-5 animate-spin text-muted-foreground" />
								</div>
							) : entries.length === 0 ? (
								<p className="text-muted-foreground text-sm text-center py-8">
									目录为空
								</p>
							) : (
								<ul className="space-y-0.5">
									{entries.map((entry) => {
										const entryPath = currentPath
											? `${currentPath}/${entry.name}`
											: entry.name;
										const isSelected =
											entry.type === 'file' &&
											selectedFile === entryPath;
										return (
											<li key={entry.name}>
												{entry.type === 'directory' ? (
													<button
														type="button"
														onClick={() => navigateTo(entryPath)}
														className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-accent transition-colors text-left"
													>
														<Folder className="size-4 text-blue-500 shrink-0" />
														<span className="truncate flex-1 text-sm">
															{entry.name}
														</span>
													</button>
												) : (
													<button
														type="button"
														onClick={() => handleFileClick(entry.name)}
														className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-md transition-colors text-left ${
															isSelected
																? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
																: 'hover:bg-accent'
														}`}
													>
														<FileText className="size-4 text-muted-foreground shrink-0" />
														<span className="truncate flex-1 text-sm">
															{entry.name}
														</span>
														<span className="text-xs text-muted-foreground shrink-0">
															{formatSize(entry.size)}
														</span>
													</button>
												)}
											</li>
										);
									})}
								</ul>
							)}
						</div>
					</div>

					{/* Right: file preview */}
					{selectedFile && (
						<div className="flex flex-col flex-1 min-w-0 overflow-hidden">
							{/* Preview header */}
							<div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
								<div className="flex items-center gap-2 min-w-0">
									<FileText className="size-4 text-muted-foreground shrink-0" />
									<span className="text-sm font-medium truncate">
										{selectedFileName}
									</span>
									<span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
										{getLangLabel(selectedFileName)}
									</span>
								</div>
								<div className="flex items-center gap-1 shrink-0">
									{/* Mode toggle buttons (not for images) */}
									{!isImg && (
										<>
											{isHtml && (
												<Button
													variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
													size="icon-xs"
													onClick={() => setViewMode('preview')}
													title="渲染预览"
												>
													<Eye className="size-3.5" />
												</Button>
											)}
											<Button
												variant={viewMode === 'code' ? 'secondary' : 'ghost'}
												size="icon-xs"
												onClick={() => setViewMode('code')}
												title="代码查看"
											>
												<Code2 className="size-3.5" />
											</Button>
											<Button
												variant={viewMode === 'edit' ? 'secondary' : 'ghost'}
												size="icon-xs"
												onClick={() => {
													setViewMode('edit');
													setEditContent(fileContent ?? '');
												}}
												title="编辑"
											>
												<Pencil className="size-3.5" />
											</Button>
											{viewMode === 'edit' && (
												<Button
													variant="default"
													size="sm"
													className="ml-1 gap-1"
													disabled={saving || !isDirty}
													onClick={handleSave}
												>
													<Save className="size-3.5" />
													{saving ? '保存中…' : '保存'}
												</Button>
											)}
										</>
									)}
									<Button
										variant="ghost"
										size="icon-xs"
										onClick={() => {
											setSelectedFile(null);
											setFileContent(null);
											setViewMode('code');
										}}
									>
										<X className="size-3.5" />
									</Button>
								</div>
							</div>

							{/* Preview content */}
							<div className="flex-1 overflow-auto">
								{fileLoading ? (
									<div className="flex items-center justify-center py-8">
										<Loader2 className="size-5 animate-spin text-muted-foreground" />
									</div>
								) : fileError ? (
									<p className="text-destructive text-sm text-center py-8">
										{fileError}
									</p>
								) : isImg && agentId && sessionId ? (
									<div className="flex items-center justify-center p-4">
										<img
											src={buildRawUrl(agentId, sessionId, selectedFile)}
											alt={selectedFileName}
											className="max-w-full max-h-[70vh] object-contain rounded"
										/>
									</div>
								) : viewMode === 'preview' && isHtml && agentId && sessionId ? (
									<iframe
										src={buildRawUrl(agentId, sessionId, selectedFile)}
										title={selectedFileName}
										className="w-full h-full border-0"
										sandbox="allow-scripts allow-same-origin"
									/>
								) : viewMode === 'edit' ? (
									<textarea
										className="w-full h-full p-4 font-mono text-xs leading-relaxed resize-none bg-background focus:outline-none"
										value={editContent}
										onChange={(e) => setEditContent(e.target.value)}
										spellCheck={false}
									/>
								) : fileContent !== null ? (
									<pre className="text-xs leading-relaxed font-mono whitespace-pre overflow-x-auto m-0 p-4">
										<code ref={codeRef} className="hljs" />
									</pre>
								) : null}
							</div>
						</div>
					)}
				</div>
			</DrawerContent>
		</Drawer>
	);
}
