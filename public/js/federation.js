// One public lobby; each room still has one authoritative simulation node.
export const enabled = ['sp.isomer319.xyz','wei.isomer319.xyz'].includes(globalThis.location?.hostname);
let activeNode=null;
try { activeNode=sessionStorage.getItem('sp.federation.node'); const requested=new URLSearchParams(location.search).get('node'); if(['hongkong','hongkong2'].includes(requested)&&sessionStorage.getItem('sp.federation.route')!==location.href)activeNode=requested; } catch {}
let switchConnection=null;
export function currentNode(){
 if(['hongkong','hongkong2'].includes(activeNode))return activeNode;
 const requested=new URLSearchParams(globalThis.location?.search||'').get('node');
 return ['hongkong','hongkong2'].includes(requested)?requested:globalThis.location?.hostname==='wei.isomer319.xyz'?'hongkong2':'hongkong';
}
let cached=null,pending=null;
export async function rooms(force=false){
 if(!force&&cached&&Date.now()-cached.receivedAt<2500)return cached;
 if(pending)return pending;
 pending=(async()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{
   const r=await fetch('/alliance/rooms',{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error('统一大厅暂时不可用');
   const d=await r.json();if(!d.ok||!Array.isArray(d.rooms)||Date.now()-d.updatedAt>15000)throw Error('统一大厅信息暂未更新，请稍后重试');
   cached={...d,receivedAt:Date.now()};return cached;
  }finally{clearTimeout(timer);pending=null;}
 })();return pending;
}
async function transfer(node,type,fields){
 if(!['hongkong','hongkong2'].includes(node))throw Error('未知游戏节点');
 const app=globalThis.__SP__;if(app?.store.get().room)throw Error('请先离开当前同盟，再进入其他节点');
 if(!switchConnection)throw Error('跨服连接尚未就绪，请稍后重试');
 await switchConnection(node);
 const {federationDirect,federationNode,...clean}=fields;
 return app.net.request(type,{...clean,federationDirect:true,federationNode:node});
}
export function installFederation(net,identity){
 if(!enabled)return;
 const original=net.request.bind(net);
 let switching=null;
 switchConnection=async node=>{
  if(switching)throw Error('正在连接目标服务器，请稍候');
  const app=globalThis.__SP__,previous=currentNode(),name=app?.store.get().me.name||net.name;
  if(!app||!name)throw Error('请先填写昵称进入大厅');
  switching=node;
  const connect=async target=>{
   net.close();
   activeNode=target;try{sessionStorage.setItem('sp.federation.node',target);sessionStorage.setItem('sp.federation.route',location.href);}catch{}
   await identity.switchNode(target);
   net.playerId=null;net.helloName=null;net.serverName=null;net._publicSkinCache.clear();
   app.store.set({me:{...app.store.get().me,playerId:null,token:null}});
   net.name=name;net.connect();
   const until=Date.now()+30000;
   while(Date.now()<until){
    if(net.status==='online'&&app.store.get().session.preloadReady)return;
    if(net.lastError)throw net.lastError;
    await new Promise(resolve=>setTimeout(resolve,100));
   }
   throw Error('目标服务器连接超时，请稍后重试');
  };
  try{await connect(node);}catch(error){try{await connect(previous);}catch{}throw error;}
  finally{switching=null;}
 };

 net.request=async(type,fields={},opts={})=>{
  if(type==='room.list'){
   const [local,shared]=await Promise.allSettled([original(type,fields,opts),rooms()]);
   if(shared.status==='fulfilled'){
    const d=shared.value;
    const localRooms=local.status==='fulfilled'&&Array.isArray(local.value?.rooms)?local.value.rooms:globalThis.__SP__?.store.get().lobbyStats?.rooms;
    const details=new Map((Array.isArray(localRooms)?localRooms:[]).map(r=>[r.code,r]));
    return {...d,rooms:d.rooms.map(r=>r.node===currentNode()&&details.has(r.code)?{...r,...details.get(r.code),node:r.node,nodeName:r.nodeName}:r)};
   }
   if(local.status==='fulfilled')return local.value;throw local.reason;
  }
  if(['room.join','room.spectate'].includes(type)){
   const {federationNode, federationDirect,...clean}=fields;
   if(federationNode&&federationNode!==currentNode())return transfer(federationNode,type,clean);
   if(federationDirect||federationNode)return original(type,clean,opts);
   const invitation=new URLSearchParams(location.search);
   if(invitation.get('room')===clean.code&&['hongkong','hongkong2'].includes(invitation.get('node'))){const target=invitation.get('node');return target===currentNode()?original(type,clean,opts):transfer(target,type,clean);}
   let d;try{d=await rooms(true);}catch{}
   const found=d?.rooms.filter(r=>r.code===clean.code)||[];
   if(found.length>1)throw Error('两个节点存在相同密钥，请从统一房间列表选择对应同盟');
   if(found.length===1&&found[0].node!==currentNode())return transfer(found[0].node,type,clean);
   try{return await original(type,clean,opts);}catch(e){
    if(e.code!=='ROOM_NOT_FOUND'||found.length)throw e;
    const other=currentNode()==='hongkong'?'hongkong2':'hongkong';
    if(d?.nodes.find(n=>n.id===other)?.available)return transfer(other,type,{...clean,federationDirect:true});
    throw e;
   }
  }
  if(type==='room.create'){
   let d;try{d=await rooms(true);}catch{}
   const nodes=d?.nodes.filter(n=>n.available)||[];
   nodes.sort((a,b)=>((a.pressure?.cpuPercent||0)*2+(a.online||0)*2+(a.pressure?.loopLagMs||0))-((b.pressure?.cpuPercent||0)*2+(b.online||0)*2+(b.pressure?.loopLagMs||0)));
   if(nodes[0]&&nodes[0].id!==currentNode())return transfer(nodes[0].id,type,fields);
  }
  if(type==='match.queue'){
   // Identical queue criteria always select the same node: players arriving through either site can match.
   const key=[fields.mode,fields.difficulty,!!fields.random,fields.variant||'blitz'].join(':');
   let hash=0;for(const c of key)hash=(hash*31+c.charCodeAt(0))>>>0;
   const node=hash%2?'hongkong2':'hongkong',d=await rooms(true);
   if(!d.nodes.find(n=>n.id===node)?.available)throw Error('该玩法的匹配节点暂不可用，请改用创建同盟');
   if(node!==currentNode())return transfer(node,type,fields);
  }
  return original(type,fields,opts);
 };
 let action;try{action=JSON.parse(sessionStorage.getItem('sp.federation.action')||'null');}catch{}
 if(!action)return;
 const timer=setInterval(async()=>{
  if(action.expires<Date.now()||action.node!==currentNode()){clearInterval(timer);sessionStorage.removeItem('sp.federation.action');return;}
  const app=globalThis.__SP__;if(!app)return;const s=app.store.get();
  if(!s.session.preloadReady)return;
  if(!s.session.entered){const name=app.store.get().me.name;if(!name)return;net.setName(name);app.store.patch('session',{entered:true});return;}
  if(net.status!=='online')return;
  clearInterval(timer);sessionStorage.removeItem('sp.federation.action');
  if(s.room){window.dispatchEvent(new CustomEvent('sp-federation-error',{detail:'你已在该节点的同盟中，请先离开同盟'}));return;}
  const {federationDirect,federationNode,...fields}=action.fields;
  try{await original(action.type,fields);}catch(e){window.dispatchEvent(new CustomEvent('sp-federation-error',{detail:e.message}));}
 },400);
}
