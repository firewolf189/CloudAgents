import { CircleAlert, Loader2, Check, Pencil } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';

import type { MCPClient, MCPClientStatus, StdioMCPConfig, HttpMCPConfig } from '@/api/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldSet,
} from '@/components/ui/field';
import { InputGroup, InputGroupTextarea } from '@/components/ui/input-group';
import { useTranslation } from '@/i18n/useI18n';

type Status = 'idle' | 'loading' | 'success' | 'error';

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mcp: MCPClientStatus;
	onUpdate: (oldName: string, newMcp: MCPClient) => Promise<void>;
}

function mcpToJson(mcp: MCPClientStatus): string {
	const config: Record<string, unknown> = {};
	if (mcp.mcp_config.type === 'stdio_mcp') {
		const stdio = mcp.mcp_config as StdioMCPConfig;
		config.command = stdio.command;
		if (stdio.args) config.args = stdio.args;
		if (stdio.env) config.env = stdio.env;
		if (stdio.cwd) config.cwd = stdio.cwd;
	} else {
		const http = mcp.mcp_config as HttpMCPConfig;
		config.url = http.url;
		if (http.headers) config.headers = http.headers;
		if (http.timeout) config.timeout = http.timeout;
	}
	const obj = { mcpServers: { [mcp.name]: config } };
	return JSON.stringify(obj, null, 2);
}

function parseConfig(
	raw: string,
	t: (key: string, opts?: Record<string, string>) => string,
): MCPClient {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		throw new Error(t('dialog-mcp-create.parseError', { message: (e as Error).message }));
	}

	const obj = parsed as Record<string, unknown>;
	const servers = obj.mcpServers as Record<string, Record<string, unknown>> | undefined;
	if (!servers || typeof servers !== 'object') {
		throw new Error(t('dialog-mcp-create.missingMcpServers'));
	}

	const entries = Object.entries(servers);
	if (entries.length !== 1) {
		throw new Error(t('dialog-mcp-edit.exactlyOne'));
	}

	const [name, config] = entries[0];
	let mcp_config: StdioMCPConfig | HttpMCPConfig;
	if ('url' in config) {
		mcp_config = {
			type: 'http_mcp',
			url: config.url as string,
			headers: (config.headers as Record<string, string> | undefined) ?? null,
			timeout: (config.timeout as number | undefined) ?? null,
		};
	} else {
		mcp_config = {
			type: 'stdio_mcp',
			command: config.command as string,
			args: (config.args as string[] | undefined) ?? null,
			env: (config.env as Record<string, string> | undefined) ?? null,
			cwd: (config.cwd as string | undefined) ?? null,
		};
	}
	return { name, is_stateful: true, mcp_config };
}

export function EditMCPDialog({ open, onOpenChange, mcp, onUpdate }: Props) {
	const { t } = useTranslation();
	const [configValue, setConfigValue] = useState('');
	const [keepAlive, setKeepAlive] = useState(true);
	const [status, setStatus] = useState<Status>('idle');
	const [errorMsg, setErrorMsg] = useState('');

	useEffect(() => {
		if (open && mcp) {
			setConfigValue(mcpToJson(mcp));
			setKeepAlive(mcp.is_stateful);
			setStatus('idle');
			setErrorMsg('');
		}
	}, [open, mcp]);

	const handleSave = useCallback(async () => {
		setErrorMsg('');
		let newMcp: MCPClient;
		try {
			newMcp = parseConfig(configValue, t);
		} catch (e) {
			setErrorMsg((e as Error).message);
			setStatus('error');
			return;
		}

		newMcp.is_stateful = keepAlive;
		setStatus('loading');
		try {
			await onUpdate(mcp.name, newMcp);
			setStatus('success');
			setTimeout(() => onOpenChange(false), 1500);
		} catch (e) {
			const isApiError = e instanceof Error && e.name === 'ApiError';
			if (!isApiError) {
				setErrorMsg(e instanceof Error ? e.message : String(e));
			}
			setStatus('idle');
		}
	}, [configValue, keepAlive, t, mcp, onUpdate, onOpenChange]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="!w-[500px] !max-w-[500px]">
				<DialogHeader>
					<DialogTitle>{t('dialog-mcp-edit.title')}</DialogTitle>
					<DialogDescription>{t('dialog-mcp-edit.description')}</DialogDescription>
				</DialogHeader>
				<FieldSet>
					<FieldGroup>
						<Field>
							<FieldContent>
								<FieldLabel>{t('dialog-mcp-create.configLabel')}</FieldLabel>
							</FieldContent>
							<InputGroup>
								<InputGroupTextarea
									className="max-h-100"
									value={configValue}
									onChange={(e) => setConfigValue(e.target.value)}
								/>
							</InputGroup>
						</Field>
						<Field orientation="horizontal">
							<Checkbox
								id="mcp-edit-keep-alive"
								checked={keepAlive}
								onCheckedChange={(v) => setKeepAlive(v === true)}
							/>
							<FieldContent>
								<FieldLabel htmlFor="mcp-edit-keep-alive">
									{t('dialog-mcp-create.keepAlive')}
								</FieldLabel>
								<FieldDescription>
									{t('dialog-mcp-create.keepAliveDesc')}
								</FieldDescription>
							</FieldContent>
						</Field>
					</FieldGroup>
				</FieldSet>
				{errorMsg && (
					<Alert variant="destructive">
						<CircleAlert />
						<AlertDescription>{errorMsg}</AlertDescription>
					</Alert>
				)}
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						{t('common.cancel')}
					</Button>
					<Button
						onClick={handleSave}
						disabled={status === 'loading' || status === 'success'}
					>
						{status === 'loading' && <Loader2 className="size-3.5 animate-spin" />}
						{status === 'success' && <Check className="size-3.5" />}
						{status !== 'loading' && status !== 'success' && (
							<Pencil className="size-3.5" />
						)}
						{status === 'loading'
							? t('dialog-mcp-edit.saving')
							: status === 'success'
								? t('dialog-mcp-edit.saved')
								: t('common.save')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
