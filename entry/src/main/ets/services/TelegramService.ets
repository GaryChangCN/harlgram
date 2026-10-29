import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { pasteboard } from '@kit.BasicServicesKit';
import nativeTdlib from 'libentry.so';
import { chatRepository } from '../data/ChatRepository';
import { TelegramClient } from '../telegram/TelegramClient';
import { TdTransport, TelegramState, TelegramParameters, TelegramHistoryState } from '../telegram/TdTypes';
import { CredentialVault, TelegramCredentials } from './CredentialVault';
import { AttachmentService } from './AttachmentService';
import { Contact, MessagePermissions, MessageActionState } from '../model/ChatModels';
import { sessionStorageDirectory } from '../model/SessionStorage';
import { TELEGRAM_API_ID, TELEGRAM_API_HASH } from '../config/TelegramBuildConfig';

export { TelegramState, TelegramHistoryState } from '../telegram/TdTypes';

class NativeTransport implements TdTransport {
  createClient(): number { return nativeTdlib.createClient(); }
  send(clientId: number, request: string): void { nativeTdlib.send(clientId, request); }
  receive(): string { return nativeTdlib.receive(); }
}

class TelegramService {
  private client: TelegramClient = new TelegramClient(new NativeTransport(), chatRepository);
  private timer: number = -1;
  private starting: boolean = false;
  private freshStorageRequested: boolean = false;

  state(): TelegramState { return this.client.state(); }
  subscribe(listener: (state: TelegramState) => void): void { this.client.subscribe(listener); }
  unsubscribe(): void { this.client.unsubscribe(); }

  async resume(context: common.UIAbilityContext): Promise<void> {
    if (this.state().phase !== 'idle') { return; }
    try {
      const credentials = await CredentialVault.load();
      if (credentials) { await this.connect(context, credentials); }
    } catch {
      this.client.fail('无法恢复登录，请重试。');
    }
  }

  async startDefault(context: common.UIAbilityContext): Promise<void> {
    if (TELEGRAM_API_ID <= 0 || !/^[a-fA-F0-9]{32}$/.test(TELEGRAM_API_HASH)) {
      this.client.fail('尚未配置应用 API 身份。请在本机 config/telegram.local.json 填写开发者配置并重新构建，或打开开发者配置。');
      throw new Error('应用尚未配置 API 身份');
    }
    await this.start(context, String(TELEGRAM_API_ID), TELEGRAM_API_HASH);
  }

  async start(context: common.UIAbilityContext, apiId: string, apiHash: string): Promise<void> {
    // Keep recovery intent across close -> closed and a failed Asset write, so retry stays isolated.
    if (this.state().phase === 'storageRecovery') { this.freshStorageRequested = true; }
    const id = Number(apiId);
    if (!Number.isSafeInteger(id) || id <= 0 || !/^[a-fA-F0-9]{32}$/.test(apiHash)) {
      this.client.fail('API ID 应为正整数，API Hash 应为 32 位十六进制字符。');
      throw new Error('API 配置格式不正确');
    }
    if (this.starting) { return; }
    this.starting = true;
    try {
      if ((this.timer >= 0 || this.freshStorageRequested) && this.state().phase !== 'closed' && this.state().phase !== 'idle') {
        this.client.close();
        for (let count = 0; count < 100 && this.state().phase !== 'closed'; count++) {
          if (this.timer < 0) { this.client.drain(); }
          await new Promise<void>((resolve: () => void) => { setTimeout(resolve, 50); });
        }
        if (this.state().phase !== 'closed') { throw new Error('正在关闭上一次连接，请稍后重试'); }
      }
      const credentials = await CredentialVault.save(id, apiHash, this.freshStorageRequested);
      this.freshStorageRequested = false;
      await this.connect(context, credentials);
    } finally { this.starting = false; }
  }

  private async connect(context: common.UIAbilityContext, credentials: TelegramCredentials): Promise<void> {
    if (nativeTdlib.getTdlibStatus() !== 'available') {
      this.client.fail('此安装包尚未包含可用的 TDLib 原生库，请先运行 build-tdlib.sh 并重新构建。');
      throw new Error('TDLib 原生库不可用');
    }
    const directory = sessionStorageDirectory(context.filesDir, credentials.databaseNamespace);
    if (!fileIo.accessSync(directory)) { fileIo.mkdirSync(directory, true); }
    const files = directory + '/files';
    if (!fileIo.accessSync(files)) { fileIo.mkdirSync(files, true); }
    const parameters: TelegramParameters = {
      apiId: credentials.apiId, apiHash: credentials.apiHash,
      databaseDirectory: directory, filesDirectory: files, encryptionKey: credentials.encryptionKey
    };
    this.client.start(parameters);
    if (this.timer < 0) {
      this.timer = setInterval(() => {
        try { this.client.drain(); } catch {
          this.client.fail('协议引擎运行异常，请重新启动应用。');
          clearInterval(this.timer);
          this.timer = -1;
        }
      }, 60);
    }
  }

  setPhone(phone: string): void { this.client.setPhone(phone); }
  setCode(code: string): void { this.client.setCode(code); }
  setPassword(password: string): void { this.client.setPassword(password); }
  setEmail(email: string): void { this.client.setEmail(email); }
  setEmailCode(code: string): void { this.client.setEmailCode(code); }
  openChat(id: string): void { this.client.openChat(id); }
  loadMoreChats(): void { this.client.loadMoreChats(); }
  loadOlderMessages(id: string): void { this.client.loadOlderMessages(id); }
  getHistoryState(id: string): TelegramHistoryState { return this.client.getHistoryState(id); }
  viewVisibleMessages(id: string, ids: string[]): void { this.client.viewVisibleMessages(id, ids); }
  setDraft(id: string, text: string): void { this.client.setDraft(id, text); }
  async pickImage(context: common.UIAbilityContext): Promise<string> { return AttachmentService.pickImage(context); }
  sendPhoto(id: string, path: string, caption: string): boolean { return this.client.sendPhoto(id, path, caption); }
  leaveChat(): void { this.client.leaveChat(); }
  setForeground(value: boolean): void { this.client.setForeground(value); }
  openContact(id: string): string { return this.client.openContact(id); }
  openSavedMessages(): string { return this.client.openSavedMessages(); }
  getCurrentUser(): Contact | undefined { return this.client.getCurrentUser(); }
  sendMessage(id: string, text: string): boolean { return this.client.sendMessage(id, text); }
  loadMessageProperties(chatId: string, messageId: string): void { this.client.loadMessageProperties(chatId, messageId); }
  getMessagePermissions(chatId: string, messageId: string): MessagePermissions {
    return this.client.getMessagePermissions(chatId, messageId);
  }
  getMessageAction(token: string): MessageActionState | undefined { return this.client.getMessageAction(token); }
  sendReply(chatId: string, text: string, replyToMessageId: string): string {
    return this.client.sendReply(chatId, text, replyToMessageId);
  }
  editMessage(chatId: string, messageId: string, text: string): string {
    return this.client.editMessage(chatId, messageId, text);
  }
  deleteMessage(chatId: string, messageId: string, revoke: boolean): string {
    return this.client.deleteMessage(chatId, messageId, revoke);
  }
  forwardMessage(fromChatId: string, messageId: string, toChatId: string): string {
    return this.client.forwardMessage(fromChatId, messageId, toChatId);
  }
  loadReplyTarget(chatId: string, messageId: string): string { return this.client.loadReplyTarget(chatId, messageId); }
  async copyText(text: string): Promise<void> {
    const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, text);
    const property = data.getProperty();
    property.shareOption = pasteboard.ShareOption.LOCALDEVICE;
    data.setProperty(property);
    await pasteboard.getSystemPasteboard().setData(data);
  }
  togglePinned(id: string): void { this.client.togglePinned(id); }
  toggleMuted(id: string): void { this.client.toggleMuted(id); }
  logOut(): void { this.client.logOut(); }
}

export const telegramService = new TelegramService();
