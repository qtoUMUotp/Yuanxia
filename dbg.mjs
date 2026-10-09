import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
const root = process.cwd();
const FILES = ['core.js','data.embedded.js','data.js','rules.js','items.js','combat.js','map.js','events.js','shop.js','codex.js','run.js','ui.js'];
const ctx = { console, document:{readyState:'complete',getElementById:()=>null,addEventListener:()=>{},querySelector:()=>null}, localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}}, setTimeout, clearTimeout, addEventListener:()=>{}, prompt:()=> 'x' };
ctx.window = ctx; ctx.globalThis = ctx; vm.createContext(ctx);
for (const f of FILES){ const code=readFileSync(join(root,'js',f),'utf8'); new vm.Script(code,{filename:f}); vm.runInContext(code,ctx,{filename:f}); }
await ctx.NK.Data.load();
const R = ctx.NK.Rules;
for (const cid of ['warrior','wizard','paladin']){
  const p = R.createPlayer({ raceId:'human', classId:cid, bgId:'soldier', attrs:{str:14,dex:14,con:14,int:12,wis:12,cha:12}, skills:['athletics'], cantrips:[], knownSpells:[], prepared:[] });
  R.gainXp(p, 5000);
  let g=0; const log=[];
  while (R.pendingChoices(p).length && g++ < 30){
    const pend = R.pendingChoices(p)[0];
    log.push(pend.kind+':'+pend.level+(pend.classId?('@'+pend.classId):''));
    if (pend.kind==='subclass') R.chooseSubclass(p, R.classDef(cid).subclasses[0].id);
    else if (pend.kind==='style') R.chooseStyle(p, ctx.NK.Data.get('rules').fightingStyles[0].id);
    else if (pend.kind==='expertise'){ const c=p.proficiencies.skills.find(s=>!(p.expertise||[]).includes(s)); if(!c){log.push('NOEXPERT');break;} R.chooseExpertise(p,c); }
    else if (pend.kind==='asi'){ const a={}; a[R.classDef(cid).primary]=2; R.chooseAsi(p,a); }
    else if (pend.kind==='cantrips'){ R.learnSpell(p, ctx.NK.Data.get('spells').spells.find(s=>s.classes.includes(cid)&&s.level===0).id, true, pend.classId); }
    else if (pend.kind==='spells'){ R.learnSpell(p, ctx.NK.Data.get('spells').spells.find(s=>s.classes.includes(cid)&&s.level===1).id, false, pend.classId); }
    else log.push('UNHANDLED'+pend.kind);
  }
  const rem = R.pendingChoices(p).map(x=>x.kind+':'+x.level);
  console.log(cid, 'lvl', p.level, 'resolved', log.join(','), '|| REMAIN', JSON.stringify(rem));
}
