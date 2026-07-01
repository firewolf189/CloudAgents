import { useState, useEffect, type FC } from 'react';

import { wikiApi } from '@/api';
import type { ChatModelConfig, WikiConfig } from '@/api';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { LlmSelect } from '@/components/select/LlmSelect';
import { useTranslation } from '@/i18n/useI18n';

interface WikiConfigDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	agentId: string;
}

export const WikiConfigDialog: FC<WikiConfigDialogProps> = ({ open, onOpenChange, agentId }) => {
	const { t } = useTranslation();
	const [config, setConfig] = useState<WikiConfig | null>(null);
	const [modelConfig, setModelConfig] = useState<ChatModelConfig | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!open) return;
		wikiApi.getConfig(agentId).then((wikiConfig) => {
			setConfig(wikiConfig);
			setModelConfig(wikiConfig.chat_model_config ?? null);
		});
	}, [open, agentId]);

	const handleSave = async () => {
		setSaving(true);
		try {
			await wikiApi.updateConfig(agentId, {
				authorized_agents: [],
				chat_model_config: modelConfig,
			});
			onOpenChange(false);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t('wiki.config')}</DialogTitle>
					<DialogDescription>{t('wiki.configDesc')}</DialogDescription>
				</DialogHeader>

				{/* Model selector */}
				<div className="flex flex-col gap-1.5 py-2">
					<Label>{t('wiki.ingestModel')}</Label>
					<LlmSelect
						value={modelConfig}
						onChange={setModelConfig}
						placeholder={t('wiki.selectModel')}
					/>
					<p className="text-xs text-muted-foreground">{t('wiki.ingestModelDesc')}</p>
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						{t('common.cancel')}
					</Button>
					<Button onClick={handleSave} disabled={saving}>
						{t('common.save')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
