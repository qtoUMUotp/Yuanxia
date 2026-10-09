// 确定性探针：固定种子复现卡死，并同步写轨迹文件（被杀也能读到最后一步）
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SEED = parseInt(process.argv[2] || '1', 10);
const TRACE = join(resolve(dirname(fileURLToPath(import.meta.url))), 'probe_trace.txt');
writeFileSync(TRACE, `SEED=${SEED}\n`);
const tr = (m) => appendFileSync(TRACE, m + '\n');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['core.js', 'data.embedded.js', 'data.js', 'rules.js', 'items.js', 'combat.js', 'map.js', 'events.js', 'shop.js', 'codex.js', 'run.js', 'ui.js'];
const store = {};
const html = { innerHTML: '', querySelector: () => null };
const ctx = {
  console, document: { readyState: 'complete', getElementById: () => html, addEventListener: () => {}, querySelector: () => null },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  setTimeout, clearTimeout, addEventListener: () => {}, prompt: (m, d) => (d || ''),
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of FILES) { const code = readFileSync(join(root, 'js', f), 'utf8'); vm.runInContext(code, ctx, { filename: 'js/' + f }); }
const NK = ctx.NK;
await NK.Data.load();
const R = NK.Rules, UI = NK.UI, App = UI.App;

// 包装关键函数做同步轨迹，定位卡死点
const wrap = (obj, name, label) => { const o = obj[name]; if (typeof o === 'function') obj[name] = function (...a) { tr(`  ⟪${label} START⟫`); const r = o.apply(this, a); tr(`  ⟪${label} END⟫`); return r; }; };
wrap(NK.Run, 'finishBattle', 'finishBattle');
wrap(NK.Rules, 'gainXp', 'gainXp');
wrap(NK.Run, 'checkChoices', 'checkChoices');
wrap(NK.Run, 'save', 'save');
wrap(NK.Run, 'settle', 'settle');
wrap(NK.Codex, 'syncFromRun', 'syncFromRun');
wrap(NK.Codex, 'addRecord', 'addRecord');
wrap(NK.Items, 'loot', 'loot');
wrap(NK.Run, 'grantItem', 'grantItem');
UI.init(); UI.act('t:new');
UI.act('c:race', { id: 'half_orc' });
UI.act('c:class', { id: 'warrior' });
UI.act('c:bg', { id: 'soldier' });
const c = App.create;
c.attrs = { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 10 };
UI.act('c:skill', { id: 'athletics' }); UI.act('c:skill', { id: 'perception' });
function stepsNow() { const cl = c.classId ? R.classDef(c.classId) : null; const s = ['race', 'class']; if (cl && cl.subclassLevel === 1) s.push('subclass'); s.push('bg', 'attrs', 'skills'); if (cl && cl.spellcasting) s.push('spells'); s.push('pack', 'difficulty'); return s[c.step]; }
while (['attrs', 'skills'].includes(stepsNow())) UI.act('c:next');
while (stepsNow() === 'pack') UI.act('c:next');
UI.act('c:diff', { id: '1' }); UI.act('c:start');
App.run.rng = NK.RNG.make(SEED); // 固定种子 → 决定性复现

ctx.__NO_RENDER__ = true;
let guard = 0; const seen = {};
while (App.run && !App.run.ended && guard++ < 1500) {
  const s = App.screen; seen[s] = (seen[s] || 0) + 1;
  let act = '';
  if (s === 'map') { const av = NK.MapGen.available(App.run); if (!av.length) { tr('地图无路@' + guard); break; } act = 'node:' + av[0].type; tr(`#${guard} map → act ${act}`); UI.act('node', { id: av[0].id }); }
  else if (s === 'battle') {
    const cc = App.run._combat;
    if (cc.over) { act = 'b:continue'; tr(`#${guard} battle.over → b:continue`); UI.act('b:continue'); continue; }
    const p = App.run.player; if (p.dying) { act = 'b:pass'; tr(`#${guard} dying → b:pass`); UI.act('b:pass'); continue; }
    const a = NK.Combat.autoAction(cc);
    act = a.type;
    tr(`#${guard} battle ${a.type}${a.target ? ' tgt=' + a.target : ''} ${a.spellId || ''}`);
    if (a.type === 'cast') UI.act('b:cast', { id: a.spellId, slot: String(a.slot) });
    else if (a.type === 'bonus') UI.act('b:bonus', { id: a.id });
    else if (a.type === 'item') UI.act('b:item', { index: String(a.index) });
    else if (a.type === 'move') UI.act('b:move', { dir: a.dir });
    else if (a.type === 'attack') { App.targetUid = a.target; UI.act('b:attack'); }
    else UI.act('b:end');
  } else if (s === 'levelup') {
    const p = App.run.player; const pend = R.pendingChoices(p)[0];
    if (!pend) { act = 'l:done'; tr(`#${guard} levelup.done`); UI.act('l:done'); continue; }
    tr(`#${guard} levelup ${pend.kind}`);
    if (pend.kind === 'subclass') UI.act('l:subclass', { id: R.classDef(p.classId).subclasses[0].id });
    else if (pend.kind === 'style') UI.act('l:style', { id: NK.Data.get('rules').fightingStyles[0].id });
    else if (pend.kind === 'expertise') UI.act('l:expertise', { id: p.proficiencies.skills[0] });
    else if (pend.kind === 'asi') { UI.act('l:attr:add', { k: R.classDef(p.classId).primary }); UI.act('l:attr:add', { k: R.classDef(p.classId).primary }); UI.act('l:asi'); }
    else { const cls = R.classDef(p.classId); const known = pend.kind === 'cantrips' ? p.cantrips : (cls.spellcasting.prepared ? p.prepared : p.knownSpells); const maxLv = R.maxSpellLevel(p) || 1; const pool = NK.Data.get('spells').spells.filter((x) => x.classes.includes(p.classId) && (pend.kind === 'cantrips' ? x.level === 0 : (x.level >= 1 && x.level <= maxLv)) && !known.includes(x.id)); UI.act('l:spell', { id: pool[0].id }); }
  } else if (s === 'event') { if (App.run.eventResult) { act = 'ev:next'; tr(`#${guard} ev:next`); UI.act('ev:next'); } else { const i = App.run.event.options.findIndex((o) => NK.Events.checkRequire(App.run, o).ok); tr(`#${guard} ev:opt ${i}`); UI.act('ev:opt', { index: String(i < 0 ? 0 : i) }); } }
  else if (s === 'shop') { const buy = App.run.shop.items.concat(App.run.shop.consumables).find((x) => !x.sold && App.run.gold >= x.price); if (buy) { tr(`#${guard} buy ${buy.id}`); UI.act('buy', { id: buy.id }); } tr(`#${guard} shop:leave`); UI.act('shop:leave'); }
  else if (s === 'rest') { const o = NK.Run.restOptions(App.run); const useLong = App.run.player.hp / App.run.player.maxHp < 0.3 && o.long.ok; tr(`#${guard} rest ${useLong ? 'long' : (o.short.ok ? 'short' : 'none')}`); UI.act(useLong ? 'rest:long' : (o.short.ok ? 'rest:short' : 'rest:none'), { n: '2' }); }
  else if (s === 'treasure') { tr(`#${guard} t:continue`); UI.act('t:continue'); }
  else if (s === 'over') break;
  else { tr(`#${guard} UNKNOWN screen ${s}`); break; }
}
tr(`DONE guard=${guard} screen=${App.screen} seen=${JSON.stringify(seen)}`);
console.log(`SEED=${SEED} DONE guard=${guard} screen=${App.screen}`);
