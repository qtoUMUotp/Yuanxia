import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['core.js','data.embedded.js','data.js','rules.js','items.js','combat.js','map.js','events.js','shop.js','codex.js','run.js','ui.js'];
const store={}; const html={innerHTML:'',querySelector:()=>null};
const ctx={console,document:{readyState:'complete',getElementById:()=>html,addEventListener:()=>{},querySelector:()=>null},
 localStorage:{getItem:k=>(k in store?store[k]:null),setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}},
 setTimeout,clearTimeout,addEventListener:()=>{},prompt:(m,d)=>(d||'')};
ctx.window=ctx; ctx.globalThis=ctx; vm.createContext(ctx);
for (const f of FILES) vm.runInContext(readFileSync(join(root,'js',f),'utf8'), ctx, {filename:'js/'+f});
const NK=ctx.NK; await NK.Data.load(); const R=NK.Rules, C=NK.Combat;
const bg0=NK.Data.get('backgrounds').backgrounds[0].id;
const mk=(cls,level,attrs={})=>{const a=Object.assign({str:10,dex:14,con:14,int:10,wis:10,cha:10},attrs);
 const p=R.createPlayer({raceId:'human',bgId:bg0,classId:cls,classes:[{id:cls,level,subclassId:null}],attrs:a,skills:[],equipment:[],name:'T'});R.recalc(p);return p;};

console.log('— A. 升级兼职后是否获得新职业熟练 —');
const p = mk('warrior',1,{str:16});
const before = JSON.stringify(p.proficiencies);
p.classes.push({id:'wizard',level:1,subclassId:null});
R.normalizeClasses(p); R.recalc(p);
console.log('  战士1 熟练:', before);
console.log('  兼职法师1后:', JSON.stringify(p.proficiencies), '（5e 兼职会授予轻/中甲、简易武器、1 项技能等部分熟练）');

console.log('\n— B. 法师9/邪术师1 的最高法术环阶 —');
const w = mk('wizard',9,{int:18,cha:16});
w.classes=[{id:'wizard',level:9,subclassId:null},{id:'warlock',level:1,subclassId:null}];
w.pactSlots=undefined; R.normalizeClasses(w); R.recalc(w);
console.log('  法术位', JSON.stringify(w.slotsMax), ' 契约', w.pactLevel, '环');
console.log('  maxSpellLevel =', R.maxSpellLevel(w), '（法师 9 级应能学/放 5 环）');
console.log('  可学法术池最高环阶 =', Math.max(...R.spellPool(w,false).map(s=>s.level), 0));

console.log('\n— C. 法师9/邪术师1 施法时消耗哪个池 —');
const tier={id:'n',hpMul:1,dmgMul:1,hitAdd:0};
const en=C.makeEncounter({pool:['goblin_cutter'],boss:'goblin_cutter'},'normal',tier,NK.RNG.make(3));
w.cantrips=['fire_bolt']; w.knownSpells=['magic_missile','fireball'];
R.recalc(w);
const cc=C.start(w,en,{rng:NK.RNG.make(7),tier,act:1,source:'normal',allowSurprise:false});
const acts=C.availableActions(cc);
console.log('  可施法列表（前6）:');
for (const s of acts.spells.slice(0,6)) console.log('    ', s.label, '| slot=', s.slot, '| ok=', s.ok);
console.log('  施放火球术前 契约位', cc.player.pactSlots, ' 常规位', JSON.stringify(cc.player.slots));
cc.turn={action:true,bonus:true,moved:false};
C.playerAction(cc,{type:'cast',spellId:'fireball',slot:acts.spells.find(s=>s.spell.id==='fireball').slot,target:en[0].uid});
console.log('  施放火球术后 契约位', cc.player.pactSlots, ' 常规位', JSON.stringify(cc.player.slots));

console.log('\n— D. 专注判定 —');
console.log('  受到伤害时是否有专注豁免？', /concentration/.test(readFileSync(join(root,'js','combat.js'),'utf8').split('damage(')[1]||'') ? '有' : '无（5e 受伤需过 DC10 或半伤的体质豁免）');

console.log('\n— E. 徒手/空手攻击（武僧）—');
const m = mk('monk',5,{dex:18,wis:16,str:10});
console.log('  空手骰 =', R.weaponDice(m), ' 攻击属性 =', R.attackAbility(m,null), '（5e 武僧徒手可用敏捷，骰 1d4→1d6）');
console.log('  伤害加值 =', R.damageBonus(m,null), '（含 monkDmg', m.mods.monkDmg, '）');
