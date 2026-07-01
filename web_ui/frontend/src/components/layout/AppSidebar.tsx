import { BookOpen, BotMessageSquare, Calendars, Compass, KeyRound, Languages, LogOut, UserCog, Users } from 'lucide-react';
import { useOnborda } from 'onborda';
import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

import { CHAT_TOUR_NAME, EMPLOYEE_TOUR_NAME } from '@/components/tour/chatTourSteps';
import { SetCredentialsDialog } from '@/components/dialog/SetCredentialsDialog';
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useAuth } from '@/context/AuthContext';
import i18n from '@/i18n';
import { useTranslation } from '@/i18n/useI18n';

export function AppSidebar() {
	const navigate = useNavigate();
	const location = useLocation();
	const { t } = useTranslation();
	const { startOnborda } = useOnborda();
	const { isAdmin, user, logout } = useAuth();

	const [credDialogOpen, setCredDialogOpen] = useState(false);

	// Auto-prompt employees to set credentials on first login
	useEffect(() => {
		if (
			user &&
			user.role === 'user' &&
			user.has_credentials === false &&
			!sessionStorage.getItem('credentials_prompted')
		) {
			sessionStorage.setItem('credentials_prompted', '1');
			const timer = setTimeout(() => setCredDialogOpen(true), 1000);
			return () => clearTimeout(timer);
		}
	}, [user]);

	const handleStartTour = () => {
		const tourName = isAdmin ? CHAT_TOUR_NAME : EMPLOYEE_TOUR_NAME;
		if (!location.pathname.startsWith('/chat')) {
			sessionStorage.setItem('force_tour', '1');
			navigate('/chat');
		} else {
			startOnborda(tourName);
		}
	};

	const handleToggleLanguage = () => {
		const next = i18n.language.startsWith('zh') ? 'en' : 'zh';
		i18n.changeLanguage(next);
	};

	const handleLogout = () => {
		logout();
		window.location.reload();
	};

	return (
		<Sidebar collapsible="none" className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r">
			<SidebarHeader>
				<div className="flex items-center justify-center h-12 mt-2">
					<img src="/logo_white_touxiang.png" alt="Logo" className="size-8 rounded-lg" />
				</div>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							<SidebarMenuItem key={'chat'}>
								<SidebarMenuButton
									tooltip={{ children: t('common.chat'), hidden: false }}
									isActive={
										location.pathname === '/chat' ||
										location.pathname.startsWith('/chat/')
									}
									onClick={() => navigate('/chat')}
									className="px-2.5 md:px-2"
								>
									<BotMessageSquare />
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton
									tooltip={{ children: t('common.schedule'), hidden: false }}
									isActive={location.pathname === '/schedule'}
									onClick={() => navigate('/schedule')}
									className="px-2"
								>
									<Calendars />
								</SidebarMenuButton>
							</SidebarMenuItem>
							<SidebarMenuItem>
								<SidebarMenuButton
									tooltip={{ children: t('wiki.title'), hidden: false }}
									isActive={location.pathname === '/wiki'}
									onClick={() => navigate('/wiki')}
									className="px-2"
								>
									<BookOpen />
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
				{isAdmin && (
					<SidebarGroup>
						<SidebarGroupContent>
							<SidebarMenu>
								<SidebarMenuItem>
									<SidebarMenuButton
										tooltip={{ children: t('common.credential'), hidden: false }}
										isActive={location.pathname === '/credential'}
										onClick={() => navigate('/credential')}
										className="px-2"
									>
										<KeyRound />
									</SidebarMenuButton>
								</SidebarMenuItem>
								<SidebarMenuItem>
									<SidebarMenuButton
										tooltip={{ children: t('common.users'), hidden: false }}
										isActive={location.pathname === '/users'}
										onClick={() => navigate('/users')}
										className="px-2"
									>
										<Users />
									</SidebarMenuButton>
								</SidebarMenuItem>
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				)}
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip={{
								children: i18n.language.startsWith('zh')
									? t('common.switchToEn')
									: t('common.switchToZh'),
								hidden: false,
							}}
							onClick={handleToggleLanguage}
							className="px-2"
						>
							<Languages />
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip={{ children: t('common.setCredentials'), hidden: false }}
							onClick={() => setCredDialogOpen(true)}
							className="px-2"
						>
							<UserCog />
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip={{ children: t('tour.trigger'), hidden: false }}
							onClick={handleStartTour}
							className="px-2"
						>
							<Compass />
						</SidebarMenuButton>
					</SidebarMenuItem>
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip={{ children: `${user?.name ?? ''} — ${t('common.logout')}`, hidden: false }}
							onClick={handleLogout}
							className="px-2"
						>
							<LogOut />
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarFooter>
			<SetCredentialsDialog
				open={credDialogOpen}
				onOpenChange={setCredDialogOpen}
				guide={user?.role === 'user' && user?.has_credentials === false}
			/>
		</Sidebar>
	);
}
