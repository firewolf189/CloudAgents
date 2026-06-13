import { CheckCircle, CircleAlert, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

import { authApi } from '@/api';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/i18n/useI18n';

interface Props {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	guide?: boolean;
}

export function SetCredentialsDialog({ open, onOpenChange, guide }: Props) {
	const { t } = useTranslation();
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [confirmPassword, setConfirmPassword] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (open) {
			setUsername('');
			setPassword('');
			setConfirmPassword('');
			setError('');
		}
	}, [open]);

	const handleSubmit = async () => {
		setError('');
		if (!username.trim() || username.trim().length < 2) {
			setError(t('credentials.usernameMin'));
			return;
		}
		if (password.length < 4) {
			setError(t('credentials.passwordMin'));
			return;
		}
		if (password !== confirmPassword) {
			setError(t('credentials.passwordMismatch'));
			return;
		}

		setLoading(true);
		try {
			await authApi.setCredentials(username.trim(), password);
			toast.success(t('credentials.success'));
			onOpenChange(false);
		} catch (err) {
			const msg = err instanceof Error ? err.message : t('common.error');
			if (msg.includes('already taken') || msg.includes('409')) {
				setError(t('credentials.usernameTaken'));
			} else {
				setError(msg);
			}
		} finally {
			setLoading(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('credentials.title')}</DialogTitle>
					<DialogDescription>
						{guide ? t('credentials.guide') : t('credentials.description')}
					</DialogDescription>
				</DialogHeader>
				<FieldGroup>
					<Field>
						<FieldLabel>{t('credentials.username')}</FieldLabel>
						<Input
							value={username}
							onChange={(e) => setUsername(e.target.value)}
							placeholder={t('credentials.usernamePlaceholder')}
							autoFocus
						/>
					</Field>
					<Field>
						<FieldLabel>{t('credentials.password')}</FieldLabel>
						<Input
							type="password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
							placeholder={t('credentials.passwordPlaceholder')}
						/>
					</Field>
					<Field>
						<FieldLabel>{t('credentials.confirmPassword')}</FieldLabel>
						<Input
							type="password"
							value={confirmPassword}
							onChange={(e) => setConfirmPassword(e.target.value)}
							placeholder={t('credentials.confirmPasswordPlaceholder')}
							onKeyDown={(e) => {
								if (e.key === 'Enter') handleSubmit();
							}}
						/>
					</Field>
					{error && <p className="text-sm text-destructive">{error}</p>}
				</FieldGroup>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
						<CircleAlert className="size-3.5" />
						{t('common.cancel')}
					</Button>
					<Button onClick={handleSubmit} disabled={loading || !username.trim() || !password}>
						{loading ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<CheckCircle className="size-3.5" />
						)}
						{t('common.confirm')}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
