// public/js/ui/chatInputBar.js — In-match text chat input bar
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';

export function ChatInputBar({ open, onSend, onClose }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 60);
    } else {
      setText('');
    }
  }, [open]);

  if (!open) return null;

  const submit = (e) => {
    e?.preventDefault();
    const val = text.trim();
    if (!val) return;
    onSend(val);
    setText('');
    onClose();
  };

  return html`<div class="chat-bar" role="dialog" aria-label="局内发言">
    <form class="chat-bar__form" onSubmit=${submit}>
      <input
        ref=${inputRef}
        type="text"
        class="chat-bar__input"
        maxlength="60"
        placeholder="发送局内消息..."
        value=${text}
        onInput=${(e) => setText(e.currentTarget.value)}
      />
      <button type="submit" class="chat-bar__send" disabled=${!text.trim()}>发送</button>
      <button type="button" class="chat-bar__close" onClick=${onClose} aria-label="关闭">
        <${Icon} name="close" />
      </button>
    </form>
  </div>`;
}
