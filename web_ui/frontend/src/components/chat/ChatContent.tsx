import type { ContentBlock, Msg, ToolCallBlock } from '@agentscope-ai/agentscope/message';
import { ArrowDown, ArrowUp } from 'lucide-react';
import React from 'react';
import { useRef, useEffect, useState, useCallback } from 'react';

import { EmptyMessage } from './Empty';
import type { Skill } from '@/api';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { TextInput } from '@/components/chat/TextInput.tsx';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatContentProps {
	msgs: Msg[];
	sending: boolean;
	disabled: boolean;
	onSend: (content: ContentBlock[]) => void;
	onCancel?: () => void;
	onUserConfirm: (
		toolCall: ToolCallBlock,
		confirm: boolean,
		replyId: string,
		rules?: ToolCallBlock['suggested_rules'],
	) => void;
	autoComplete?: (input: string) => string | null;
	className?: string;
	/** @see TextInputProps.allowedInputTypes */
	allowedInputTypes: string[];
	/** @see TextInputProps.fileProcessor */
	fileProcessor: (file: File) => Promise<ContentBlock | null>;
	skills?: Skill[];
	selectedSkill?: Skill | null;
	onSkillChange?: (skill: Skill | null) => void;
}

const ChatContentComponent: React.FC<ChatContentProps> = ({
	msgs,
	sending,
	disabled,
	onSend,
	onCancel,
	onUserConfirm,
	autoComplete,
	className,
	allowedInputTypes,
	fileProcessor,
	skills,
	selectedSkill,
	onSkillChange,
}) => {
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	const prevMsgCountRef = useRef<number>(0);
	const wasNearBottomRef = useRef<boolean>(true);
	const [showScrollTop, setShowScrollTop] = useState(false);
	const [showScrollBottom, setShowScrollBottom] = useState(false);

	const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
		if (!scrollAreaRef.current) return;
		scrollAreaRef.current.scrollTo({ top: scrollAreaRef.current.scrollHeight, behavior });
	}, []);

	const scrollToTop = useCallback(() => {
		if (!scrollAreaRef.current) return;
		scrollAreaRef.current.scrollTo({ top: 0, behavior: 'smooth' });
	}, []);

	// Scroll to bottom on initial load when messages arrive
	useEffect(() => {
		if (msgs.length > 0 && prevMsgCountRef.current === 0) {
			requestAnimationFrame(() => scrollToBottom('instant'));
		}
		prevMsgCountRef.current = msgs.length;
	}, [msgs, scrollToBottom]);

	// Auto-scroll to bottom on new messages / streaming, only if near bottom
	useEffect(() => {
		if (!wasNearBottomRef.current) return;
		if (msgs.length > 0 || sending) {
			scrollToBottom();
		}
	}, [msgs, sending, scrollToBottom]);

	// Track scroll position to show/hide buttons and detect near-bottom
	useEffect(() => {
		const scrollArea = scrollAreaRef.current;
		if (!scrollArea) return;

		const handleScroll = () => {
			const { scrollTop, scrollHeight, clientHeight } = scrollArea;
			const distFromBottom = scrollHeight - scrollTop - clientHeight;
			wasNearBottomRef.current = distFromBottom < 50;
			setShowScrollTop(scrollTop > 200);
			setShowScrollBottom(distFromBottom > 200);
		};

		scrollArea.addEventListener('scroll', handleScroll);
		return () => scrollArea.removeEventListener('scroll', handleScroll);
	}, []);

	return (
		<div className={cn('flex flex-col h-full w-full items-center px-4 py-3 gap-4', className)}>
			<div className="relative flex-1 w-full min-h-0">
				<div
					ref={scrollAreaRef}
					className="h-full w-full overflow-y-auto overflow-x-hidden no-scrollbar"
				>
					<div className="flex flex-col gap-4 w-full">
						{msgs.length > 0 ? (
							msgs.map((message) => (
								<MessageBubble
									key={message.id}
									message={message}
									onUserConfirm={onUserConfirm}
								/>
							))
						) : (
							<EmptyMessage />
						)}
					</div>
				</div>
				{showScrollTop && (
					<Button
						size="icon-xs"
						variant="outline"
						onClick={scrollToTop}
						className="absolute right-3 top-2 rounded-full shadow-md bg-background/90 backdrop-blur-sm z-10"
					>
						<ArrowUp className="size-3.5" />
					</Button>
				)}
				{showScrollBottom && (
					<Button
						size="icon-xs"
						variant="outline"
						onClick={() => scrollToBottom()}
						className="absolute right-3 bottom-2 rounded-full shadow-md bg-background/90 backdrop-blur-sm z-10"
					>
						<ArrowDown className="size-3.5" />
					</Button>
				)}
			</div>
			<TextInput
				className="min-w-full max-w-full w-full"
				onSend={onSend}
				disabled={disabled}
				streaming={sending}
				onCancel={onCancel}
				autoComplete={autoComplete}
				allowedInputTypes={allowedInputTypes}
				fileProcessor={fileProcessor}
				skills={skills}
				selectedSkill={selectedSkill}
				onSkillChange={onSkillChange}
			/>
		</div>
	);
};

export const ChatContent = React.memo(ChatContentComponent);
