// test/full_operators_combat.mjs
// 遍历并测试所有干员（标准棋子 + 补位棋子 + 全部自选6星DIY干员）的进战与渲染链路

import fs from 'fs';
import path from 'path';
import { loadBrowserSim } from '../public/js/battle/runner.js';
import { renderInfo } from '../public/js/render/app.js';
import { spineEntry } from '../public/js/assets.js';

async function run() {
  console.log('====================================================');
  console.log('       全量干员进战与渲染流水线自动化压力测试        ');
  console.log('====================================================\n');

  const assetsManifest = JSON.parse(fs.readFileSync('./public/data/assets.json', 'utf8'));

  const sim = await loadBrowserSim({
    base: '../../sim/',
    dataBase: '../../data/',
    fetchFn: async (url) => {
      const filename = path.basename(url);
      const filePath = path.join('./public/data', filename);
      const text = fs.readFileSync(filePath, 'utf8');
      return { ok: true, json: async () => JSON.parse(text) };
    }
  });

  const chessData = sim.ds.raw.chess;
  const backupsData = sim.ds.raw.backups;

  let totalTested = 0;
  let passCount = 0;
  let failedList = [];

  // ==========================================
  // 测试 1：测试所有普通棋子（标准干员及精英形态）
  // ==========================================
  console.log('>>> [阶段 1] 正在测试全量标准干员棋子 (chess.json)...');
  const regularChessIds = Object.keys(chessData).filter(id => !chessData[id].isDiy);
  console.log(`  标准干员数量: ${regularChessIds.length}`);

  for (const chessId of regularChessIds) {
    totalTested++;
    try {
      const def = sim.ds.getChess(chessId);
      if (!def) throw new Error(`sim.ds.getChess(${chessId}) 返回空`);
      if (!def.stats || !Number.isFinite(def.stats.maxHp)) throw new Error(`def.stats.maxHp 无效`);

      // 构造战斗输入并在合法地块 (row: 10, col: 2) 部署
      const spec = sim.spec.buildBattleSpec({
        battleId: `test_${chessId}`,
        fieldId: 'n:p_0',
        kind: 'normal',
        seed: 1000 + totalTested,
        modeId: 'mode_solo',
        round: 1,
        stageId: 'act2autochess_m01',
        timeLimit: 60,
        players: [{
          playerId: 'p_0',
          side: 'L',
          colOffset: 0,
          units: [{
            uid: `u_${chessId}`,
            kind: 'chess',
            chessId: chessId,
            row: 10,
            col: 2,
            dir: 'RIGHT'
          }]
        }],
        spawns: [],
        routes: []
      });

      const battle = sim.spec.createBattleFromSpec(spec, sim.ds, { recordEvents: true, quiet: true });
      battle.start();

      const unit = battle.allyUnits.find(u => u.uid === `u_${chessId}`);
      if (!unit || !unit.alive || !unit.deployed) {
        throw new Error(`进战未成功部署 (alive: ${unit?.alive}, deployed: ${unit?.deployed})`);
      }

      const meta = battle.fieldMeta();
      const metaUnit = meta.units.find(u => u.uid === `u_${chessId}`);
      if (!metaUnit) throw new Error(`fieldMeta.units 中未找到该单位`);

      const rInfo = renderInfo(metaUnit);
      if (!rInfo || !rInfo.spine) throw new Error(`renderInfo 缺失 spine 字段`);

      // 步进 5 帧验证动作
      for (let s = 0; s < 5; s++) battle.step();

      passCount++;
    } catch (err) {
      failedList.push({ type: 'regular', id: chessId, name: chessData[chessId]?.name, error: err.message });
    }
  }

  // ==========================================
  // 测试 2：测试所有 6 星自选干员池 (ownedPool)
  // ==========================================
  console.log('\n>>> [阶段 2] 正在测试全量 6★ 自选干员 (ownedPool)...');
  const ownedPool = backupsData.diy?.ownedPool || [];
  console.log(`  自选干员数量: ${ownedPool.length}`);

  for (const charId of ownedPool) {
    totalTested++;
    const charName = backupsData.units?.[charId]?.name || charId;
    try {
      // 自选槽位模板
      const diySlotId = 'chess_char_6_diy1_a';
      const pick = { charId, skillIndex: 0, uniEquipId: null };

      const def = sim.ds.getChess(diySlotId, { diy: pick });
      if (!def) throw new Error(`sim.ds.getChess 自选合成返回空`);
      if (def.charId !== charId) throw new Error(`def.charId (${def.charId}) 不匹配期望 (${charId})`);
      if (!def.stats || !Number.isFinite(def.stats.maxHp)) throw new Error(`def.stats.maxHp 无效`);

      const spec = sim.spec.buildBattleSpec({
        battleId: `test_diy_${charId}`,
        fieldId: 'n:p_0',
        kind: 'normal',
        seed: 2000 + totalTested,
        modeId: 'mode_solo',
        round: 1,
        stageId: 'act2autochess_m01',
        timeLimit: 60,
        players: [{
          playerId: 'p_0',
          side: 'L',
          colOffset: 0,
          units: [{
            uid: `u_diy_${charId}`,
            kind: 'chess',
            chessId: diySlotId,
            row: 10,
            col: 2,
            dir: 'RIGHT',
            diy: pick
          }]
        }],
        spawns: [],
        routes: []
      });

      const battle = sim.spec.createBattleFromSpec(spec, sim.ds, { recordEvents: true, quiet: true });
      battle.start();

      const unit = battle.allyUnits.find(u => u.uid === `u_diy_${charId}`);
      if (!unit || !unit.alive || !unit.deployed) {
        throw new Error(`自选干员进战未部署 (alive: ${unit?.alive}, deployed: ${unit?.deployed})`);
      }

      const meta = battle.fieldMeta();
      const metaUnit = meta.units.find(u => u.uid === `u_diy_${charId}`);
      if (!metaUnit) throw new Error(`fieldMeta.units 中未找到自选干员`);

      const rInfo = renderInfo(metaUnit);
      if (!rInfo || !rInfo.spine) throw new Error(`renderInfo 缺失 spine`);

      // 验证 Spine 骨骼寻址
      const spEntry = spineEntry(assetsManifest, rInfo.spine, { back: false });
      if (!spEntry) {
        // 如果没有 Spine 检查是否有头像回退
        if (!rInfo.avatar) throw new Error(`既无 Spine 也无 avatar 兜底`);
      }

      for (let s = 0; s < 5; s++) battle.step();

      passCount++;
    } catch (err) {
      failedList.push({ type: 'diy_6star', id: charId, name: charName, error: err.message });
    }
  }

  // ==========================================
  // 测试 3：测试全部 补位干员 (Stand-In)
  // ==========================================
  console.log('\n>>> [阶段 3] 正在测试补位干员 (Stand-In)...');
  // 查找所有具有 backup/stand-in 的标准棋子
  const standInChessIds = Object.keys(chessData).filter(id => chessData[id].backup?.charId);
  console.log(`  具有补位替代的标准棋子数量: ${standInChessIds.length}`);

  for (const chessId of standInChessIds) {
    totalTested++;
    const targetCharId = chessData[chessId].backup.charId;
    const charName = backupsData.units?.[targetCharId]?.name || targetCharId;
    try {
      const def = sim.ds.getChess(chessId, { standIn: true });
      if (!def) throw new Error(`sim.ds.getChess(${chessId}, { standIn: true }) 返回空`);
      if (def.charId !== targetCharId) throw new Error(`def.charId (${def.charId}) 不匹配补位目标 (${targetCharId})`);
      if (!def.stats || !Number.isFinite(def.stats.maxHp)) throw new Error(`def.stats.maxHp 无效`);

      const spec = sim.spec.buildBattleSpec({
        battleId: `test_standin_${chessId}`,
        fieldId: 'n:p_0',
        kind: 'normal',
        seed: 3000 + totalTested,
        modeId: 'mode_solo',
        round: 1,
        stageId: 'act2autochess_m01',
        timeLimit: 60,
        players: [{
          playerId: 'p_0',
          side: 'L',
          colOffset: 0,
          units: [{
            uid: `u_si_${chessId}`,
            kind: 'chess',
            chessId: chessId,
            row: 10,
            col: 2,
            dir: 'RIGHT',
            standIn: true
          }]
        }],
        spawns: [],
        routes: []
      });

      const battle = sim.spec.createBattleFromSpec(spec, sim.ds, { recordEvents: true, quiet: true });
      battle.start();

      const unit = battle.allyUnits.find(u => u.uid === `u_si_${chessId}`);
      if (!unit || !unit.alive || !unit.deployed) {
        throw new Error(`补位干员进战未部署 (alive: ${unit?.alive}, deployed: ${unit?.deployed})`);
      }

      const meta = battle.fieldMeta();
      const metaUnit = meta.units.find(u => u.uid === `u_si_${chessId}`);
      if (!metaUnit) throw new Error(`fieldMeta.units 中未找到补位干员`);

      const rInfo = renderInfo(metaUnit);
      if (!rInfo || !rInfo.spine) throw new Error(`renderInfo 缺失 spine`);

      for (let s = 0; s < 5; s++) battle.step();

      passCount++;
    } catch (err) {
      failedList.push({ type: 'stand_in', id: chessId, name: `${chessData[chessId].name} → ${charName}`, error: err.message });
    }
  }

  // ==========================================
  // 汇总报告
  // ==========================================
  console.log('\n====================================================');
  console.log(`测试完成！总计验证: ${totalTested} 项`);
  console.log(`  ✔ 通过项: ${passCount}`);
  console.log(`  ✘ 失败项: ${failedList.length}`);
  console.log('====================================================');

  if (failedList.length > 0) {
    console.error('\n失败干员列表:');
    for (const f of failedList) {
      console.error(`- [${f.type}] ${f.name} (${f.id}): ${f.error}`);
    }
    process.exit(1);
  } else {
    console.log('\n🎉 所有干员测试全部通过！进战属性、部署状态、Spine寻址无任何遗漏或崩溃！');
  }
}

run().catch((e) => {
  console.error('测试运行异常:', e);
  process.exit(1);
});
