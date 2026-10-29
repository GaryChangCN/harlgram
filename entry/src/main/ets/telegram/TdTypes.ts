export interface TdType { '@type': string; }
export interface TdText extends TdType { text: string; }
export interface TdLocalFile {
  path: string; can_be_downloaded: boolean; is_downloading_active: boolean; is_downloading_completed: boolean;
}
export interface TdFile extends TdType { id: number; size: number; expected_size: number; local: TdLocalFile; }
export interface TdPhotoSize { type: string; photo: TdFile; width: number; height: number; }
export interface TdPhoto { sizes: TdPhotoSize[]; }
export interface TdProfilePhoto { small: TdFile; big?: TdFile; }
export interface TdContent extends TdType {
  text?: TdText; caption?: TdText; photo?: TdPhoto; has_spoiler?: boolean; is_secret?: boolean;
  show_caption_above_media?: boolean;
}
export interface TdMessageReply extends TdType {
  chat_id?: number; message_id?: number; quote?: { text: TdText } | null; content?: TdContent | null;
}
export interface TdMessageProperties extends TdType {
  can_be_replied: boolean; can_be_edited: boolean; can_be_deleted_only_for_self: boolean;
  can_be_deleted_for_all_users: boolean; can_be_forwarded: boolean; can_be_copied: boolean; can_be_saved: boolean;
}
export interface TdMessageTopic extends TdType {
  message_thread_id?: number; forum_topic_id?: number; direct_messages_chat_topic_id?: number; saved_messages_topic_id?: number;
}
export interface TdDraft extends TdType { date: number; content: TdContent; }
export interface TdPosition { list: TdType; order: string; is_pinned: boolean; }
export interface TdChatType extends TdType { user_id?: number; is_channel?: boolean; }
export interface TdNotification {
  '@type'?: string;
  mute_for: number; use_default_mute_for?: boolean;
  use_default_sound?: boolean; sound_id?: string;
  use_default_show_preview?: boolean; show_preview?: boolean;
  use_default_mute_stories?: boolean; mute_stories?: boolean;
  use_default_story_sound?: boolean; story_sound_id?: string;
  use_default_show_story_poster?: boolean; show_story_poster?: boolean;
  use_default_disable_pinned_message_notifications?: boolean; disable_pinned_message_notifications?: boolean;
  use_default_disable_mention_notifications?: boolean; disable_mention_notifications?: boolean;
}
export interface TdMessageSender extends TdType { user_id?: number; chat_id?: number; }
export interface TdMessage extends TdType {
  id: number; chat_id: number; date: number; is_outgoing: boolean;
  sender_id?: TdMessageSender;
  content: TdContent; sending_state?: TdType | null;
  edit_date?: number; reply_to?: TdMessageReply | null; topic_id?: TdMessageTopic | null;
}
export interface TdChat extends TdType {
  id: number; title: string; type: TdChatType; positions: TdPosition[];
  last_message?: TdMessage; unread_count: number; notification_settings: TdNotification;
  draft_message?: TdDraft | null;
  photo?: TdProfilePhoto | null;
}
export interface TdUser extends TdType {
  id: number; first_name: string; last_name: string; status: TdType; is_contact?: boolean;
  profile_photo?: TdProfilePhoto | null;
}
export interface TdAuthorization extends TdType {
  password_hint?: string; email_address_pattern?: string; link?: string;
}
export interface TdEvent extends TdType {
  new_content?: TdContent;
  '@extra'?: string; '@client_id'?: number;
  authorization_state?: TdAuthorization; state?: TdType;
  chat?: TdChat; user?: TdUser; message?: TdMessage;
  messages?: (TdMessage | null)[]; user_ids?: number[];
  chat_id?: number; user_id?: number; old_message_id?: number;
  message_ids?: number[]; is_permanent?: boolean;
  last_message?: TdMessage; positions?: TdPosition[]; position?: TdPosition;
  unread_count?: number; title?: string; notification_settings?: TdNotification;
  status?: TdType; content?: TdContent; message_id?: number;
  draft_message?: TdDraft | null; file?: TdFile;
  photo?: TdProfilePhoto | null;
  code?: number; message_text?: string;
  edit_date?: number;
}
export interface TelegramState { phase: string; error: string; connection: string; ready: boolean; submitting?: boolean; }
export interface TelegramHistoryState { loading: boolean; hasMore: boolean; loaded: boolean; error: string; }
export interface TelegramParameters { apiId: number; apiHash: string; databaseDirectory: string; filesDirectory: string; encryptionKey: string; }
export interface TdTransport { createClient(): number; send(clientId: number, request: string): void; receive(): string; }
