import { mountRoomVoice } from './js/ui/roomVoice.js';
import { nodeForHost } from './shared/serverSelection.js';
const dispose = nodeForHost(location.hostname) === 'hongkong2' ? () => {} : mountRoomVoice();
window.addEventListener('pagehide', dispose, { once: true });
