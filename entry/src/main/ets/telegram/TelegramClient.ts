import { ChatRepository } from '../data/ChatRepository';
import { ChatSummary, ChatMessage, Contact, MessagePermissions, MessageActionState, MessageActionKind } from '../model/ChatModels';
import { TdChat, TdMessage, TdUser, TdEvent, TdAuthorization, TdPosition, TdTransport, TelegramParameters, TelegramState, TelegramHistoryState, TdDraft, TdFile, TdPhotoSize, TdMessageProperties } from './TdTypes';

interface HistoryRequest { chatId: number; fromId: number; }
interface DraftState { text: string; version: number; savedVersion: number; }
interface DraftRequest { chatId: number; version: number; }
interface PendingSend { chatId: string; text: string; mediaPath?: string; }
interface ViewRequest { chatId: number; ids: string[]; }
interface MessageRef { chatId: string; messageId: string; }
interface ActionRequest { state: MessageActionState; text?: string; draftText?: string; draftVersion?: number; revoke?: boolean; }

/** Protocol state machine, independent of ArkUI and device APIs. */
export class TelegramClient {
  private clientId = 0;
  private sequence = 0;
  private current: TelegramState = { phase: 'idle', error: '', connection: '未连接', ready: false };
  private listener: ((state: TelegramState) => void) | undefined;
  private parameters: TelegramParameters | undefined;
  private chats = new Map<number, TdChat>();
  private users = new Map<number, TdUser>();
  private activeChat = 0;
  private openedChat = 0;
  private historyRequests = new Map<string, HistoryRequest>();
  private historyInFlight = new Set<number>();
  private oldestMessages = new Map<number, number>();
  private historyEnded = new Set<number>();
  private historyStalls = new Map<number, number>();
  private historyLoaded = new Set<number>();
  private historyErrors = new Map<number, string>();
  private viewedMessages = new Set<string>();
  private viewRequests = new Map<string, ViewRequest>();
  private chatListRequest = '';
  private chatListEnded = false;
  private localDrafts = new Map<number, DraftState>();
  private draftRequests = new Map<string, DraftRequest>();
  private draftInFlight = new Set<number>();
  private photoFiles = new Map<number, TdFile>();
  private photoDownloads = new Set<number>();
  private downloadRequests = new Map<string, number>();
  private readonly photoDownloadLimit = 20 * 1024 * 1024;
  private readonly avatarDownloadLimit = 512 * 1024;
  private requestedChats = new Set<number>();
  private privateChatRequests = new Map<string, number>();
  private readyInitialized = false;
  private selfUserId = 0;
  private meRequest = '';
  private foreground = true;
  private contactIds = new Set<number>();
  private pendingSends = new Map<string, PendingSend>();
  private pendingAuthRequest = '';
  private messageDetails = new Map<string, TdMessage>();
  private messagePermissions = new Map<string, MessagePermissions>();
  private propertyRequests = new Map<string, MessageRef>();
  private messageActions = new Map<string, ActionRequest>();
  private sendActionMessages = new Map<string, string>();
  // TDLib may emit completion before the send/forward response reaches its caller.
  private completedSendMessages = new Map<string, TdMessage>();

  constructor(private transport: TdTransport, private repository: ChatRepository) {}

  state(): TelegramState {
    return { phase: this.current.phase, error: this.current.error, connection: this.current.connection, ready: this.current.ready,
      submitting: this.pendingAuthRequest.length > 0 };
  }
  subscribe(listener: (state: TelegramState) => void): void { this.listener = listener; listener(this.state()); }
  unsubscribe(): void { this.listener = undefined; }
  private emit(): void { if (this.listener) { this.listener(this.state()); } }
  fail(message: string): void {
    if (this.current.phase === 'idle' || this.current.phase === 'starting') { this.current.phase = 'error'; }
    this.current.error = message;
    this.emit();
  }

  start(parameters: TelegramParameters): void {
    if (this.clientId !== 0) { this.fail('已有连接正在运行，请继续当前登录流程。'); return; }
    this.parameters = parameters;
    this.pendingAuthRequest = '';
    this.repository.useRemoteData();
    this.current = { phase: 'starting', error: '', connection: '连接中', ready: false };
    try {
      this.clientId = this.transport.createClient();
      // TDLib starts delivering the authorization state after its first request.
      this.request('getOption', { name: 'version' });
    } catch {
      this.current.phase = 'error';
      this.current.error = '无法启动 Telegram 协议引擎，请检查原生库是否已打包。';
    }
    this.emit();
  }

  private request(type: string, fields: Record<string, unknown> = {}, extra = ''): string {
    const key = extra || `${type}:${++this.sequence}`;
    const request: Record<string, unknown> = { '@type': type, '@extra': key };
    Object.keys(fields).forEach((name: string) => { request[name] = fields[name]; });
    try {
      this.transport.send(this.clientId, JSON.stringify(request));
      return key;
    } catch {
      this.fail('协议引擎无法提交请求，请稍后重试。');
      return '';
    }
  }

  setPhone(phone: string): void {
    if (this.current.phase !== 'phone' || this.pendingAuthRequest) { return; }
    const normalized = phone.replace(/[\s()-]/g, '');
    if (!/^\+[1-9]\d{5,14}$/.test(normalized)) { this.fail('请输入带国家区号的手机号，例如 +86…'); return; }
    this.current.error = '';
    this.pendingAuthRequest = this.request('setAuthenticationPhoneNumber', { phone_number: normalized, settings: { '@type': 'phoneNumberAuthenticationSettings', allow_flash_call: false, allow_missed_call: false, is_current_phone_number: false, allow_sms_retriever_api: false } });
    this.emit();
  }
  setCode(code: string): void {
    if (this.current.phase !== 'code' || this.pendingAuthRequest) { return; }
    // Telegram can send numeric codes, SMS words or SMS phrases.
    if (!code.trim() || code.trim().length > 256) { this.fail('请输入 Telegram 发给你的验证码（最多 256 个字符）。'); return; }
    this.current.error = '';
    this.pendingAuthRequest = this.request('checkAuthenticationCode', { code: code.trim() });
    this.emit();
  }
  setPassword(password: string): void {
    if (this.current.phase !== 'password' || this.pendingAuthRequest) { return; }
    if (!password) { this.fail('请输入两步验证密码。'); return; }
    this.current.error = '';
    this.pendingAuthRequest = this.request('checkAuthenticationPassword', { password: password });
    this.emit();
  }
  setEmail(email: string): void {
    if (this.current.phase !== 'email' || this.pendingAuthRequest) { return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { this.fail('请输入有效的邮箱地址。'); return; }
    this.current.error = '';
    this.pendingAuthRequest = this.request('setAuthenticationEmailAddress', { email_address: email.trim() });
    this.emit();
  }
  setEmailCode(code: string): void {
    if (this.current.phase !== 'emailCode' || this.pendingAuthRequest) { return; }
    if (!code.trim()) { this.fail('请输入邮箱验证码。'); return; }
    this.current.error = '';
    this.pendingAuthRequest = this.request('checkAuthenticationEmailCode', { code: { '@type': 'emailAddressAuthenticationCode', code: code.trim() } });
    this.emit();
  }

  /** The only receiver in this process. Bound work per frame and never wait on the UI thread. */
  drain(): void {
    if (this.clientId === 0) { return; }
    let changed = false;
    const started = Date.now();
    for (let index = 0; index < 64 && Date.now() - started < 12; index++) {
      let raw = '';
      try { raw = this.transport.receive(); } catch {
        this.pendingAuthRequest = '';
        this.current.error = '协议引擎接收失败，请重新启动应用。';
        changed = true;
        break;
      }
      if (!raw) { break; }
      try {
        const event = JSON.parse(raw) as TdEvent;
        if (event['@client_id'] && event['@client_id'] !== this.clientId) { continue; }
        this.handle(event);
        changed = true;
      } catch {
        this.current.error = '收到无法处理的协议数据，请重启客户端重试。';
        changed = true;
      }
    }
    if (changed) { this.emit(); }
  }

  private authorize(auth: TdAuthorization): void {
    this.pendingAuthRequest = '';
    this.current.error = '';
    const phase = auth['@type'];
    if (phase === 'authorizationStateWaitTdlibParameters') {
      const config = this.parameters;
      if (!config) { return; }
      this.request('setTdlibParameters', {
        use_test_dc: false, database_directory: config.databaseDirectory,
        files_directory: config.filesDirectory, database_encryption_key: config.encryptionKey,
        use_file_database: true, use_chat_info_database: true, use_message_database: true,
        use_secret_chats: false, api_id: config.apiId, api_hash: config.apiHash,
        system_language_code: 'zh', device_model: 'HarmonyOS NEXT', system_version: 'HarmonyOS',
        application_version: '0.1.0'
      });
    } else if (phase === 'authorizationStateWaitPhoneNumber') {
      this.current.phase = 'phone';
    } else if (phase === 'authorizationStateWaitCode') {
      this.current.phase = 'code';
    } else if (phase === 'authorizationStateWaitPassword') {
      this.current.phase = 'password';
    } else if (phase === 'authorizationStateWaitEmailAddress') {
      this.current.phase = 'email';
    } else if (phase === 'authorizationStateWaitEmailCode') {
      this.current.phase = 'emailCode';
    } else if (phase === 'authorizationStateReady') {
      this.current.phase = 'ready';
      this.current.ready = true;
      if (!this.readyInitialized) {
        this.readyInitialized = true;
        this.loadMoreChats();
        this.request('getContacts');
        this.meRequest = this.request('getMe');
      }
    } else if (phase === 'authorizationStateClosed') {
      this.current.phase = 'closed'; this.current.ready = false; this.current.connection = '连接已关闭';
      this.clientId = 0; this.readyInitialized = false; this.chats.clear(); this.users.clear();
      this.activeChat = 0; this.openedChat = 0; this.historyRequests.clear(); this.pendingSends.clear();
      this.requestedChats.clear(); this.privateChatRequests.clear(); this.contactIds.clear();
      this.historyInFlight.clear(); this.oldestMessages.clear(); this.historyEnded.clear(); this.historyStalls.clear();
      this.historyLoaded.clear(); this.historyErrors.clear(); this.resetViewedMessages();
      this.chatListRequest = ''; this.chatListEnded = false;
      this.localDrafts.clear(); this.draftRequests.clear(); this.draftInFlight.clear();
      this.photoFiles.clear(); this.photoDownloads.clear(); this.downloadRequests.clear();
      this.selfUserId = 0; this.meRequest = '';
      this.messageDetails.clear(); this.messagePermissions.clear(); this.propertyRequests.clear();
      this.messageActions.clear(); this.sendActionMessages.clear(); this.completedSendMessages.clear();
      this.repository.useRemoteData();
    } else if (phase === 'authorizationStateLoggingOut' || phase === 'authorizationStateClosing') {
      this.current.ready = false; this.current.phase = 'starting';
    } else {
      this.current.phase = 'unsupported';
      this.current.error = phase === 'authorizationStateWaitRegistration'
        ? '请先使用 Telegram 官方客户端注册账号，再在这里登录。'
        : phase === 'authorizationStateWaitOtherDeviceConfirmation'
          ? 'Telegram 要求在另一台已登录设备上确认本次登录，请前往该设备。'
          : 'Telegram 要求额外的授权步骤，当前版本尚未支持。请使用官方客户端完成后重试。';
    }
  }

  private handle(event: TdEvent): void {
    const type = event['@type'];
    const responseKey = event['@extra'] || '';
    if ((type === 'ok' || type === 'error') && responseKey === this.pendingAuthRequest) { this.pendingAuthRequest = ''; }
    if (this.handleMessageActionResponse(event, responseKey)) { return; }
    if (type === 'ok') {
      if (responseKey === this.chatListRequest) { this.chatListRequest = ''; }
      this.viewRequests.delete(responseKey);
      this.completeDraft(responseKey, true);
      return;
    }
    if (type === 'updateFile' && event.file) { this.updatePhoto(event.file); return; }
    if (type === 'file') {
      this.downloadRequests.delete(responseKey);
      this.updatePhoto(event as unknown as TdFile); return;
    }
    if (type === 'updateAuthorizationState' && event.authorization_state) { this.authorize(event.authorization_state); return; }
    if (type === 'updateConnectionState' && event.state) {
      const name = event.state['@type'];
      this.current.connection = name === 'connectionStateReady' ? '已连接' : name === 'connectionStateUpdating' ? '同步中' : name === 'connectionStateWaitingForNetwork' ? '等待网络' : '连接中';
      return;
    }
    if (type === 'error') {
      const extra = event['@extra'] || '';
      if (extra === this.chatListRequest) {
        this.chatListRequest = '';
        if (event.code === 404) { this.chatListEnded = true; return; }
      }
      const history = this.historyRequests.get(extra);
      if (history) { this.historyInFlight.delete(history.chatId); this.historyRequests.delete(extra); }
      this.completeDraft(extra, false);
      const download = this.downloadRequests.get(extra);
      if (download !== undefined) { this.photoDownloads.delete(download); this.downloadRequests.delete(extra); }
      const requestedChat = this.privateChatRequests.get(extra);
      if (requestedChat !== undefined) {
        this.privateChatRequests.delete(extra);
        this.requestedChats.delete(requestedChat);
      }
      const view = this.viewRequests.get(extra);
      if (view) {
        if (view.chatId === this.openedChat) { view.ids.forEach((id: string) => this.viewedMessages.delete(id)); }
        this.viewRequests.delete(extra);
      }
      if ((extra.startsWith('loadChats:') && event.code === 404) || extra.startsWith('viewMessages:')) { return; }
      const raw = JSON.parse(JSON.stringify(event)) as Record<string, unknown>;
      this.current.error = this.describeError(String(raw['message'] || ''), event.code || 0);
      if (!this.current.ready && this.current.phase === 'starting') {
        this.current.phase = extra.startsWith('setTdlibParameters:') && event.code === 401 &&
          String(raw['message'] || '').includes('Wrong database encryption key') ? 'storageRecovery' : 'error';
      }
      if (history) { this.historyErrors.set(history.chatId, this.current.error); }
      if (requestedChat !== undefined) { this.historyErrors.set(requestedChat, this.current.error); }
      const pending = this.pendingSends.get(extra);
      if (pending) {
        // Preserve a newer draft too: a failed request must never silently discard user text.
        const newer = this.repository.getDraft(pending.chatId);
        if (!newer && pending.text && !pending.mediaPath) { this.setDraft(pending.chatId, pending.text); }
        this.repository.upsertMessage({ id: `failed:${extra}`, chatId: pending.chatId, text: pending.text,
          time: this.time(Math.floor(Date.now() / 1000)), outgoing: true, status: 'failed',
          mediaKind: pending.mediaPath ? 'photo' : undefined, mediaPath: pending.mediaPath });
        this.pendingSends.delete(extra);
      }
      return;
    }
    if (type === 'updateNewChat' && event.chat) {
      this.chats.set(event.chat.id, event.chat); this.syncChat(event.chat);
      this.restoreRemoteDraft(event.chat.id, event.chat.draft_message); return;
    }
    if (type === 'chat') {
      const chat = event as unknown as TdChat;
      this.chats.set(chat.id, chat); this.syncChat(chat);
      this.restoreRemoteDraft(chat.id, chat.draft_message);
      const extra = event['@extra'] || '';
      const requestedChat = this.privateChatRequests.get(extra);
      if (requestedChat !== undefined) {
        this.privateChatRequests.delete(extra);
        this.requestedChats.delete(requestedChat);
        if (chat.id === requestedChat) { this.activateChat(chat.id); }
        else { this.fail('返回的会话与请求不一致，请重新打开联系人。'); }
      }
      return;
    }
    if (type === 'updateUser' && event.user) { this.syncUser(event.user); return; }
    if (type === 'user') {
      const user = event as unknown as TdUser;
      if (responseKey === this.meRequest) { this.selfUserId = user.id; }
      this.syncUser(user);
      return;
    }
    if (type === 'users' && event.user_ids) {
      event.user_ids.forEach((id: number) => { this.contactIds.add(id); this.request('getUser', { user_id: id }); }); return;
    }
    if (type === 'updateUserStatus' && event.user_id && event.status) {
      const user = this.users.get(event.user_id);
      if (user) { user.status = event.status; this.syncUser(user); }
      return;
    }
    if (type === 'messages' && event.messages) {
      const history = this.historyRequests.get(responseKey);
      if (history) {
        // Merge avoids losing new-message updates arriving while history was loading.
        const messages = event.messages.filter((message: TdMessage | null): message is TdMessage => !!message && message.chat_id === history.chatId);
        messages.forEach((message: TdMessage) => this.repository.upsertMessage(this.mapMessage(message)));
        const ids = messages.filter((message: TdMessage) => !message.sending_state && Number.isSafeInteger(message.id) && message.id > 0)
          .map((message: TdMessage) => message.id);
        if (ids.length > 0) {
          if (history.fromId === 0) { this.historyEnded.delete(history.chatId); }
          const oldest = Math.min(...ids);
          this.oldestMessages.set(history.chatId, Math.min(this.oldestMessages.get(history.chatId) || oldest, oldest));
          if (history.fromId > 0 && oldest >= history.fromId) {
            const stalls = (this.historyStalls.get(history.chatId) || 0) + 1;
            this.historyStalls.set(history.chatId, stalls);
            if (stalls >= 2) { this.historyEnded.add(history.chatId); }
          } else { this.historyStalls.delete(history.chatId); }
        } else if (event.messages.length === 0) { this.historyEnded.add(history.chatId); }
        this.historyRequests.delete(responseKey); this.historyInFlight.delete(history.chatId);
        this.historyLoaded.add(history.chatId); this.historyErrors.delete(history.chatId);
      }
      return;
    }
    if ((type === 'updateNewMessage' || type === 'updateMessageSendSucceeded' || type === 'updateMessageSendFailed') && event.message) {
      const message = this.mapMessage(event.message);
      if (type === 'updateMessageSendFailed') { message.status = 'failed'; }
      this.repository.upsertMessage(message, event.old_message_id ? String(event.old_message_id) : '');
      if (event.old_message_id && type !== 'updateNewMessage') {
        const oldKey = this.messageKey(String(event.message.chat_id), String(event.old_message_id));
        this.messageDetails.delete(oldKey); this.messagePermissions.delete(oldKey);
        this.completedSendMessages.set(oldKey, event.message);
        if (this.completedSendMessages.size > 128) { this.completedSendMessages.delete(this.completedSendMessages.keys().next().value as string); }
        const token = this.sendActionMessages.get(oldKey);
        if (token) { this.finishSendAction(token, event.message, type === 'updateMessageSendFailed'); }
      }
      return;
    }
    if (type === 'message') {
      this.pendingSends.delete(event['@extra'] || '');
      this.repository.upsertMessage(this.mapMessage(event as unknown as TdMessage)); return;
    }
    if (type === 'updateDeleteMessages' && event.chat_id && event.message_ids && event.is_permanent) {
      this.removeMessages(String(event.chat_id), event.message_ids.map((id: number) => String(id))); return;
    }
    if (type === 'updateMessageEdited' && event.chat_id && event.message_id) {
      const key = this.messageKey(String(event.chat_id), String(event.message_id));
      const detail = this.messageDetails.get(key);
      if (detail) { detail.edit_date = event.edit_date || 0; }
      const message = this.findMessage(String(event.chat_id), String(event.message_id));
      if (message) { this.repository.upsertMessage({ ...message, editDate: event.edit_date || 0 }); }
      return;
    }
    if (type === 'updateMessageContent' && event.chat_id && event.message_id && event.new_content) {
      const messages = this.repository.getMessages(String(event.chat_id));
      const message = messages.find((item: ChatMessage) => item.id === String(event.message_id));
      if (message) {
        const detail = this.messageDetails.get(this.messageKey(message.chatId, message.id));
        const updated = this.mapMessage({ ...detail, '@type': 'message', id: event.message_id, chat_id: event.chat_id,
          date: message.date || 0, is_outgoing: message.outgoing, content: event.new_content });
        updated.time = message.time;
        updated.status = message.status;
        updated.senderId = message.senderId;
        updated.senderName = message.senderName;
        updated.senderColor = message.senderColor;
        this.repository.upsertMessage(updated);
        this.refreshReplyPreviews(updated);
        this.invalidateMessageProperties(message.chatId, message.id, true);
      }
      return;
    }
    if (event.chat_id) {
      const chat = this.chats.get(event.chat_id);
      if (!chat) { return; }
      if (type === 'updateChatLastMessage') { chat.last_message = event.last_message; if (event.positions) { chat.positions = event.positions; } }
      if (type === 'updateChatPosition' && event.position) {
        chat.positions = chat.positions.filter((position: TdPosition) => position.list['@type'] !== event.position?.list['@type']);
        chat.positions.push(event.position);
      }
      if (type === 'updateChatReadInbox' && event.unread_count !== undefined) { chat.unread_count = event.unread_count; }
      if (type === 'updateChatTitle' && event.title) { chat.title = event.title; }
      if (type === 'updateChatPhoto') { chat.photo = event.photo; }
      if (type === 'updateChatNotificationSettings' && event.notification_settings) { chat.notification_settings = event.notification_settings; }
      if (type === 'updateChatDraftMessage') {
        chat.draft_message = event.draft_message;
        if (event.positions) { chat.positions = event.positions; }
      }
      this.syncChat(chat);
      if (type === 'updateChatDraftMessage') { this.restoreRemoteDraft(chat.id, event.draft_message); }
    }
  }

  private syncUser(user: TdUser): void {
    this.users.set(user.id, user);
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Telegram 用户';
    this.repository.updateSenderName(`user:${user.id}`, name, this.color(user.id));
    const online = user.status?.['@type'] === 'userStatusOnline';
    const isContact = user.is_contact || this.contactIds.has(user.id);
    const avatar = isContact || user.id === this.selfUserId ? this.avatar(user.profile_photo?.small) : undefined;
    const contact: Contact = { id: String(user.id), name: name, subtitle: online ? '在线' : '最近上线', avatar: name.slice(0, 1), color: this.color(user.id), online: online,
      avatarFileId: avatar?.id, avatarPath: avatar?.local.is_downloading_completed ? avatar.local.path : undefined };
    if (user.is_contact || this.contactIds.has(user.id)) { this.repository.upsertContact(contact); }
    this.chats.forEach((chat: TdChat) => { if (chat.type.user_id === user.id) { this.syncChat(chat); } });
  }

  private syncChat(chat: TdChat): void {
    this.repository.updateSenderName(`chat:${chat.id}`, chat.title, this.color(chat.id));
    const position = chat.positions?.find((item: TdPosition) => item.list['@type'] === 'chatListMain');
    if ((!position || position.order === '0') && chat.id !== this.activeChat) { this.repository.removeChat(String(chat.id)); return; }
    const saved = this.selfUserId > 0 && chat.type.user_id === this.selfUserId;
    const kind = saved ? 'saved' : chat.type['@type'] === 'chatTypePrivate' ? 'private' : chat.type.is_channel ? 'channel' : 'group';
    const user = chat.type.user_id ? this.users.get(chat.type.user_id) : undefined;
    const avatar = saved ? undefined : this.avatar(chat.photo?.small || user?.profile_photo?.small);
    const summary: ChatSummary = {
      id: String(chat.id), title: saved ? '收藏夹' : chat.title, subtitle: chat.last_message ? this.contentText(chat.last_message.content) : '暂无消息',
      avatar: saved ? '★' : chat.title.slice(0, 1), color: saved ? '#4098E6' : this.color(chat.id), kind: kind,
      time: chat.last_message ? this.time(chat.last_message.date) : '', unread: chat.unread_count || 0,
      pinned: position?.is_pinned || false, muted: (chat.notification_settings?.mute_for || 0) > 0,
      online: user?.status?.['@type'] === 'userStatusOnline', order: position?.order || '0',
      avatarFileId: avatar?.id, avatarPath: avatar?.local.is_downloading_completed ? avatar.local.path : undefined
    };
    const newlyVisible = !this.repository.getChats().some((item: ChatSummary) => item.id === summary.id);
    this.repository.upsertChat(summary);
    // updateNewChat can precede the first nonzero main-list position.
    if (newlyVisible) { this.restoreRemoteDraft(chat.id, chat.draft_message); }
  }

  private mapMessage(message: TdMessage): ChatMessage {
    this.messageDetails.set(this.messageKey(String(message.chat_id), String(message.id)), message);
    const mapped: ChatMessage = { id: String(message.id), chatId: String(message.chat_id), text: this.contentText(message.content),
      time: this.messageTime(message.date), date: message.date, outgoing: message.is_outgoing,
      status: !message.is_outgoing ? 'received' : message.sending_state?.['@type'] === 'messageSendingStateFailed' ? 'failed' : message.sending_state ? 'pending' : 'sent',
      contentKind: message.content['@type'] === 'messageText' ? 'text' : message.content['@type'] === 'messagePhoto' ? 'photo' : 'other',
      caption: message.content.caption?.text, editDate: message.edit_date || 0 };
    const sender = message.sender_id;
    if (sender?.['@type'] === 'messageSenderUser' && sender.user_id) {
      const user = this.users.get(sender.user_id);
      mapped.senderId = `user:${sender.user_id}`;
      mapped.senderName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Telegram 用户' : 'Telegram 用户';
      mapped.senderColor = this.color(sender.user_id);
    } else if (sender?.['@type'] === 'messageSenderChat' && sender.chat_id) {
      mapped.senderId = `chat:${sender.chat_id}`;
      mapped.senderName = this.chats.get(sender.chat_id)?.title || '频道';
      mapped.senderColor = this.color(sender.chat_id);
    }
    const reply = message.reply_to;
    if (reply?.['@type'] === 'messageReplyToMessage') {
      // A zero chat/message ID denotes an unknown origin; never replace it with this chat.
      if (reply.chat_id && Number.isSafeInteger(reply.chat_id)) { mapped.replyToChatId = String(reply.chat_id); }
      if (reply.message_id && Number.isSafeInteger(reply.message_id)) { mapped.replyToMessageId = String(reply.message_id); }
      const original = mapped.replyToChatId && mapped.replyToMessageId ? this.findMessage(mapped.replyToChatId, mapped.replyToMessageId) : undefined;
      mapped.replyPreview = reply.quote?.text.text || (original ? original.text : reply.content ? this.contentText(reply.content) : '回复消息');
      mapped.replySenderName = original?.senderName;
    }
    if (message.content['@type'] === 'messagePhoto' && !message.content.is_secret && !message.content.has_spoiler) {
      const sizes = (message.content.photo?.sizes || []).filter((size: TdPhotoSize) =>
        size.photo.size <= this.photoDownloadLimit && size.photo.expected_size <= this.photoDownloadLimit)
        .slice().sort((a: TdPhotoSize, b: TdPhotoSize) => b.width * b.height - a.width * a.height);
      const size = sizes[0];
      if (size) {
        const cached = this.photoFiles.get(size.photo.id);
        const file = cached || size.photo;
        this.photoFiles.set(file.id, file);
        mapped.mediaKind = 'photo'; mapped.mediaFileId = file.id;
        if (file.local.is_downloading_completed && file.local.path) { mapped.mediaPath = file.local.path; }
        if (this.activeChat === message.chat_id) { this.downloadPhoto(file.id); }
      }
    }
    return mapped;
  }

  private messageKey(chatId: string, messageId: string): string { return `${chatId}/${messageId}`; }
  private validMessageRef(chatId: string, messageId: string): boolean {
    return /^-?[1-9]\d*$/.test(chatId) && /^[1-9]\d*$/.test(messageId) &&
      Number.isSafeInteger(Number(chatId)) && Number.isSafeInteger(Number(messageId));
  }
  private findMessage(chatId: string, messageId: string): ChatMessage | undefined {
    return this.repository.getMessages(chatId).find((message: ChatMessage) => message.id === messageId);
  }
  private emptyPermissions(error: string = ''): MessagePermissions {
    return { loading: false, loaded: false, error: error, canReply: false, canEdit: false,
      canDeleteForSelf: false, canDeleteForAll: false, canForward: false, canCopy: false };
  }
  getMessagePermissions(chatId: string, messageId: string): MessagePermissions {
    return { ...(this.messagePermissions.get(this.messageKey(chatId, messageId)) || this.emptyPermissions()) };
  }
  private invalidateMessageProperties(chatId: string, messageId: string, refreshObserved: boolean = false): void {
    const key = this.messageKey(chatId, messageId);
    const observed = this.messagePermissions.has(key);
    this.messagePermissions.delete(key);
    // Invalidate request identities too. A late response predating the content update
    // must not restore capabilities (or an error) over this replacement query.
    this.propertyRequests.forEach((ref: MessageRef, request: string) => {
      if (ref.chatId === chatId && ref.messageId === messageId) { this.propertyRequests.delete(request); }
    });
    if (refreshObserved && observed) { this.loadMessageProperties(chatId, messageId); }
  }
  loadMessageProperties(chatId: string, messageId: string): void {
    const key = this.messageKey(chatId, messageId);
    if (!this.current.ready || !this.validMessageRef(chatId, messageId) || !this.findMessage(chatId, messageId)) {
      this.messagePermissions.set(key, this.emptyPermissions('消息尚未就绪或已删除。')); this.emit(); return;
    }
    if (this.getMessagePermissions(chatId, messageId).loading) { return; }
    const permissions = this.emptyPermissions(); permissions.loading = true;
    this.messagePermissions.set(key, permissions);
    const request = this.request('getMessageProperties', { chat_id: Number(chatId), message_id: Number(messageId) });
    if (request) { this.propertyRequests.set(request, { chatId: chatId, messageId: messageId }); }
    else { this.messagePermissions.set(key, this.emptyPermissions(this.current.error)); }
    this.emit();
  }
  getMessageAction(token: string): MessageActionState | undefined {
    const action = this.messageActions.get(token);
    return action ? { ...action.state } : undefined;
  }
  private actionAllowed(chatId: string, messageId: string, permission: keyof MessagePermissions): boolean {
    const capabilities = this.getMessagePermissions(chatId, messageId);
    if (!this.current.ready || !this.validMessageRef(chatId, messageId) || !this.findMessage(chatId, messageId)) { return false; }
    if (!capabilities.loaded || capabilities.loading) {
      if (!capabilities.loading) { this.loadMessageProperties(chatId, messageId); }
      this.fail('正在重新检查消息权限，请稍后重试。'); return false;
    }
    if (capabilities[permission] !== true) {
      this.fail('当前消息不允许此操作，请重新打开菜单检查。'); return false;
    }
    return true;
  }
  private startMessageAction(kind: MessageActionKind, chatId: string, messageId: string, type: string,
    fields: Record<string, unknown>, details: { text?: string; draftText?: string; draftVersion?: number; revoke?: boolean; targetChatId?: string } = {}): string {
    // Serializing each kind prevents repeated taps from duplicating a send or forwarding twice.
    let pendingCount = 0;
    for (const action of this.messageActions.values()) {
      if (action.state.status === 'pending') { pendingCount++; }
      if (action.state.status === 'pending' && action.state.kind === kind && action.state.chatId === chatId &&
        action.state.messageId === messageId) { return ''; }
    }
    if (pendingCount >= 32) { this.fail('尚有较多操作等待确认，请稍后重试。'); return ''; }
    // Retain enough recent results for the UI, without retaining every edited draft forever.
    this.messageActions.forEach((action: ActionRequest, token: string) => {
      if (this.messageActions.size >= 256 && action.state.status !== 'pending') { this.messageActions.delete(token); }
    });
    this.current.error = '';
    const token = this.request(type, fields);
    if (!token) { return ''; }
    this.messageActions.set(token, { state: { status: 'pending', error: '', kind: kind, chatId: chatId,
      messageId: messageId, targetChatId: details.targetChatId }, text: details.text, draftText: details.draftText,
      draftVersion: details.draftVersion, revoke: details.revoke });
    this.emit();
    return token;
  }
  sendReply(chatId: string, text: string, replyToMessageId: string): string {
    if (!text.trim() || text.length > 4096 || !this.actionAllowed(chatId, replyToMessageId, 'canReply')) { return ''; }
    const original = this.messageDetails.get(this.messageKey(chatId, replyToMessageId));
    if (!original || this.requestedChats.has(Number(chatId))) { return ''; }
    // Received Saved Messages topics describe grouping, not a send destination.
    // TDLib MessageTopic::get_send_message_topic explicitly rejects that variant;
    // the reply reference itself still belongs to the Saved Messages chat.
    const topic = original.topic_id?.['@type'] === 'messageTopicSavedMessages' ? null : original.topic_id || null;
    return this.startMessageAction('reply', chatId, replyToMessageId, 'sendMessage', {
      chat_id: Number(chatId), topic_id: topic,
      reply_to: { '@type': 'inputMessageReplyToMessage', message_id: Number(replyToMessageId), quote: null, checklist_task_id: 0, poll_option_id: '' },
      options: null, reply_markup: null,
      input_message_content: { '@type': 'inputMessageText', text: { '@type': 'formattedText', text: text, entities: [] }, clear_draft: false }
    }, { text: text, draftText: this.repository.getDraft(chatId), draftVersion: this.localDrafts.get(Number(chatId))?.version || 0 });
  }
  editMessage(chatId: string, messageId: string, text: string): string {
    if (!this.actionAllowed(chatId, messageId, 'canEdit')) { return ''; }
    const message = this.messageDetails.get(this.messageKey(chatId, messageId));
    if (!message) { return ''; }
    if (message.content['@type'] === 'messageText') {
      if (!text.trim() || text.length > 4096) { this.fail('正文须为 1–4096 个字符。'); return ''; }
      return this.startMessageAction('edit', chatId, messageId, 'editMessageText', {
        chat_id: Number(chatId), message_id: Number(messageId), reply_markup: null,
        input_message_content: { '@type': 'inputMessageText', text: { '@type': 'formattedText', text: text, entities: [] }, clear_draft: false }
      }, { text: text });
    }
    if (message.content['@type'] === 'messagePhoto') {
      if (text.length > 1024) { this.fail('图片说明最多 1024 个字符。'); return ''; }
      return this.startMessageAction('edit', chatId, messageId, 'editMessageCaption', {
        chat_id: Number(chatId), message_id: Number(messageId), reply_markup: null,
        caption: { '@type': 'formattedText', text: text, entities: [] }, show_caption_above_media: message.content.show_caption_above_media === true
      }, { text: text });
    }
    return '';
  }
  deleteMessage(chatId: string, messageId: string, revoke: boolean): string {
    if (typeof revoke !== 'boolean' || !this.actionAllowed(chatId, messageId, revoke ? 'canDeleteForAll' : 'canDeleteForSelf')) { return ''; }
    return this.startMessageAction('delete', chatId, messageId, 'deleteMessages', {
      chat_id: Number(chatId), message_ids: [Number(messageId)], revoke: revoke
    }, { revoke: revoke });
  }
  forwardMessage(fromChatId: string, messageId: string, toChatId: string): string {
    if (!this.actionAllowed(fromChatId, messageId, 'canForward')) { return ''; }
    const target = this.chats.get(Number(toChatId));
    if (!this.validMessageRef(toChatId, messageId) || !target || target.type['@type'] === 'chatTypeSecret') {
      this.fail('请选择已加载的普通会话。'); return '';
    }
    // chat.permissions describes non-admin permissions, not the current user's effective rights.
    // TDLib validates the destination; errors never insert a fake forwarded message.
    return this.startMessageAction('forward', fromChatId, messageId, 'forwardMessages', {
      chat_id: Number(toChatId), topic_id: null, from_chat_id: Number(fromChatId), message_ids: [Number(messageId)],
      options: null, send_copy: false, remove_caption: false
    }, { targetChatId: toChatId });
  }
  loadReplyTarget(chatId: string, messageId: string): string {
    if (!this.current.ready || !this.validMessageRef(chatId, messageId)) { return ''; }
    const original = this.messageDetails.get(this.messageKey(chatId, messageId));
    if (original?.reply_to?.['@type'] !== 'messageReplyToMessage') { return ''; }
    return this.startMessageAction('locate', chatId, messageId, 'getRepliedMessage', { chat_id: Number(chatId), message_id: Number(messageId) });
  }
  private handleMessageActionResponse(event: TdEvent, key: string): boolean {
    if (!key) { return false; }
    const type = event['@type'];
    const property = this.propertyRequests.get(key);
    if (property) {
      this.propertyRequests.delete(key);
      const storageKey = this.messageKey(property.chatId, property.messageId);
      if (!this.findMessage(property.chatId, property.messageId)) { this.messagePermissions.delete(storageKey); return true; }
      if (type !== 'messageProperties') {
        this.messagePermissions.set(storageKey, this.emptyPermissions('无法检查消息权限，请重试。')); return true;
      }
      const properties = event as unknown as TdMessageProperties;
      const content = this.messageDetails.get(storageKey)?.content['@type'];
      this.messagePermissions.set(storageKey, { loading: false, loaded: true, error: '',
        canReply: properties.can_be_replied === true,
        canEdit: properties.can_be_edited === true && (content === 'messageText' || content === 'messagePhoto'),
        canDeleteForSelf: properties.can_be_deleted_only_for_self === true,
        canDeleteForAll: properties.can_be_deleted_for_all_users === true,
        canForward: properties.can_be_forwarded === true,
        // can_be_copied is specifically for forwardMessages(send_copy=true), not clipboard text.
        canCopy: properties.can_be_saved === true });
      return true;
    }
    // Canceled property queries (including errors) are read-only obsolete results.
    // Consume them without reviving permissions or displaying a stale global error.
    if (key.startsWith('getMessageProperties:')) { return true; }
    const action = this.messageActions.get(key);
    if (!action || action.state.status !== 'pending') { return false; }
    if (type === 'error') {
      // Never surface TDLib's raw error text: it may include message content or request details.
      const error = action.state.kind === 'locate' ? '原消息无法加载，可能已删除或无权访问。'
        : `操作未成功（错误码 ${event.code || 0}），输入内容已保留。`;
      this.failMessageAction(key, error); return true;
    }
    if (action.state.kind === 'delete') {
      if (type === 'ok') {
        this.removeMessages(action.state.chatId, [action.state.messageId]);
        action.state.status = 'succeeded';
      } else { this.failMessageAction(key, '删除结果无法确认，请刷新后重试。'); }
      return true;
    }
    if (action.state.kind === 'forward') {
      const message = type === 'messages' && event.messages?.length === 1 ? event.messages[0] : null;
      if (!message || String(message.chat_id) !== action.state.targetChatId) {
        this.failMessageAction(key, '无法转发此消息，请检查目标会话权限。'); return true;
      }
      this.acceptSendAction(key, message); return true;
    }
    if (type !== 'message') { this.failMessageAction(key, '操作结果无法确认，请稍后重试。'); return true; }
    const message = event as unknown as TdMessage;
    if (!this.validMessageRef(String(message.chat_id), String(message.id))) {
      this.failMessageAction(key, '收到无效的消息结果，请稍后重试。'); return true;
    }
    if (action.state.kind === 'reply') {
      if (String(message.chat_id) !== action.state.chatId) { this.failMessageAction(key, '返回的会话与请求不一致。'); return true; }
      this.acceptSendAction(key, message); return true;
    }
    if (action.state.kind === 'edit' && (String(message.chat_id) !== action.state.chatId || String(message.id) !== action.state.messageId)) {
      this.failMessageAction(key, '返回的消息与编辑请求不一致，输入内容已保留。'); return true;
    }
    const mapped = this.mapMessage(message);
    this.repository.upsertMessage(mapped);
    this.refreshReplyPreviews(mapped);
    this.invalidateMessageProperties(mapped.chatId, mapped.id, true);
    if (action.state.kind === 'locate') {
      action.state.targetChatId = mapped.chatId; action.state.targetMessageId = mapped.id;
      const replying = this.findMessage(action.state.chatId, action.state.messageId);
      if (replying) {
        const detail = this.messageDetails.get(this.messageKey(replying.chatId, replying.id));
        if (detail?.reply_to) { detail.reply_to.chat_id = message.chat_id; detail.reply_to.message_id = message.id; }
        this.repository.upsertMessage({ ...replying, replyToChatId: mapped.chatId, replyToMessageId: mapped.id,
          replyPreview: detail?.reply_to?.quote?.text.text || mapped.text, replySenderName: mapped.senderName });
      }
    }
    action.state.status = 'succeeded';
    return true;
  }
  private acceptSendAction(token: string, message: TdMessage): void {
    const action = this.messageActions.get(token);
    if (!action) { return; }
    const key = this.messageKey(String(message.chat_id), String(message.id));
    const completed = this.completedSendMessages.get(key);
    if (completed) { this.finishSendAction(token, completed, completed.sending_state?.['@type'] === 'messageSendingStateFailed'); return; }
    this.repository.upsertMessage(this.mapMessage(message));
    if (message.sending_state?.['@type'] === 'messageSendingStatePending') {
      this.sendActionMessages.set(key, token);
      action.state.targetChatId = String(message.chat_id); action.state.targetMessageId = String(message.id);
    } else { this.finishSendAction(token, message, !!message.sending_state); }
  }
  private finishSendAction(token: string, message: TdMessage, failed: boolean): void {
    const action = this.messageActions.get(token);
    if (!action || action.state.status !== 'pending') { return; }
    this.sendActionMessages.forEach((value: string, key: string) => { if (value === token) { this.sendActionMessages.delete(key); } });
    if (failed) { this.failMessageAction(token, '消息未发送成功，输入内容已保留。'); return; }
    this.repository.upsertMessage(this.mapMessage(message));
    action.state.targetChatId = String(message.chat_id); action.state.targetMessageId = String(message.id);
    action.state.status = 'succeeded';
    if (action.state.kind === 'reply' && action.text === action.draftText &&
      this.repository.getDraft(action.state.chatId) === action.draftText &&
      (this.localDrafts.get(Number(action.state.chatId))?.version || 0) === action.draftVersion) {
      this.setDraft(action.state.chatId, '');
    }
  }
  private failMessageAction(token: string, error: string): void {
    const action = this.messageActions.get(token);
    if (!action) { return; }
    action.state.status = 'failed'; action.state.error = error;
    this.sendActionMessages.forEach((value: string, key: string) => { if (value === token) { this.sendActionMessages.delete(key); } });
    this.current.error = error;
  }
  private removeMessages(chatId: string, ids: string[]): void {
    this.repository.deleteMessages(chatId, ids);
    ids.forEach((id: string) => {
      const key = this.messageKey(chatId, id);
      this.messageDetails.delete(key); this.messagePermissions.delete(key);
      // A late property response must not revive capabilities for a deleted message.
      this.propertyRequests.forEach((ref: MessageRef, request: string) => {
        if (ref.chatId === chatId && ref.messageId === id) { this.propertyRequests.delete(request); }
      });
    });
  }
  private refreshReplyPreviews(original: ChatMessage): void {
    this.messageDetails.forEach((detail: TdMessage) => {
      if (String(detail.reply_to?.chat_id) !== original.chatId || String(detail.reply_to?.message_id) !== original.id) { return; }
      const replying = this.findMessage(String(detail.chat_id), String(detail.id));
      if (replying) { this.repository.upsertMessage({ ...replying,
        replyPreview: detail.reply_to?.quote?.text.text || original.text, replySenderName: original.senderName }); }
    });
  }
  private contentText(content: import('./TdTypes').TdContent): string {
    if (content.text?.text) { return content.text.text; }
    const type = content['@type'];
    const label = type === 'messagePhoto' ? '[图片]' : type === 'messageVideo' ? '[视频]' : type === 'messageVoiceNote' ? '[语音]' : type === 'messageSticker' ? '[贴纸]' : type === 'messageDocument' ? '[文件]' : type === 'messageAnimation' ? '[动画]' : type === 'messageCall' ? '[通话]' : type === 'messageLocation' ? '[位置]' : '[暂不支持的消息]';
    return content.caption?.text ? `${label} ${content.caption.text}` : label;
  }
  private time(seconds: number): string {
    const date = new Date(seconds * 1000);
    const now = new Date();
    return date.toDateString() === now.toDateString()
      ? `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
      : `${date.getMonth() + 1}/${date.getDate()}`;
  }
  private messageTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) { return ''; }
    const date = new Date(seconds * 1000);
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }
  private color(id: number): string { return ['#5A9BD5', '#A087C8', '#65AA9B', '#D49C68', '#C3829A'][Math.abs(id) % 5]; }

  private avatar(file: TdFile | undefined): TdFile | undefined {
    if (!file || file.size > this.avatarDownloadLimit || file.expected_size > this.avatarDownloadLimit) { return undefined; }
    const cached = this.photoFiles.get(file.id);
    const current = cached || file;
    this.photoFiles.set(file.id, current);
    this.downloadFile(file.id, this.avatarDownloadLimit);
    return current;
  }
  private downloadPhoto(fileId: number): void { this.downloadFile(fileId, this.photoDownloadLimit); }
  private downloadFile(fileId: number, limit: number): void {
    const file = this.photoFiles.get(fileId);
    if (!this.current.ready || !file || file.local.is_downloading_completed || file.local.is_downloading_active ||
      !file.local.can_be_downloaded || file.size > limit || file.expected_size > limit || this.photoDownloads.has(fileId)) { return; }
    const key = this.request('downloadFile', { file_id: fileId, priority: 16, offset: 0, limit: limit, synchronous: false });
    if (key) { this.photoDownloads.add(fileId); this.downloadRequests.set(key, fileId); }
  }
  private updatePhoto(file: TdFile): void {
    this.photoFiles.set(file.id, file);
    if (file.local.is_downloading_completed) {
      this.photoDownloads.delete(file.id);
      if (file.local.path && file.size <= this.photoDownloadLimit) { this.repository.updatePhotoFile(file.id, file.local.path); }
      if (file.local.path && file.size <= this.avatarDownloadLimit) { this.repository.updateAvatarFile(file.id, file.local.path); }
    } else {
      this.repository.updatePhotoFile(file.id, '');
      this.repository.updateAvatarFile(file.id, '');
      if (!file.local.is_downloading_active) { this.photoDownloads.delete(file.id); }
    }
  }

  loadMoreChats(): void {
    if (!this.current.ready || this.chatListEnded || this.chatListRequest) { return; }
    this.chatListRequest = this.request('loadChats', { chat_list: { '@type': 'chatListMain' }, limit: 100 });
  }
  getHistoryState(id: string): TelegramHistoryState {
    const chatId = Number(id);
    const valid = Number.isSafeInteger(chatId) && chatId !== 0;
    return { loading: valid && (this.historyInFlight.has(chatId) || this.requestedChats.has(chatId)),
      hasMore: valid && !this.historyEnded.has(chatId), loaded: valid && this.historyLoaded.has(chatId),
      error: valid ? this.historyErrors.get(chatId) || '' : '' };
  }
  loadOlderMessages(id: string): void {
    const chatId = Number(id);
    if (!this.current.ready || !Number.isSafeInteger(chatId) || chatId === 0 ||
      this.requestedChats.has(chatId) || this.historyEnded.has(chatId)) { return; }
    if (this.activeChat === chatId && this.openedChat !== chatId) { this.openChat(id); return; }
    if (!this.chats.has(chatId)) { return; }
    this.requestHistory(chatId, this.oldestMessages.get(chatId) || 0);
  }
  private requestHistory(chatId: number, fromId: number): void {
    if (this.historyInFlight.has(chatId)) { return; }
    this.historyErrors.delete(chatId);
    const key = this.request('getChatHistory', { chat_id: chatId, from_message_id: fromId, offset: 0, limit: 50, only_local: false });
    if (key) {
      this.historyRequests.set(key, { chatId: chatId, fromId: fromId });
      this.historyInFlight.add(chatId);
    } else { this.historyErrors.set(chatId, this.current.error); }
    this.emit();
  }

  setDraft(id: string, text: string): void {
    const chatId = Number(id);
    if (!this.current.ready || !Number.isSafeInteger(chatId) || chatId === 0 || text.length > 4096) { return; }
    this.repository.setDraft(id, text);
    const previous = this.localDrafts.get(chatId);
    if (!previous) {
      const remote = this.chats.get(chatId)?.draft_message;
      const remoteText = remote?.content['@type'] === 'draftMessageContentText' ? remote.content.text?.text || '' : '';
      // Navigation saves the composer even without edits. Do not replace the richer
      // server draft (reply, entities, preview options) just to save identical text.
      if (text === remoteText) { this.emit(); return; }
    }
    if (!previous || previous.text !== text) {
      this.localDrafts.set(chatId, { text: text, version: (previous?.version || 0) + 1, savedVersion: previous?.savedVersion || 0 });
    }
    this.flushDraft(chatId);
    this.emit();
  }
  private flushDraft(chatId: number): void {
    const draft = this.localDrafts.get(chatId);
    if (!this.current.ready || !draft || draft.version === draft.savedVersion || this.draftInFlight.has(chatId) ||
      this.requestedChats.has(chatId) || !this.chats.has(chatId)) { return; }
    const message = draft.text.length === 0 ? null : {
      '@type': 'draftMessage', reply_to: null, date: Math.floor(Date.now() / 1000), effect_id: '0', suggested_post_info: null,
      content: { '@type': 'draftMessageContentText', text: { '@type': 'formattedText', text: draft.text, entities: [] }, link_preview_options: null }
    };
    const key = this.request('setChatDraftMessage', { chat_id: chatId, topic_id: null, draft_message: message });
    if (key) { this.draftRequests.set(key, { chatId: chatId, version: draft.version }); this.draftInFlight.add(chatId); }
  }
  private completeDraft(key: string, success: boolean): void {
    const request = this.draftRequests.get(key);
    if (!request) { return; }
    this.draftRequests.delete(key); this.draftInFlight.delete(request.chatId);
    const current = this.localDrafts.get(request.chatId);
    if (current) {
      if (success) { current.savedVersion = request.version; }
      // A failed old version must not strand a newer edit. Retry that new version
      // once, but leave a failed current version pending until a user action retries.
      if (success || current.version > request.version) { this.flushDraft(request.chatId); }
    }
  }
  private restoreRemoteDraft(chatId: number, draft: TdDraft | null | undefined): void {
    // Local edits own this session. Even a late echo after Ok cannot replace newer typed text.
    // On the next client session TDLib's persisted draft becomes the initial source again.
    if (this.localDrafts.has(chatId)) { return; }
    if (!draft) { this.repository.setDraft(String(chatId), ''); }
    else if (draft.content['@type'] === 'draftMessageContentText') {
      this.repository.setDraft(String(chatId), draft.content.text?.text || '');
    }
  }

  openChat(id: string): void {
    if (!this.current.ready) { return; }
    const chatId = Number(id);
    if (!Number.isSafeInteger(chatId) || chatId === 0) { return; }
    if (this.openedChat && this.openedChat !== chatId) {
      this.request('closeChat', { chat_id: this.openedChat });
      this.openedChat = 0;
      this.resetViewedMessages();
    }
    this.activeChat = chatId;
    if (this.requestedChats.has(chatId)) { return; }
    if (!this.chats.has(chatId) && chatId > 0) { this.ensurePrivateChat(chatId); return; }
    this.activateChat(chatId);
  }
  private ensurePrivateChat(chatId: number): void {
    if (this.chats.has(chatId) || this.requestedChats.has(chatId)) { return; }
    this.historyErrors.delete(chatId);
    const key = this.request('createPrivateChat', { user_id: chatId, force: false });
    if (key) {
      this.requestedChats.add(chatId);
      this.privateChatRequests.set(key, chatId);
    } else { this.historyErrors.set(chatId, this.current.error); }
    this.emit();
  }
  private activateChat(chatId: number): void {
    if (!this.current.ready || this.activeChat !== chatId || this.openedChat === chatId) { return; }
    if (!this.request('openChat', { chat_id: chatId })) { return; }
    this.openedChat = chatId;
    this.requestHistory(chatId, 0);
    const chat = this.chats.get(chatId);
    if (chat) { this.restoreRemoteDraft(chatId, chat.draft_message); }
    this.flushDraft(chatId);
    this.repository.getMessages(String(chatId)).forEach((message: ChatMessage) => {
      if (message.mediaFileId) { this.downloadPhoto(message.mediaFileId); }
    });
  }
  /** Only the UI knows which messages have actually entered the viewport. */
  viewVisibleMessages(id: string, ids: string[]): void {
    const chatId = Number(id);
    if (this.activeChat !== chatId || this.openedChat !== chatId || !this.foreground || !this.current.ready) { return; }
    const received = new Set(this.repository.getMessages(id)
      .filter((message: ChatMessage) => !message.outgoing && message.status === 'received')
      .map((message: ChatMessage) => message.id));
    const visible = Array.from(new Set(ids)).filter((messageId: string) => {
      const value = Number(messageId);
      return Number.isSafeInteger(value) && value > 0 && received.has(messageId) && !this.viewedMessages.has(messageId);
    });
    if (visible.length === 0) { return; }
    const key = this.request('viewMessages', { chat_id: chatId, message_ids: visible.map((messageId: string) => Number(messageId)),
      source: { '@type': 'messageSourceChatHistory' }, force_read: false });
    if (key) {
      visible.forEach((messageId: string) => this.viewedMessages.add(messageId));
      this.viewRequests.set(key, { chatId: chatId, ids: visible });
    }
  }
  private resetViewedMessages(): void {
    this.viewedMessages.clear();
    this.viewRequests.clear();
  }
  leaveChat(): void {
    if (this.openedChat && this.current.ready) { this.request('closeChat', { chat_id: this.openedChat }); }
    this.activeChat = 0;
    this.openedChat = 0;
    this.resetViewedMessages();
  }
  setForeground(value: boolean): void {
    this.foreground = value;
    if (!value) { this.resetViewedMessages(); }
  }
  openContact(id: string): string {
    if (!this.current.ready) { return ''; }
    const user = this.users.get(Number(id));
    if (!user) { return ''; }
    this.repository.openContact(id);
    this.ensurePrivateChat(Number(id));
    return id;
  }
  getCurrentUser(): Contact | undefined {
    const user = this.users.get(this.selfUserId);
    if (!user) { return undefined; }
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Telegram';
    const file = user.profile_photo?.small;
    const latest = file ? (this.photoFiles.get(file.id) || file) : undefined;
    return { id: String(user.id), name: name, subtitle: '', avatar: name.slice(0, 1),
      color: this.color(user.id), online: false, avatarFileId: latest?.id,
      avatarPath: latest?.local.is_downloading_completed ? latest.local.path : undefined };
  }
  openSavedMessages(): string {
    if (!this.current.ready || this.selfUserId <= 0) { this.fail('账号信息正在加载，请稍后重试。'); return ''; }
    const id = String(this.selfUserId);
    if (!this.repository.getChats().some((chat: ChatSummary) => chat.id === id)) {
      this.repository.upsertChat({ id: id, title: '收藏夹', subtitle: '', avatar: '★', color: '#4098E6',
        kind: 'saved', time: '', unread: 0, pinned: false, muted: false, online: false });
    }
    this.ensurePrivateChat(this.selfUserId);
    return id;
  }
  sendMessage(id: string, text: string): boolean {
    if (!this.current.ready || !text.trim() || text.trim().length > 4096) { return false; }
    const chatId = Number(id);
    if (!Number.isSafeInteger(chatId) || chatId === 0) { return false; }
    if (this.requestedChats.has(chatId)) { this.fail('会话仍在加载，请稍后发送。'); return false; }
    this.current.error = '';
    const key = this.request('sendMessage', { chat_id: chatId, input_message_content: { '@type': 'inputMessageText', text: { '@type': 'formattedText', text: text.trim(), entities: [] }, clear_draft: true } });
    if (!key) { return false; }
    this.pendingSends.set(key, { chatId: id, text: text.trim() });
    this.setDraft(id, '');
    return true;
  }
  sendPhoto(id: string, path: string, caption: string = ''): boolean {
    const chatId = Number(id);
    if (!this.current.ready || !Number.isSafeInteger(chatId) || chatId === 0 || !path.startsWith('/') ||
      path.includes('\0') || caption.length > 1024) { return false; }
    if (this.requestedChats.has(chatId)) { this.fail('会话仍在加载，请稍后发送。'); return false; }
    this.current.error = '';
    const key = this.request('sendMessage', { chat_id: chatId, input_message_content: {
      '@type': 'inputMessagePhoto', photo: { '@type': 'inputPhoto', photo: { '@type': 'inputFileLocal', path: path },
        thumbnail: null, video: null, added_sticker_file_ids: [], width: 0, height: 0 },
      caption: { '@type': 'formattedText', text: caption, entities: [] },
      show_caption_above_media: false, self_destruct_type: null, has_spoiler: false
    } });
    if (!key) { return false; }
    this.pendingSends.set(key, { chatId: id, text: caption, mediaPath: path });
    return true;
  }
  togglePinned(id: string): void {
    const chat = this.repository.getChats().find((item: ChatSummary) => item.id === id);
    if (chat && this.current.ready) { this.request('toggleChatIsPinned', { chat_list: { '@type': 'chatListMain' }, chat_id: Number(id), is_pinned: !chat.pinned }); }
  }
  toggleMuted(id: string): void {
    const chat = this.repository.getChats().find((item: ChatSummary) => item.id === id);
    const remote = this.chats.get(Number(id));
    if (chat && remote && this.current.ready) {
      const settings = { ...remote.notification_settings, '@type': 'chatNotificationSettings',
        use_default_mute_for: false, mute_for: chat.muted ? 0 : 2147483647 };
      this.request('setChatNotificationSettings', { chat_id: Number(id), notification_settings: settings });
    }
  }
  logOut(): void { if (this.current.ready) { this.request('logOut'); } }
  close(): void { if (this.clientId) { this.request('close'); } }

  private describeError(message: string, code: number): string {
    if (code === 401 && message.includes('Wrong database encryption key')) {
      return '本机登录数据无法解锁。原有缓存会保留，请重新登录。';
    }
    if (message.includes('API_ID_INVALID') || message.includes('API_ID_PUBLISHED_FLOOD')) { return '应用 API 配置无效或测试身份受限，请在开发者配置中填写自己的 API ID / Hash。'; }
    if (message.includes('PHONE_NUMBER_INVALID')) { return '手机号格式不正确，请检查国家区号。'; }
    if (message.includes('PHONE_CODE_INVALID') || message.includes('CODE_INVALID')) { return '验证码不正确，请重新输入。'; }
    if (message.includes('PHONE_CODE_EXPIRED')) { return '验证码已过期，请重新发起登录。'; }
    if (message.includes('PASSWORD_HASH_INVALID')) { return '两步验证密码不正确。'; }
    if (message.includes('FLOOD') || code === 429) { return '操作过于频繁，请稍后再试。'; }
    if (message.includes('PHONE_NUMBER_BANNED')) { return 'Telegram 无法使用此号码登录，请通过官方客户端核实账号状态。'; }
    if (message.includes('CHAT_WRITE_FORBIDDEN')) { return '当前会话没有发送权限。'; }
    return `Telegram 请求未成功（错误码 ${code}），请检查网络或稍后重试。`;
  }
}
