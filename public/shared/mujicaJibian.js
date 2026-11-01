// shared/mujicaJibian.js — 「多首野兽」(若叶睦 / Mortis) 的卡 id 与它授权书写的特质文案：战斗规则与 owner 侧的 UI 共用
// 同一份字面量。
//
// PORT NOTE (0.3.1-mod.4 → 0.3.3): byte-for-byte port of the pack's `shared/mujicaJibian.js` (4 lines). It is a pure
// constant module (no imports, no side effects), loaded by the sim (`server/sim/content/mujicaBond.js`), by the match
// (`server/match/effectsMeta.js` through the entry's effect id) and by the browser (`public/js/ui/gameLogic/mujicaTraits.js`
// renders MORTIS_BEAST_TRAIT on the 精锐若叶睦 card). Before this file existed the two literals were declared in place in
// `server/sim/content/mujicaBond.js` and `server/sim/content/jibian.js`; both now import from here, so the card's identity
// and the trait's text can never drift apart (an id typo is a SILENT miss: the effect simply never fires).
export const MORTIS_BEAST_CARD = 'jibian_duoshouyeshou';
export const MORTIS_BEAST_TRAIT = '玩家所有已激活盟约每叠加3层，本干员攻击附带相当于攻击力2%的凋亡损伤，若目标处于凋亡损伤爆发期间，还将额外附带相当于攻击力2%的元素伤害。（每满3层递增一档）';
