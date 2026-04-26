export class ChatHistoryItemDto {
  role: 'user' | 'assistant';
  content: string;
}

export class SendBotMessageDto {
  message: string;
  history: ChatHistoryItemDto[];
}
