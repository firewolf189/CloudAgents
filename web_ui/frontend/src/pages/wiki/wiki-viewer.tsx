import { Calendar, FileText, List, Tag } from 'lucide-react';
import { useCallback, useMemo, type FC } from 'react';

import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { WikiPageInfo } from '@/api';
import { cn } from '@/lib/utils';

interface WikiViewerProps {
	content: string;
	allPages: WikiPageInfo[];
	onNavigate: (slug: string) => void;
}

interface Frontmatter {
	title?: string;
	tags?: string[];
	sources?: string[];
	created?: string;
	updated?: string;
	[key: string]: unknown;
}

function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
	const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
	if (!match) return { fm: {}, body: raw };

	const fm: Frontmatter = {};
	for (const line of match[1].split('\n')) {
		if (!line.includes(':')) continue;
		const [key, ...rest] = line.split(':');
		const k = key.trim();
		const v = rest.join(':').trim();
		if (v.startsWith('[') && v.endsWith(']')) {
			fm[k] = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
		} else {
			fm[k] = v;
		}
	}
	return { fm, body: match[2] };
}

const PropertyRow: FC<{ icon: React.ReactNode; label: string; children: React.ReactNode }> = ({ icon, label, children }) => (
	<div className="flex items-start gap-3 py-1.5">
		<div className="flex items-center gap-1.5 text-muted-foreground w-24 shrink-0 text-sm">
			{icon}
			<span>{label}</span>
		</div>
		<div className="flex-1 text-sm">{children}</div>
	</div>
);

export const WikiViewer: FC<WikiViewerProps> = ({ content, allPages, onNavigate }) => {
	const { fm, body } = useMemo(() => parseFrontmatter(content), [content]);

	const processContent = useCallback(
		(raw: string) => {
			return raw.replace(/\[\[([^\]]+)\]\]/g, (_match, linkText: string) => {
				const pipeIdx = linkText.indexOf('|');
				const target = pipeIdx >= 0 ? linkText.slice(0, pipeIdx).trim() : linkText.trim();
				const display = pipeIdx >= 0 ? linkText.slice(pipeIdx + 1).trim() : linkText.trim();
				return `[${display}](#wiki-link:${encodeURIComponent(target)})`;
			});
		},
		[],
	);

	const processed = useMemo(() => processContent(body), [body, processContent]);

	const hasFm = fm.title || fm.tags || fm.sources || fm.created || fm.updated;

	return (
		<div className="flex flex-col gap-4">
			{/* Frontmatter properties card */}
			{hasFm && (
				<div className="rounded-lg border bg-muted/30 px-4 py-3">
					{fm.title && (
						<PropertyRow icon={<List className="size-3.5" />} label="title">
							{fm.title}
						</PropertyRow>
					)}
					{fm.tags && Array.isArray(fm.tags) && fm.tags.length > 0 && (
						<PropertyRow icon={<Tag className="size-3.5" />} label="tags">
							<div className="flex flex-wrap gap-1.5">
								{fm.tags.map((tag) => (
									<span
										key={tag}
										className="inline-flex items-center rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2.5 py-0.5 text-xs"
									>
										{tag}
									</span>
								))}
							</div>
						</PropertyRow>
					)}
					{fm.sources && Array.isArray(fm.sources) && fm.sources.length > 0 && (
						<PropertyRow icon={<FileText className="size-3.5" />} label="sources">
							<div className="flex flex-wrap gap-1.5">
								{fm.sources.map((src) => (
									<span key={src} className="text-muted-foreground">{src}</span>
								))}
							</div>
						</PropertyRow>
					)}
					{fm.created && (
						<PropertyRow icon={<Calendar className="size-3.5" />} label="created">
							{fm.created}
						</PropertyRow>
					)}
					{fm.updated && (
						<PropertyRow icon={<Calendar className="size-3.5" />} label="updated">
							{fm.updated}
						</PropertyRow>
					)}
				</div>
			)}

			{/* Markdown body */}
			<div className="prose prose-sm dark:prose-invert max-w-none">
				<Markdown
					remarkPlugins={[remarkGfm]}
					components={{
						a: ({ href, children, ...props }) => {
							if (href?.startsWith('#wiki-link:')) {
								const linkText = decodeURIComponent(href.replace('#wiki-link:', ''));
								const normalized = linkText.startsWith('wiki/') ? linkText.slice(5) : linkText;
								return (
									<button
										type="button"
										className={cn(
											'text-blue-600 dark:text-blue-400 underline decoration-dotted hover:decoration-solid cursor-pointer bg-transparent border-none p-0 font-inherit',
											!allPages.some(
												(p) => p.path.includes(normalized.toLowerCase()) || p.title.toLowerCase() === normalized.toLowerCase(),
											) && 'text-red-500 dark:text-red-400',
										)}
										onClick={() => onNavigate(linkText)}
									>
										{children}
									</button>
								);
							}
							return (
								<a href={href} target="_blank" rel="noopener noreferrer" {...props}>
									{children}
								</a>
							);
						},
					}}
				>
					{processed}
				</Markdown>
			</div>
		</div>
	);
};
