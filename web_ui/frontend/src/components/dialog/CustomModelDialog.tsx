import { Loader2 } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

import { modelApi } from '@/api';
import type { ModelCard, CreateCustomModelRequest } from '@/api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/i18n/useI18n';

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	provider: string;
	/** When set, the dialog is in edit mode. */
	model?: ModelCard | null;
	onSaved?: () => void;
}

const INPUT_TYPE_OPTIONS = [
	{ value: 'text/plain', label: 'Text' },
	{ value: 'image/*', label: 'Image' },
	{ value: 'audio/*', label: 'Audio' },
	{ value: 'video/*', label: 'Video' },
	{ value: 'application/pdf', label: 'PDF' },
];

const OUTPUT_TYPE_OPTIONS = [
	{ value: 'text/plain', label: 'Text' },
	{ value: 'application/x-thinking', label: 'Thinking' },
	{ value: 'audio/*', label: 'Audio' },
];

export function CustomModelDialog({ open, onOpenChange, provider, model, onSaved }: Props) {
	const { t } = useTranslation();
	const isEdit = !!model?.is_custom;
	const isOverride = !!model && !model.is_custom;

	const [name, setName] = useState('');
	const [label, setLabel] = useState('');
	const [contextSize, setContextSize] = useState(32768);
	const [outputSize, setOutputSize] = useState(8192);
	const [inputTypes, setInputTypes] = useState<string[]>(['text/plain']);
	const [outputTypes, setOutputTypes] = useState<string[]>(['text/plain']);
	const [submitting, setSubmitting] = useState(false);

	useEffect(() => {
		if (!open) return;
		if (model) {
			setName(model.name);
			setLabel(model.label);
			setContextSize(model.context_size);
			setOutputSize(model.output_size);
			setInputTypes(model.input_types);
			setOutputTypes(model.output_types);
		} else {
			setName('');
			setLabel('');
			setContextSize(32768);
			setOutputSize(8192);
			setInputTypes(['text/plain']);
			setOutputTypes(['text/plain']);
		}
	}, [open, model]);

	const toggleType = useCallback(
		(list: string[], setList: (v: string[]) => void, value: string) => {
			setList(list.includes(value) ? list.filter((t) => t !== value) : [...list, value]);
		},
		[],
	);

	const handleSubmit = async () => {
		if (!name.trim() || !label.trim()) return;
		setSubmitting(true);
		try {
			if (isEdit && model?.id) {
				await modelApi.updateCustom(model.id, {
					name: name.trim(),
					label: label.trim(),
					context_size: contextSize,
					output_size: outputSize,
					input_types: inputTypes,
					output_types: outputTypes,
				});
			} else {
				if (isOverride && model) {
					await modelApi.hideBuiltin(provider, model.name);
				}
				const body: CreateCustomModelRequest = {
					provider,
					name: name.trim(),
					label: label.trim(),
					context_size: contextSize,
					output_size: outputSize,
					input_types: inputTypes,
					output_types: outputTypes,
				};
				await modelApi.createCustom(body);
			}
			onOpenChange(false);
			onSaved?.();
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						{isEdit
							? t('customModel.editTitle')
							: isOverride
								? t('customModel.overrideTitle')
								: t('customModel.createTitle')}
					</DialogTitle>
					<DialogDescription>
						{isEdit
							? t('customModel.editDescription')
							: isOverride
								? t('customModel.overrideDescription')
								: t('customModel.createDescription')}
					</DialogDescription>
				</DialogHeader>

				<FieldGroup>
					<Field>
						<FieldLabel>{t('customModel.name')}</FieldLabel>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. z-ai/glm-5.1"
						/>
						<p className="text-xs text-muted-foreground">
							{t('customModel.nameHint')}
						</p>
					</Field>

					<Field>
						<FieldLabel>{t('customModel.label')}</FieldLabel>
						<Input
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder="e.g. GLM 5.1"
						/>
						<p className="text-xs text-muted-foreground">
							{t('customModel.labelHint')}
						</p>
					</Field>

					<div className="grid grid-cols-2 gap-4">
						<Field>
							<FieldLabel>{t('credential.maxContext')}</FieldLabel>
							<Input
								type="number"
								value={contextSize}
								onChange={(e) => setContextSize(Number(e.target.value))}
								min={1}
							/>
						</Field>
						<Field>
							<FieldLabel>{t('credential.maxOutput')}</FieldLabel>
							<Input
								type="number"
								value={outputSize}
								onChange={(e) => setOutputSize(Number(e.target.value))}
								min={1}
							/>
						</Field>
					</div>

					<Field>
						<FieldLabel>{t('credential.inputTypes')}</FieldLabel>
						<div className="flex flex-wrap gap-3">
							{INPUT_TYPE_OPTIONS.map((opt) => (
								<label key={opt.value} className="flex items-center gap-1.5 text-sm">
									<Checkbox
										checked={inputTypes.includes(opt.value)}
										onCheckedChange={() =>
											toggleType(inputTypes, setInputTypes, opt.value)
										}
									/>
									{opt.label}
								</label>
							))}
						</div>
					</Field>

					<Field>
						<FieldLabel>{t('credential.outputTypes')}</FieldLabel>
						<div className="flex flex-wrap gap-3">
							{OUTPUT_TYPE_OPTIONS.map((opt) => (
								<label key={opt.value} className="flex items-center gap-1.5 text-sm">
									<Checkbox
										checked={outputTypes.includes(opt.value)}
										onCheckedChange={() =>
											toggleType(outputTypes, setOutputTypes, opt.value)
										}
									/>
									{opt.label}
								</label>
							))}
						</div>
					</Field>
				</FieldGroup>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t('common.cancel')}
					</Button>
					<Button onClick={handleSubmit} disabled={submitting || !name.trim() || !label.trim()}>
						{submitting && <Loader2 className="size-4 animate-spin" />}
						{isEdit ? t('common.save') : t('common.create')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
