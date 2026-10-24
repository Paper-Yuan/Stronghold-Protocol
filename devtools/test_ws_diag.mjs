import { loadWorkshop } from "./server/workshop.js";
import { modSetOf } from "./shared/modIdentity.js";

const res = loadWorkshop("./workshop");
console.log("PACKS_COUNT:", res.packs.length);
if (res.packs.length) {
  const p = res.packs[0];
  console.log("PACK 0:", { id: p.id, name: p.name, enabled: p.enabled });
  const mods = res.packs.map(x => ({ id: x.id, hash: x.hash, layer: x.layer, combat: !!x.combat }));
  console.log("MODSET:", modSetOf(mods));
}
console.log("ERRORS:", res.errors);
