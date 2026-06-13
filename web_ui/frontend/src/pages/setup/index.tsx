import { Languages } from 'lucide-react';
import { useState } from 'react';

import { authApi } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button.tsx';
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card.tsx';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import i18n from '@/i18n';
import { useTranslation } from '@/i18n/useI18n.ts';
import { cn } from '@/lib/utils.ts';

interface Props {
	onComplete: () => void;
	className?: string;
}

export const SetupPage = ({ onComplete, className }: Props) => {
	const { t } = useTranslation();
	const { login } = useAuth();
	const [url, setUrl] = useState(() => localStorage.getItem('server_url') ?? '');
	const [mode, setMode] = useState<'password' | 'token'>('password');

	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [employeeToken, setEmployeeToken] = useState('');
	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError('');

		if (!url) return;
		localStorage.setItem('server_url', url);

		setLoading(true);
		try {
			if (mode === 'password') {
				const res = await authApi.loginAdmin(username, password);
				localStorage.setItem('username', res.user_id);
				login(res.token, {
					user_id: res.user_id,
					role: res.role,
					name: res.name,
					has_credentials: true,
				});
			} else {
				const res = await authApi.loginToken(employeeToken);
				localStorage.setItem('username', res.user_id);
				login(res.token, {
					user_id: res.user_id,
					role: res.role,
					name: res.name,
					has_credentials: false,
				});
			}
			onComplete();
		} catch (err) {
			setError(err instanceof Error ? err.message : t('common.error'));
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="flex items-center justify-center h-full">
			<div className={cn('flex flex-col gap-6 w-full max-w-sm', className)}>
				<Card>
					<CardHeader>
						<CardTitle>{t('setup.title')}</CardTitle>
						<CardDescription>{t('setup.description')}</CardDescription>
					</CardHeader>
					<CardContent>
						<form onSubmit={handleSubmit}>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor="server-url-input">
										{t('setup.serverUrl')}
									</FieldLabel>
									<Input
										id="server-url-input"
										type="url"
										placeholder={t('setup.serverUrlPlaceholder')}
										value={url}
										onChange={(e) => setUrl(e.target.value)}
										required
									/>
								</Field>

								{/* Mode toggle */}
								<div className="flex gap-2">
									<Button
										type="button"
										size="sm"
										variant={mode === 'password' ? 'default' : 'outline'}
										className="flex-1"
										onClick={() => setMode('password')}
									>
										{t('setup.passwordLogin')}
									</Button>
									<Button
										type="button"
										size="sm"
										variant={mode === 'token' ? 'default' : 'outline'}
										className="flex-1"
										onClick={() => setMode('token')}
									>
										{t('setup.tokenLogin')}
									</Button>
								</div>

								{mode === 'password' ? (
									<>
										<Field>
											<FieldLabel htmlFor="username-input">
												{t('setup.username')}
											</FieldLabel>
											<Input
												id="username-input"
												type="text"
												placeholder={t('setup.usernamePlaceholder')}
												value={username}
												onChange={(e) => setUsername(e.target.value)}
												required
											/>
										</Field>
										<Field>
											<FieldLabel htmlFor="password-input">
												{t('setup.password')}
											</FieldLabel>
											<Input
												id="password-input"
												type="password"
												placeholder={t('setup.passwordPlaceholder')}
												value={password}
												onChange={(e) => setPassword(e.target.value)}
												required
											/>
										</Field>
									</>
								) : (
									<Field>
										<FieldLabel htmlFor="token-input">
											{t('setup.token')}
										</FieldLabel>
										<Input
											id="token-input"
											type="text"
											placeholder={t('setup.tokenPlaceholder')}
											value={employeeToken}
											onChange={(e) => setEmployeeToken(e.target.value)}
											required
										/>
									</Field>
								)}

								{error && (
									<p className="text-sm text-destructive">{error}</p>
								)}

								<Field>
									<Button type="submit" className="w-full" disabled={loading}>
										{loading ? t('common.loading') : t('setup.submit')}
									</Button>
								</Field>
							</FieldGroup>
						</form>
					</CardContent>
				</Card>
				<FieldDescription className="px-6 text-center">{t('setup.hint')}</FieldDescription>
				<div className="flex justify-center">
					<Button
						variant="ghost"
						size="sm"
						className="gap-1.5 text-muted-foreground"
						onClick={() => {
							const next = i18n.language.startsWith('zh') ? 'en' : 'zh';
							i18n.changeLanguage(next);
						}}
					>
						<Languages className="size-4" />
						{i18n.language.startsWith('zh') ? 'English' : '中文'}
					</Button>
				</div>
			</div>
		</div>
	);
};
