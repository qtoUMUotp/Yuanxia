// 5e 规则对照探针：只读检查，不改任何逻辑
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['core.js', 'data.embedded.js', 'data.js', 'rules.js', 'items.js', 'combat.js', 'map.js', 'events.js', 'shop.js', 'codex.js', 'run.js', 'ui.js'];
const store = {};
const html = { innerHTML: '', querySelector: () => null };
const ctx = { console, document: { readyState:'complete', getElementById:()=>html, addEventListener:()=>{}, querySelector:()=>null },
  localStorage: { getItem:(k)=> (k in store? store[k]: null), setItem:(k,v)=>{store[k]=String(v);}, removeItem:(k)=>{delete store[k];} },
  setTimeout, clearTimeout, addEventListener:()=>{}, prompt:(m,d)=>(d||'') };
ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of FILES) { const code = readFileSync(join(root,'js',f),'utf8'); vm.runInContext(code, ctx, { filename:'js/'+f }); }
const NK = ctx.NK;
await NK.Data.load();
const R = NK.Rules, C = NK.Combat;
const bg0 = NK.Data.get('backgrounds').backgrounds[0].id;
const mk = (cls, level, attrs={}, extra={}) => {
  const a = Object.assign({str:10,dex:14,con:14,int:10,wis:10,cha:10}, attrs);
  const p = R.createPlayer({ raceId:'human', bgId:bg0, classId:cls, classes:[{id:cls,level,subclassId:null}], attrs:a, skills:[], equipment:[], name:'T' });
  Object.assign(p, extra); R.recalc(p); return p;
};
const P = n => String(n).padEnd(14);

console.log('— 1. 兼职法术位（5e 用「合并施法等级」表）—');
const multi = (a,la,b,lb) => { const p = mk(a,la,{int:16,wis:16,cha:16}); p.classes=[{id:a,level:la,subclassId:null},{id:b,level:lb,subclassId:null}]; R.normalizeClasses(p); R.recalc(p); return p; };
const cases = [['wizard',5,'cleric',5,'[4,3,3,3,2]'],['wizard',1,'cleric',1,'[3,0,0,0,0]'],['ranger',4,'paladin',4,'[3,0,0,0,0]'],['wizard',5,'ranger',2,'[4,3,3,0,0]']];
for (const [a,la,b,lb,exp] of cases) { const p = multi(a,la,b,lb); const got = JSON.stringify(p.slotsMax); console.log(`  ${P(a+la+'/'+b+lb)} 实测 ${P(got)} 5e ${exp}  ${got===exp?'✔':'✘ 不符'}`); }
const ww = multi('wizard',5,'warlock',5); console.log(`  ${P('wizard5/warlock5')} 实测 ${P(JSON.stringify(ww.slotsMax))} 契约 ${ww.pactLevel}环x${ww.pactSlotsMax}  5e [4,3,2,0,0] + 3环x2`);

console.log('\n— 2. 契约魔法槽位（5e: L1=1×1环 L2=2×1环 L3/4=2×2环 L5/6=2×3环 L7/8=2×4环 L9/10=2×5环）—');
for (let lv=1; lv<=10; lv++){ const q = mk('warlock',lv,{cha:18}); console.log(`  Lv${String(lv).padEnd(3)} 实测 ${q.pactSlotsMax}个${q.pactLevel}环`); }

console.log('\n— 3. 偷袭骰 —');
for (const lv of [1,3,5,7,9]) { const q = mk('rogue',lv,{dex:18}); const e = Math.ceil(lv/2); console.log(`  Lv${lv} 实测 ${q.mods.sneakAttack}d6   5e ${e}d6  ${q.mods.sneakAttack===e?'✔':'✘'}`); }

console.log('\n— 4. 施法容量（主属性16）—');
for (const [c,at] of [['wizard',{int:16}],['cleric',{wis:16}],['druid',{wis:16}],['bard',{cha:16}],['sorcerer',{cha:16}],['warlock',{cha:16}],['ranger',{wis:16}],['paladin',{cha:16}],['artificer',{int:16}]]) {
  const row=[]; for (const lv of [1,3,5,10]) { const q = mk(c,lv,at); const cap=R.spellCapacity(q); row.push(`L${lv}: 戏${cap.cantrips} 备${cap.prepared} 知${cap.known}`); }
  console.log('  '+P(c)+row.join(' | '));
}

console.log('\n— 5. 短/长休资源 —');
for (const lv of [1,3,6,9]) { const q = mk('barbarian',lv,{str:16,con:16}); console.log(`  野蛮人Lv${lv} 狂暴 ${q.rageMax}  5e ${lv>=12?5:lv>=6?4:lv>=3?3:2}`); }
for (const lv of [2,3,5]) { const q = mk('sorcerer',lv,{cha:16}); q.flags.metamagic=true; R.recalc(q); console.log(`  术士Lv${lv} 术法点 ${q.sorceryMax}  5e ${lv}`); }
for (const lv of [1,5]) { const q = mk('monk',lv,{dex:16,wis:16}); console.log(`  武僧Lv${lv} 气 ${q.kiMax}  5e ${lv}`); }
for (const lv of [2,4]) { const q = mk('druid',lv,{wis:16}); console.log(`  德鲁伊Lv${lv} 野性形态 ${q.wildShapeMax} 次（5e 短休即恢复）`); }

console.log('\n— 6. 属性上限 —');
const q = mk('warrior',8,{str:17}); R.chooseAsi(q,{str:2}); console.log(`  力量 17 +2 → ${q.attrs.str}（5e 硬上限 20，此处无钳制）`);

console.log('\n— 7. 闪避动作 —');
const tier = {id:'n',hpMul:1,dmgMul:1,hitAdd:0};
const en = C.makeEncounter({pool:['goblin_cutter'],boss:'goblin_cutter'},'normal',tier, NK.RNG.make(1));
const pl = mk('warrior',5,{str:16,dex:16,con:16});
const cc = C.start(pl, en, {rng: NK.RNG.make(7), tier, act:1, source:'normal', allowSurprise:false});
cc.turn = {action:true,bonus:true,moved:false};
C.playerAction(cc,{type:'dodge'});
C.playerAction(cc, { type: 'dodge' });
const foe = cc.enemies.find((e) => e.hp > 0);
const mode = foe ? C.attackMode(cc, foe, cc.player) : null;
// A3 已修：闪避持续到「你的下个回合开始」，敌人行动期间仍然生效
console.log('  · 闪避后 dodging =', cc.player.dodging, '　敌人打你的掷法 =', mode,
  mode === 'dis' ? '✔ 劣势（5e：闪避让攻击你的检定具有劣势）' : '（未生效）');
C.endPlayerTurn(cc);
console.log('  · 走完一轮回到自己回合后 dodging =', cc.player.dodging,
  cc.player.dodging === false ? '✔ 已清除（5e：持续到你下个回合开始）' : '（未清除）');
