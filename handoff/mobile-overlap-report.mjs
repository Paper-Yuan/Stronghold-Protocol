import fs from 'node:fs';
const before = JSON.parse(fs.readFileSync('handoff/mobile-overlap-before.json', 'utf8'));
const after = JSON.parse(fs.readFileSync('handoff/mobile-overlap-after.json', 'utf8'));
const vps = ['792x360', '667x375', '844x390'];
const fmt = (r) => (r ? `[${r.join(',')}]` : 'null');
const gaps = (n) => n.map((p) => `${p.axis}${p.gap}: ${p.a} | ${p.b}`);
const pairs = {
  'A 大厅三张模式卡(横向)': (d) => d.hub.near.filter((p) => /mode-card/.test(p.a) || /mode-card/.test(p.b)),
  'B 选择拓展玩法两行(竖向)': (d) => d.hall.near.filter((p) => /ext-row/.test(p.a) || /ext-row/.test(p.b)),
  'C 大厅右侧 sweep/干员调配(竖向)': (d) => d.hub.near.filter((p) => /hub-plate|loadout-open/.test(p.a + p.b)),
  'D 主题大厅左下 sweep/干员调配(竖向)': (d) => d.theme.near.filter((p) => /ext-theme__slot|ext-theme__loadout/.test(p.a + p.b)),
};
for (const vp of vps) {
  console.log(`\n===== ${vp} =====`);
  for (const [label, pick] of Object.entries(pairs)) {
    const b = pick(before[vp])[0], a = pick(after[vp])[0];
    console.log(`${label}: 前 ${b ? b.gap + 'px  ' + fmt(b.ra) + ' / ' + fmt(b.rb) : '无(>8px)'}  →  后 ${a ? a.gap + 'px  ' + fmt(a.ra) + ' / ' + fmt(a.rb) : '无(>8px, 已拉开)'}`);
  }
  for (const k of ['hub', 'hall', 'theme']) {
    console.log(`  ${k}: 交叠 ${after[vp][k].overlaps.length} 处 / 滚动 ${JSON.stringify(after[vp][k].scroll)}`);
  }
}
