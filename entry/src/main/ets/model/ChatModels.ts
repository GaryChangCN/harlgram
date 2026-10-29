export type ChatKind = 'private' | 'group' | 'channel' | 'saved';

export interface ChatSummary {
  id: string;
  title: string;
  subtitle: string;
  avatar: string;
  color: string;
  kind: ChatKind;
  time: string;
  unread: number;
  pinned: boolean;
  muted: boolean;
  online: boolean;
  order?: string;
  draft?: string;
  avatarPath?: string;
  avatarFileId?: number;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  text: string;
  time: string;
  outgoing: boolean;
  status: 'local' | 'received' | 'pending' | 'sent' | 'failed';
  date?: number;
  senderId?: string;
  senderName?: string;
  senderColor?: string;
  mediaPath?: string;
  mediaFileId?: number;
  mediaKind?: 'photo';
  contentKind?: 'text' | 'photo' | 'other';
  caption?: string;
  editDate?: number;
  replyToChatId?: string;
  replyToMessageId?: string;
  replyPreview?: string;
  replySenderName?: string;
}

export interface MessagePermissions {
  loading: boolean;
  loaded: boolean;
  error: string;
  canReply: boolean;
  canEdit: boolean;
  canDeleteForSelf: boolean;
  canDeleteForAll: boolean;
  canForward: boolean;
  canCopy: boolean;
}

export type MessageActionKind = 'reply' | 'edit' | 'delete' | 'forward' | 'locate';
export interface MessageActionState {
  status: 'pending' | 'succeeded' | 'failed';
  error: string;
  kind: MessageActionKind;
  chatId: string;
  messageId: string;
  targetChatId?: string;
  targetMessageId?: string;
}

export interface Contact {
  id: string;
  name: string;
  subtitle: string;
  avatar: string;
  color: string;
  online: boolean;
  avatarPath?: string;
  avatarFileId?: number;
}

export interface ChatDraft {
  chatId: string;
  text: string;
}

export interface ChatSnapshot {
  version: number;
  chats: ChatSummary[];
  messages: ChatMessage[];
  drafts: ChatDraft[];
  darkMode: boolean;
  sequence: number;
}
