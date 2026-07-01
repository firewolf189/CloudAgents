import { client } from './client';
import type { WikiPageInfo, RawDocInfo, IngestResult, WikiConfig, WikiLogEntry, QueryResult, LintResult, FixLinksResult, GraphData } from './types';

export const wikiApi = {
	// Pages
	listPages: (agentId: string) =>
		client.get<WikiPageInfo[]>(`/wiki/${agentId}/pages`),
	getPage: (agentId: string, path: string) =>
		client.get<{ path: string; content: string }>(`/wiki/${agentId}/pages/${path}`),
	createPage: (agentId: string, path: string, content: string) =>
		client.post<{ path: string }>(`/wiki/${agentId}/pages`, { path, content }),
	updatePage: (agentId: string, path: string, content: string) =>
		client.put<{ path: string }>(`/wiki/${agentId}/pages/${path}`, { path, content }),
	deletePage: (agentId: string, path: string) =>
		client.delete(`/wiki/${agentId}/pages/${path}`),

	// Raw documents
	listRaws: (agentId: string) =>
		client.get<RawDocInfo[]>(`/wiki/${agentId}/raw`),
	getRaw: (agentId: string, filename: string) =>
		client.get<{ filename: string; content: string }>(`/wiki/${agentId}/raw/${filename}`),
	uploadRaw: (agentId: string, filename: string, content: string) =>
		client.post<RawDocInfo>(`/wiki/${agentId}/raw`, { filename, content }),
	updateRaw: (agentId: string, filename: string, content: string) =>
		client.put<{ filename: string }>(`/wiki/${agentId}/raw/${filename}`, { content }),
	deleteRaw: (agentId: string, filename: string) =>
		client.delete(`/wiki/${agentId}/raw/${filename}`),

	// Directories
	createDir: (agentId: string, path: string) =>
		client.post<{ path: string }>(`/wiki/${agentId}/dir`, { path }),
	deleteDir: (agentId: string, path: string) =>
		client.delete(`/wiki/${agentId}/dir/${path}`),

	// Index & Log
	getIndex: (agentId: string) =>
		client.get<{ content: string }>(`/wiki/${agentId}/index`),
	rebuildIndex: (agentId: string) =>
		client.post<{ content: string }>(`/wiki/${agentId}/rebuild-index`),
	getLog: (agentId: string) =>
		client.get<{ content: string; entries: WikiLogEntry[] }>(`/wiki/${agentId}/log`),

	// Config
	getConfig: (agentId: string) =>
		client.get<WikiConfig>(`/wiki/${agentId}/config`),
	updateConfig: (agentId: string, body: WikiConfig) =>
		client.put<WikiConfig>(`/wiki/${agentId}/config`, body),

	// Ingest
	ingest: (agentId: string, filename: string) =>
		client.post<IngestResult>(`/wiki/${agentId}/ingest/${filename}`),
	ingestAll: (agentId: string) =>
		client.post<IngestResult[]>(`/wiki/${agentId}/ingest-all`),
	ingestStatus: (agentId: string) =>
		client.get<string[]>(`/wiki/${agentId}/ingest-status`),

	// Query
	query: (agentId: string, question: string) =>
		client.post<QueryResult>(`/wiki/${agentId}/query`, { question }),

	// Lint
	lint: (agentId: string) =>
		client.get<LintResult>(`/wiki/${agentId}/lint`),

	// Graph
	graph: (agentId: string) =>
		client.get<GraphData>(`/wiki/${agentId}/graph`),

	// Fix broken links
	fixLinks: (agentId: string) =>
		client.post<FixLinksResult>(`/wiki/${agentId}/fix-links`),
};
