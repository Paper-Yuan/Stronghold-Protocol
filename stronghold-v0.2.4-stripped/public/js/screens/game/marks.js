// public/js/screens/game/marks.js — class-name join and the field highlight styles the match screen passes to the view.

export const cx = (...p) => p.flat().filter(Boolean).join(' ');

export const HUD_HZ_MS = 200;

/** Range tiles of the selected unit (its own highlight group: the wheel's 'facing' group may be up at the same time). */
export const SEL_RANGE = Object.freeze({ group: 'selRange', color: 0xff9c33, fill: 0.3, line: 0.95 });

/** The tile an armed merge-completing card's elite will take (its own group; gold like the promotion cue, render/fx.js). */
export const MERGE_HL = Object.freeze({ group: 'mergeTile', color: 0xffd45a, fill: 0.34, line: 1 });
