import { mountRoomChat } from './js/ui/roomChat.js';
const dispose = mountRoomChat();
window.addEventListener('pagehide', dispose, { once: true });
