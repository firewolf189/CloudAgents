import { useState, type FC } from 'react';

import MDEditor from '@uiw/react-md-editor';
import remarkGfm from 'remark-gfm';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslation } from '@/i18n/useI18n';

interface WikiEditorProps {
	initialTitle?: string;
	initialContent?: string;
	initialTags?: string[];
	onSave: (title: string, content: string, tags: string[]) => void;
	onCancel: () => void;
}

export const WikiEditor: FC<WikiEditorProps> = ({
	initialTitle = '',
	initialContent = '',
	initialTags = [],
	onSave,
	onCancel,
}) => {
	const { t } = useTranslation();
	const [title, setTitle] = useState(initialTitle);
	const [content, setContent] = useState(initialContent);
	const [tagsInput, setTagsInput] = useState(initialTags.join(', '));

	const handleSave = () => {
		if (!title.trim()) return;
		const tags = tagsInput
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		onSave(title.trim(), content, tags);
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<Label>{t('wiki.pageTitle')}</Label>
				<Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('wiki.pageTitlePlaceholder')} autoFocus />
			</div>
			<div className="flex flex-col gap-1.5">
				<Label>Tags</Label>
				<Input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="tag1, tag2, ..." />
			</div>
			<div className="flex flex-col gap-1.5 flex-1" data-color-mode={document.documentElement.classList.contains('dark') ? 'dark' : 'light'}>
				<Label>{t('wiki.content')}</Label>
				<MDEditor
					value={content}
					onChange={(val) => setContent(val ?? '')}
					height="calc(100vh - 350px)"
					preview="live"
					previewOptions={{ remarkPlugins: [remarkGfm] }}
				/>
			</div>
			<div className="flex justify-end gap-2">
				<Button variant="ghost" onClick={onCancel}>
					{t('common.cancel')}
				</Button>
				<Button onClick={handleSave} disabled={!title.trim()}>
					{t('common.save')}
				</Button>
			</div>
		</div>
	);
};
