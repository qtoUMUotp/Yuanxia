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
const p = R.createPlayer({ raceId:'human', classId:'wizard', bgId:'soldier', attrs:{str:8,dex:14,con:14,int:15,wis:10,cha:8}, skills:['arcana'], cantrips:['fire_bolt'], knownSpells:[], prepared:[] });
console.log('wizard spellcasting cfg:', JSON.stringify(R.classDef('wizard').spellcasting));
console.log('cap L1', JSON.stringify(R.spellCapacity(p)), 'cantrips', p.cantrips.length);
R.learnSpell(p, 'ray_of_frost', true, 'wizard');
console.log('after learn ray, cantrips', p.cantrips);
console.log('cap now', JSON.stringify(R.spellCapacity(p)));
console.log('pending', JSON.stringify(R.pendingChoices(p).map(x=>x.kind+':'+x.level+':'+x.count)));
