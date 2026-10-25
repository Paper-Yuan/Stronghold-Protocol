import WebSocket from "ws";
const ws = new WebSocket("ws://127.0.0.1:3000/ws");
let rid = 0; const pending = new Map();
const send = (t, f = {}) => { const id = ++rid; ws.send(JSON.stringify({ t, rid: id, ...f })); return new Promise(r => pending.set(id, r)); };
ws.on("message", raw => { const m = JSON.parse(raw.toString()); if (m.rid && pending.has(m.rid)) { const d = pending.get(m.rid); pending.delete(m.rid); d(m); } });
ws.on("open", async () => {
  await send("hello", { name: "smoke2" });
  const c = await send("room.create", { mode: "coop", difficulty: "NORMAL" });
  console.log("room.create coop:", c.t);
  const card = await send("room.card", { charId: "" });
  console.log("room.card:", card.t, card.t === "ok" ? "OK (no BAD_MSG)" : (card.code || "") + " " + (card.detail || ""));
  const skins = await send("room.skins", { skins: {} });
  console.log("room.skins:", skins.t);
  const ready = await send("room.ready", { ready: true });
  console.log("room.ready:", ready.t);
  ws.close(); process.exit(0);
});
ws.on("error", e => { console.log("err", e.message); process.exit(1); });
setTimeout(() => { console.log("timeout"); process.exit(1); }, 20000);
