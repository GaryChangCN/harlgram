import { ChatMessage } from './ChatModels';

export interface MediaAttachment {
  path: string;
  kind: 'photo' | 'video';
  width: number;
  height: number;
  duration: number;
  size: number;
}

export function mediaAlbumAt(messages: ChatMessage[], index: number): ChatMessage[] {
  const item = messages[index];
  if (!item || !item.mediaKind) { return []; }
  const id = item.mediaAlbumId;
  if (!id || id === '0') { return [item]; }
  let start = index, end = index + 1;
  const same = (candidate: ChatMessage): boolean => !!candidate.mediaKind && candidate.mediaAlbumId === id &&
    candidate.chatId === item.chatId && candidate.outgoing === item.outgoing;
  while (start > 0 && same(messages[start - 1])) { start--; }
  while (end < messages.length && same(messages[end])) { end++; }
  return start === index ? messages.slice(start, end) : [];
}

export function mediaTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total % 60).toString().padStart(2, '0')}`;
}
export function mediaBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) { return ''; }
  if (bytes >= 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`; }
  if (bytes >= 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
  return `${Math.ceil(bytes / 1024)} KB`;
}
