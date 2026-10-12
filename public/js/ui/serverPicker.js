import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { GAME_NODES, STATUS_ORIGIN, nodeForHost, normalizeNodeStatus, recommendNode } from '../../../shared/serverSelection.js';

export const currentGameNode = () => nodeForHost(globalThis.location?.hostname);
const PRESSURE = { low: '流畅', moderate: '中等', busy: '繁忙', unknown: '检查中' };

export async function probeNode(node, fetchFn = globalThis.fetch) {
  return { available: false, receivedAt: Date.now() };
}

export function ServerPicker({ selected = currentGameNode(), onSelect, locked = false, compact = false }) {
  return null;
}
