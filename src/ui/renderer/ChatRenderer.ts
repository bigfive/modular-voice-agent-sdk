import type { ToolDetailContent, ContentBlock, MessageData, ToolCallInfo } from '../types';

export const LINK_RE = /(https?:\/\/[^\s)>\]]+)|((?:[\w.-]+\/)+[\w.-]+\.[a-zA-Z0-9]+)/g;

function linkifyText(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let lastIndex = 0;
  for (const match of text.matchAll(LINK_RE)) {
    if (match.index! > lastIndex) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const anchor = document.createElement('a');
    anchor.className = 'chat-link';
    if (match[1]) {
      anchor.href = match[1];
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.textContent = match[1];
    } else {
      const filePath = match[2];
      anchor.href = `?file=${encodeURIComponent(filePath)}`;
      anchor.textContent = filePath;
    }
    frag.appendChild(anchor);
    lastIndex = match.index! + match[0].length;
  }
  if (lastIndex < text.length) {
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  return frag;
}

function createMessageDiv(roleClass: string, text: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = `chat-message chat-message--${roleClass}`;
  div.appendChild(linkifyText(text));
  return div;
}

const THINKING_CHEVRON_COLLAPSED = '▸';
const THINKING_CHEVRON_EXPANDED = '▾';

function createThinkingBlock(thinkingText: string): { wrapper: HTMLDivElement; contentEl: HTMLDivElement } {
  const wrapper = document.createElement('div');
  wrapper.className = 'chat-thinking chat-thinking--collapsed';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'chat-thinking-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  const chevronSpan = document.createElement('span');
  chevronSpan.className = 'chat-thinking-chevron';
  chevronSpan.setAttribute('aria-hidden', 'true');
  chevronSpan.textContent = THINKING_CHEVRON_COLLAPSED;
  toggle.appendChild(chevronSpan);
  toggle.appendChild(document.createTextNode(' thinking'));

  const body = document.createElement('div');
  body.className = 'chat-thinking-body';
  const contentEl = document.createElement('div');
  contentEl.className = 'chat-thinking-content';
  contentEl.textContent = thinkingText;
  contentEl.setAttribute('role', 'region');
  contentEl.setAttribute('aria-label', 'Thinking content');
  body.appendChild(contentEl);

  toggle.addEventListener('click', () => {
    const isExpanded = wrapper.classList.toggle('chat-thinking--expanded');
    wrapper.classList.toggle('chat-thinking--collapsed', !isExpanded);
    chevronSpan.textContent = isExpanded ? THINKING_CHEVRON_EXPANDED : THINKING_CHEVRON_COLLAPSED;
    toggle.setAttribute('aria-expanded', String(isExpanded));
  });

  wrapper.appendChild(toggle);
  wrapper.appendChild(body);
  return { wrapper, contentEl };
}

function getToolDescription(args: unknown): string | null {
  if (args && typeof args === 'object' && 'description' in args) {
    const d = (args as { description: unknown }).description;
    if (typeof d === 'string' && d.trim()) return d.trim();
  }
  return null;
}

function createToolDiv(text: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'chat-tool-message';
  div.textContent = text;
  return div;
}

function createToolSpinner(): HTMLElement {
  const span = document.createElement('span');
  span.className = 'chat-tool-spinner';
  span.setAttribute('aria-hidden', 'true');
  return span;
}

function formatTime(date: Date): string {
  return date
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase();
}

function createTimestamp(date: Date): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'chat-timestamp';
  span.textContent = formatTime(date);
  return span;
}

function wrapInMessageRow(side: 'user' | 'assistant', bubble: HTMLElement, timestamp?: Date): HTMLDivElement {
  const row = document.createElement('div');
  row.className = `chat-message-row chat-message-row--${side}`;
  if (timestamp) {
    const group = document.createElement('div');
    group.className = 'chat-message-group';
    group.appendChild(bubble);
    group.appendChild(createTimestamp(timestamp));
    row.appendChild(group);
  } else {
    row.appendChild(bubble);
  }
  return row;
}

export class ChatRenderer {
  private container: HTMLElement;
  private toolDivs = new Map<string, HTMLElement>();
  private toolCallData = new Map<string, ToolCallInfo>();
  private currentAssistantThinkingContent: HTMLDivElement | null = null;
  private currentAssistantText: HTMLElement | null = null;
  private currentAssistantTimestamp: Date | null = null;
  private scrollContainer: HTMLElement | null = null;
  private isFollowing = true;
  private onToolDetail: ((content: ToolDetailContent) => void) | null;

  constructor(options: { onToolDetail?: (content: ToolDetailContent) => void } = {}) {
    this.container = document.createElement('div');
    this.container.className = 'chat-renderer';
    this.onToolDetail = options.onToolDetail ?? null;
  }

  getContainer(): HTMLElement {
    return this.container;
  }

  attachTo(scrollContainer: HTMLElement): void {
    this.scrollContainer = scrollContainer;

    const handleScroll = () => {
      if (!this.scrollContainer) return;
      const threshold = 60;
      this.isFollowing = this.scrollContainer.scrollTop + this.scrollContainer.clientHeight >= this.scrollContainer.scrollHeight - threshold;
    };
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
  }

  detach(): void {
    this.scrollContainer = null;
  }

  clear(): void {
    this.container.innerHTML = '';
    this.toolDivs.clear();
    this.toolCallData.clear();
    this.currentAssistantThinkingContent = null;
    this.currentAssistantText = null;
    this.currentAssistantTimestamp = null;
  }

  renderMessages(messages: MessageData[]): void {
    for (const msg of messages) {
      this.renderMessage(msg);
    }
    this.scrollToBottom();
  }

  private renderMessage(msg: MessageData): void {
    const content = msg.content;
    const textParts = content.filter((c): c is { type: 'text'; text: string } => c.type === 'text');
    const thinkingParts = content.filter((c): c is { type: 'thinking'; thinking: string } => c.type === 'thinking');
    const toolCalls = content.filter((c): c is { type: 'toolCall'; id: string; name: string; arguments?: unknown } => c.type === 'toolCall');
    const toolResults = content.filter((c): c is { type: 'toolResult'; toolCallId: string; result?: unknown; isError?: boolean } => c.type === 'toolResult');

    const text = textParts.map((p) => p.text).join('').trim();
    const thinking = thinkingParts.map((p) => p.thinking).join('').trim();
    const timestamp = msg.timestamp ?? new Date();

    for (const toolCall of toolCalls) {
      this.renderToolExecutionStart(toolCall.name, toolCall.arguments, toolCall.id);
    }

    for (const toolResult of toolResults) {
      this.renderToolExecutionEnd(toolResult.toolCallId, toolResult.result, toolResult.isError);
    }

    if (thinking && msg.role === 'assistant') {
      const { wrapper, contentEl } = createThinkingBlock(thinking);
      this.container.appendChild(wrapInMessageRow('assistant', wrapper));
      this.currentAssistantThinkingContent = contentEl;
    }

    if (text) {
      const div = createMessageDiv(msg.role, text);
      this.container.appendChild(wrapInMessageRow(msg.role, div, timestamp));

      if (msg.role === 'assistant') {
        this.currentAssistantText = div;
        this.currentAssistantTimestamp = timestamp;
      }
    }
  }

  appendUserMessage(text: string): void {
    const div = createMessageDiv('user', text);
    this.container.appendChild(wrapInMessageRow('user', div, new Date()));
    this.scrollToBottom();
  }

  startAssistantMessage(): void {
    this.currentAssistantThinkingContent = null;
    this.currentAssistantText = null;
    this.currentAssistantTimestamp = new Date();
  }

  updateAssistantContent(content: ContentBlock[]): void {
    const thinkingPart = content.find((c): c is { type: 'thinking'; thinking: string } => c.type === 'thinking');
    const textParts = content.filter((c): c is { type: 'text'; text: string } => c.type === 'text');
    const toolCalls = content.filter((c): c is { type: 'toolCall'; id: string; name: string; arguments?: unknown } => c.type === 'toolCall');

    const thinking = thinkingPart?.thinking ?? '';
    const text = textParts.map((p) => p.text).join('');

    if (thinking) {
      if (!this.currentAssistantThinkingContent) {
        const { wrapper, contentEl } = createThinkingBlock('');
        this.currentAssistantThinkingContent = contentEl;
        this.container.appendChild(wrapInMessageRow('assistant', wrapper));
      }
      this.currentAssistantThinkingContent.textContent = thinking;
    }

    if (text) {
      if (!this.currentAssistantText) {
        this.currentAssistantText = createMessageDiv('assistant', '');
        this.container.appendChild(wrapInMessageRow('assistant', this.currentAssistantText, this.currentAssistantTimestamp ?? undefined));
      }
      this.currentAssistantText.replaceChildren(linkifyText(text));
    }

    for (const toolCall of toolCalls) {
      if (!this.toolDivs.has(toolCall.id)) {
        this.renderToolExecutionStart(toolCall.name, toolCall.arguments, toolCall.id);
      }
    }

    this.scrollToBottom();
  }

  finalizeAssistantMessage(): void {
    this.currentAssistantThinkingContent = null;
    this.currentAssistantText = null;
    this.currentAssistantTimestamp = null;
    this.scrollToBottom();
  }

  showToolCall(name: string, args?: unknown, id?: string): void {
    this.renderToolExecutionStart(name, args, id);
  }

  showToolResult(toolCallId: string, result?: unknown, isError?: boolean): void {
    this.renderToolExecutionEnd(toolCallId, result, isError);
  }

  private renderToolExecutionStart(toolName?: string, args?: unknown, toolCallId?: string): void {
    const description = getToolDescription(args);
    const text = description
      ? `🔧 ${toolName ?? 'tool'}: ${description}`
      : `🔧 ${toolName ?? 'tool'}`;

    if (toolCallId) {
      const existing = this.toolDivs.get(toolCallId);
      if (existing) {
        existing.textContent = text;
        const spinner = createToolSpinner();
        existing.appendChild(spinner);
        const data = this.toolCallData.get(toolCallId);
        if (data) data.arguments = args;
        this.scrollToBottom();
        return;
      }
    }

    const div = createToolDiv(text);
    div.classList.add('chat-tool-message--clickable');
    const spinner = createToolSpinner();
    div.appendChild(spinner);
    this.container.appendChild(wrapInMessageRow('assistant', div));

    if (toolCallId) {
      this.toolDivs.set(toolCallId, div);
      this.toolCallData.set(toolCallId, { id: toolCallId, name: toolName ?? 'tool', arguments: args });
      div.addEventListener('click', () => this.showToolDetailModal(toolCallId));
    }

    this.scrollToBottom();
  }

  private renderToolExecutionEnd(toolCallId: string, result?: unknown, isError?: boolean): void {
    const div = this.toolDivs.get(toolCallId);
    div?.querySelector('.chat-tool-spinner')?.remove();
    this.toolDivs.delete(toolCallId);

    const data = this.toolCallData.get(toolCallId);
    if (data) {
      data.result = result;
      data.isError = isError;
    }
    if (isError) div?.classList.add('chat-tool-message--error');
  }

  private showToolDetailModal(toolCallId: string): void {
    const data = this.toolCallData.get(toolCallId);
    if (!data) return;

    let bodyHtml = '';

    if (data.arguments && typeof data.arguments === 'object') {
      const argsWithoutDesc = { ...(data.arguments as Record<string, unknown>) };
      delete (argsWithoutDesc as Record<string, unknown>).description;
      if (Object.keys(argsWithoutDesc).length > 0) {
        bodyHtml += this.createDetailSectionHtml('Arguments', argsWithoutDesc);
      }
    }

    if (data.result !== undefined) {
      const label = data.isError ? 'Error' : 'Result';
      const errorClass = data.isError ? ' chat-detail-section--error' : '';
      bodyHtml += this.createDetailSectionHtml(label, data.result, errorClass);
    } else {
      bodyHtml += '<p class="chat-detail-pending">Running…</p>';
    }

    this.onToolDetail?.({
      title: `🔧 ${data.name}`,
      body: bodyHtml,
    });
  }

  private createDetailSectionHtml(label: string, data: unknown, extraClass = ''): string {
    const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const labelEscaped = label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<div class="chat-detail-section${extraClass}"><h3 class="chat-detail-section-label">${labelEscaped}</h3><pre class="chat-detail-pre">${escaped}</pre></div>`;
  }

  private scrollToBottom(): void {
    if (this.scrollContainer && this.isFollowing) {
      this.scrollContainer.scrollTop = this.scrollContainer.scrollHeight;
    }
  }
}