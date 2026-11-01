// test/ui/room-invite-text.test.js — 房间「复制链接」的邀请文案（业主 2026-10-31 定稿）。两行：
//
//   第一行「{host} 邀请你参加 {room}【{n}/{total}】」，第二行原样是 inviteLink(code)。
//
// {room}：官方同盟房 = 「模式名 · 难度名」（同盟模拟 · 终极模拟）；专属玩法房（炸惊 / 湮灭 / 超限）只贴模式名，
// 不拼难度；取不到难度名的位置也退回模式名。独立房没有邀请文案（它的链接按钮根本不画）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
const { inviteText } = await import('../../public/js/screens/room.js');

const ORIGIN = { origin: 'http://192.168.1.7:3000', pathname: '/' };

/** inviteText is pure text, but inviteLink reads the page URL (as on the room screen): pin it for the assertion. */
function text(fields) {
  const had = globalThis.location;
  globalThis.location = ORIGIN;
  try {
    return inviteText(fields);
  } finally {
    if (had === undefined) delete globalThis.location; else globalThis.location = had;
  }
}

test('official co-op room: 「昵称 邀请你参加 同盟模拟 · 难度【2/4】」 and the link on the second line', () => {
  const s = text({
    host: '盐漠旅人', modeLabel: '同盟模拟', difficultyLabel: '终极模拟',
    isPlaySet: false, solo: false, n: 2, total: 4, code: '7K2MQ4',
  });
  assert.deepEqual(s.split('\n'), [
    '盐漠旅人 邀请你参加 同盟模拟 · 终极模拟【2/4】',
    'http://192.168.1.7:3000/?room=7K2MQ4',
  ]);
  assert.equal(s, '盐漠旅人 邀请你参加 同盟模拟 · 终极模拟【2/4】\nhttp://192.168.1.7:3000/?room=7K2MQ4');
});

test('专属玩法房（炸惊 / 湮灭 / 超限）：只贴模式名，不拼难度', () => {
  // DIFFICULTY_NAMES has ZHAJING / ANNIHILATION, so the caller can pass a difficulty label;
  // isPlaySet must still drop it. 超限 passes 终极模拟 the same way.
  for (const [modeLabel, difficultyLabel] of [
    ['炸惊模拟', '炸惊模拟'], ['湮灭模拟', '湮灭模拟'], ['超限模拟', '终极模拟'],
  ]) {
    const s = text({
      host: '盐漠旅人', modeLabel, difficultyLabel,
      isPlaySet: true, solo: false, n: 2, total: 4, code: 'ZJ42',
    });
    assert.deepEqual(s.split('\n'), [
      `盐漠旅人 邀请你参加 ${modeLabel}【2/4】`,
      'http://192.168.1.7:3000/?room=ZJ42',
    ]);
    assert.ok(!s.split('\n')[0].includes(' · '), `no 「模式 · 难度」 separator in ${modeLabel}`);
  }
});

test('独立房（solo）：不产生邀请文案', () => {
  assert.equal(text({
    host: '盐漠旅人', modeLabel: '独立模拟', difficultyLabel: '绝境模拟',
    isPlaySet: false, solo: true, n: 1, total: 1, code: 'SOLO',
  }), null);
});

test('取不到难度名时退回只贴模式名', () => {
  const s = text({
    host: 'H', modeLabel: '同盟模拟', difficultyLabel: '',
    isPlaySet: false, solo: false, n: 1, total: 4, code: 'ABCD',
  });
  assert.equal(s.split('\n')[0], 'H 邀请你参加 同盟模拟【1/4】');
  assert.equal(s.split('\n')[1], 'http://192.168.1.7:3000/?room=ABCD');
});

test('room.js wiring: 「复制」 copies the invitation from the room state, co-op only', () => {
  assert.match(SRC, /class="rs-key__copy" onClick=\$\{\(\) => copy\('link'\)\}/);
  assert.match(SRC, /what === 'link' && coop \? inviteText\(\{/);
  assert.match(SRC, /const playSetKind = playSetOf\(room\);/);
  assert.match(SRC, /playSetKind === 'annihilation' \? t\('湮灭模拟'\) : playSetKind === 'zhajing' \? t\('炸惊模拟'\)/);
  assert.match(SRC, /isInfiniteMode\(room\.mode\) \? t\('超限模拟'\) : t\('同盟模拟'\)/);
  assert.match(SRC, /n: facts\.occupied\.length,/);
  assert.match(SRC, /total: facts\.seats\.length,/);
  assert.match(SRC, /t\('\{host\} 邀请你参加 \{room\}【\{n\}\/\{total\}】'/);
  // the empty seat's 邀请 still copies the bare key (docs/design/client.md: 邀请 (copies the key))
  assert.match(SRC, /onInvite=\$\{\(\) => copy\('code'\)\}/);
});
