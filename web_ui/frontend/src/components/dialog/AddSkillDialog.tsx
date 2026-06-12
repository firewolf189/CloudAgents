import { CircleAlert, Loader2, PlusCircle, Download, Upload } from 'lucide-react';
import { useState, useRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/i18n/useI18n';

interface AddSkillDialogProps {
	children: ReactNode;
	onInstall?: (source: string, skill?: string) => Promise<{ success: boolean; output: string; error: string | null }>;
	onUpload?: (file: File) => Promise<void>;
}

export function AddSkillDialog({ children, onInstall, onUpload }: AddSkillDialogProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const [source, setSource] = useState('');
	const [skillName, setSkillName] = useState('');
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [output, setOutput] = useState<string | null>(null);

	const handleInstall = async () => {
		if (!source.trim() || !onInstall) return;
		setLoading(true);
		setError(null);
		setOutput(null);

		let finalSource = source.trim();
		let finalSkill = skillName.trim() || undefined;

		// Smart parse: strip "npx skills add" prefix and known flags
		let cleaned = finalSource
			.replace(/^npx\s+(?:-y\s+)?skills\s+add\s+/i, '')
			.trim();

		// Extract --skill / -s value
		const skillLongMatch = cleaned.match(/\s+--skill\s+(\S+)/);
		if (skillLongMatch) {
			if (!finalSkill) finalSkill = skillLongMatch[1];
			cleaned = cleaned.replace(/\s+--skill\s+\S+/, '');
		}
		const skillShortMatch = cleaned.match(/\s+-s\s+(\S+)/);
		if (skillShortMatch) {
			if (!finalSkill) finalSkill = skillShortMatch[1];
			cleaned = cleaned.replace(/\s+-s\s+\S+/, '');
		}

		// Strip remaining flags: -g, -y, --global, --yes, --copy, --all, etc.
		cleaned = cleaned.replace(/\s+(?:--(?:global|yes|copy|all|full-depth)|(?:-[gya]))\b/g, '').trim();

		finalSource = cleaned;

		try {
			const res = await onInstall(finalSource, finalSkill);
			if (res.success) {
				setSource('');
				setSkillName('');
				setOpen(false);
			} else {
				setError(res.error ?? 'Installation failed');
				setOutput(res.output || null);
			}
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setLoading(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setError(null); setOutput(null); } }}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="!w-[500px] !max-w-[500px]">
				<DialogHeader>
					<DialogTitle>{t('dialog-skill-add.title')}</DialogTitle>
					<DialogDescription>{t('dialog-skill-add.description')}</DialogDescription>
				</DialogHeader>
				<Tabs defaultValue={onInstall ? 'install' : 'upload'}>
					<TabsList className="w-full">
						{onInstall && <TabsTrigger value="install">{t('dialog-skill-add.installTab')}</TabsTrigger>}
						<TabsTrigger value="upload">{t('dialog-skill-add.uploadTab')}</TabsTrigger>
					</TabsList>

					{onInstall && (
						<TabsContent value="install">
							<div className="flex flex-col gap-y-3">
								<div className="flex flex-col gap-y-1.5">
									<Label htmlFor="skill-source">{t('dialog-skill-add.sourceLabel')}</Label>
									<Input
										id="skill-source"
										placeholder={t('dialog-skill-add.sourcePlaceholder')}
										value={source}
										onChange={(e) => setSource(e.target.value)}
									/>
									<p className="text-xs text-muted-foreground">{t('dialog-skill-add.sourceHint')}</p>
								</div>
								<div className="flex flex-col gap-y-1.5">
									<Label htmlFor="skill-name">{t('dialog-skill-add.skillNameLabel')}</Label>
									<Input
										id="skill-name"
										placeholder={t('dialog-skill-add.skillNamePlaceholder')}
										value={skillName}
										onChange={(e) => setSkillName(e.target.value)}
									/>
									<p className="text-xs text-muted-foreground">{t('dialog-skill-add.skillNameHint')}</p>
								</div>
								{error && <p className="text-destructive text-sm">{error}</p>}
								{output && (
									<pre className="text-xs bg-muted p-2 rounded max-h-32 overflow-auto whitespace-pre-wrap">{output}</pre>
								)}
								<DialogFooter className="flex-col gap-2 sm:flex-col">
									{loading && (
										<p className="text-xs text-muted-foreground text-center">
											{t('dialog-skill-add.installWait')}
										</p>
									)}
									<div className="flex justify-end gap-2">
										<Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
											{t('common.cancel')}
										</Button>
										<Button onClick={handleInstall} disabled={loading || !source.trim()}>
											{loading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
											{loading ? t('dialog-skill-add.installing') : t('dialog-skill-add.install')}
										</Button>
									</div>
								</DialogFooter>
							</div>
						</TabsContent>
					)}

					<TabsContent value="upload">
						<div className="flex flex-col gap-y-3">
							<div className="flex flex-col gap-y-1.5">
								<Label>{t('dialog-skill-add.uploadLabel')}</Label>
								<input
									ref={fileInputRef}
									type="file"
									accept=".zip"
									className="hidden"
									onChange={(e) => {
										const file = e.target.files?.[0] ?? null;
										setSelectedFile(file);
										setError(null);
									}}
								/>
								<div
									className="flex items-center gap-2 border border-dashed rounded-md p-4 cursor-pointer hover:bg-muted/50 transition-colors"
									onClick={() => fileInputRef.current?.click()}
								>
									<Upload className="size-5 text-muted-foreground shrink-0" />
									<span className="text-sm text-muted-foreground truncate">
										{selectedFile ? selectedFile.name : t('dialog-skill-add.uploadPlaceholder')}
									</span>
								</div>
								<p className="text-xs text-muted-foreground">{t('dialog-skill-add.uploadHint')}</p>
							</div>
							{error && <p className="text-destructive text-sm">{error}</p>}
							<DialogFooter>
								<Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
									{t('common.cancel')}
								</Button>
								<Button
									onClick={async () => {
										if (!selectedFile || !onUpload) return;
										setLoading(true);
										setError(null);
										try {
											await onUpload(selectedFile);
											setSelectedFile(null);
											setOpen(false);
										} catch (e) {
											setError((e as Error).message);
										} finally {
											setLoading(false);
										}
									}}
									disabled={loading || !selectedFile}
								>
									{loading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
									{loading ? t('dialog-skill-add.uploading') : t('dialog-skill-add.upload')}
								</Button>
							</DialogFooter>
						</div>
					</TabsContent>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}
