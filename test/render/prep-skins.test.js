import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'espree';
import { renderInfo } from '../../public/js/render/app/info.js';
import { GEO } from '../../shared/constants.js';
import { skinFor } from '../../public/js/ui/skins.js';

// Run the actual preparation functions with lightweight view objects, without allocating a GPU.
const source=fs.readFileSync(process.env.PREP_RENDER_SOURCE || new URL('../../public/js/render/app.js',import.meta.url),'utf8');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'module',range:true});
const factory=ast.body.find(n=>n.type==='ExportNamedDeclaration'&&n.declaration?.id?.name==='createFieldView').declaration;
function findFunction(node,name){
 if(!node||typeof node!=='object')return null;
 if(node.type==='FunctionDeclaration'&&node.id.name===name)return node;
 for(const child of Object.values(node)){
  if(!child||typeof child!=='object')continue;
  if(Array.isArray(child)){for(const item of child){const found=findFunction(item,name);if(found)return found;}}
  else {const found=findFunction(child,name);if(found)return found;}
 }
 return null;
}
const funcs=['pieceInfo','setPrep','syncReadOnlyPrepUnits','dropView'].map(name=>{
 const n=findFunction(factory.body,name);assert(n,name);return source.slice(...n.range);
}).join('\n');
class View {
 constructor(ctx,info){this.info=info;this.destroyed=false;this.x=info.x;this.y=info.y;this.z=0;}
 setWorld(x,y,z){Object.assign(this,{x,y,z});}
 setDir(dir){this.dir=dir;}
 setItems(){}
 destroy(){this.destroyed=true;}
}
const make=new Function('UnitView','ItemView','renderInfo','GEO','skinFor',`
 const views=new Map(),ctx={},assets={},TIER_COLORS={},data={chess:id=>({chessId:id,baseId:id,charId:'char_test',assets:{spine:'char_test',avatar:'char_test'},tier:1})};
 let destroyed=false,mode='prep',lastPrep,editable,canPlaceFn,standInList=[],diyPicks={},ownPen,prepPieces=[],promoBase=[],dragState=null,hoverUnit=null;
 const drag={setCanPlace(){},setEditable(){}},held=new Map(),pending=new Map(),promotions=[],fx={deploy(){},promote(){}},prepXf={kind:'normal',toDisp:(row,col)=>({row,col}),dirToDisp:d=>d};
 const pieceDirOf=p=>p.dir,dispDir=d=>d,slotWorld=p=>({x:p.col||p.idx||0,y:p.row||0,z:0}),heightAt=()=>0;
 const setPenList=()=>{},holdScene=()=>{},promotionsOf=()=>[],adaptCanPlace=x=>x;
 ${funcs}
 return {setPrep,views};
`);

test('preparation keeps selected skins in hand, temp, board and read-only ally views',()=>{
 const r=make(View,View,renderInfo,GEO,skinFor),piece=(uid,skin)=>({uid,kind:'chess',id:'chess_test',skin});
 const state={hand:[piece(1,'skin-a')],temp:[piece(2,'skin-a')],board:[{...piece(3,'skin-a'),row:9,col:5}],prepMapChars:[{id:4,uid:4,kind:'op',side:'ally',defId:'chess_test',spine:'char_test',skin:'skin-a',x:6,y:9}]};
 r.setPrep(state,{editable:false});
 for(const key of ['p:1','p:2','p:3','m:4'])assert.equal(r.views.get(key).info.skin,'skin-a',key);
 const before=new Map(r.views);r.setPrep(state,{editable:false});
 for(const [key,v] of before)assert.equal(r.views.get(key),v,'unchanged skin reuses the view');
 state.hand[0].skin='skin-b';state.prepMapChars[0].skin='skin-b';r.setPrep(state,{editable:false});
 for(const key of ['p:1','m:4']){
  assert.equal(before.get(key).destroyed,true,'old skin is released');
  assert.notEqual(r.views.get(key),before.get(key),'skin change rebuilds the view');
  assert.equal(r.views.get(key).info.skin,'skin-b');
 }
 assert.equal(r.views.get('p:3'),before.get('p:3'),'other board pieces are unaffected');
 delete state.hand[0].skin;r.setPrep(state,{editable:false});assert.equal(r.views.get('p:1').info.skin,null,'return to default costume');
 const battle=renderInfo({id:3,uid:3,kind:'op',side:'ally',defId:'chess_test',spine:'char_test',skin:state.board[0].skin,x:5,y:9});
 assert.equal(battle.skin,r.views.get('p:3').info.skin,'battle and preparation use the same costume');
});
