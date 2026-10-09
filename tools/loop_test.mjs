// 临时诊断：跑「完整一局」，no-op 掉 render 以提速，验证规则/流程无死循环
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLOG = join(root, 'tools', 'loop_trace.txt');
writeFileSync(PLOG, '');
const ptrace = (m) => appendFileSync(PLOG, m + '\n');
const FILES = ['core.js', 'data.embedded.js', 'data.js', 'rules.js', 'items.js', 'combat.js', 'map.js', 'events.js', 'shop.js', 'codex.js', 'run.js', 'ui.js'];
const store = {};
const html = { innerHTML: '', querySelector: () => null };
const ctx = {
  console,
  document: { readyState: 'complete', getElementById: () => html, addEventListener: () => {}, querySelector: () => null },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  setTimeout, clearTimeout, addEventListener: () => {}, prompt: (msg, def) => (def || '测试配置'),
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of FILES) { const code = readFileSync(join(root, 'js', f), 'utf8'); vm.runInContext(code, ctx, { filename: 'js/' + f }); }

const NK = ctx.NK;
await NK.Data.load();
const R = NK.Rules;
const UI = NK.UI;
const App = UI.App;
// 关键：跳过重型 UI 渲染，只验证规则/流程
ctx.__NO_RENDER__ = true;

const errors = [];
function step(label, fn) { try { fn(); } catch (e) { errors.push(`${label}: ${e.message}`); console.log(`  ✘ ${label}: ${e.stack.split('\n').slice(0,3).join(' | ')}`); } return errors.length === 0; }

console.log('-- 建卡 --');
step('init', () => UI.init());
step('new', () => UI.act('t:new'));
step('race', () => UI.act('c:race', { id: 'half_orc' }));
step('class', () => UI.act('c:class', { id: 'warrior' }));
step('bg', () => UI.act('c:bg', { id: 'soldier' }));
const c = App.create;
c.attrs = { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 10 };
UI.act('c:skill', { id: 'athletics' }); UI.act('c:skill', { id: 'perception' });
while (['attrs', 'skills'].includes(stepsNow())) UI.act('c:next');
function stepsNow() {
  const cl = c.classId ? R.classDef(c.classId) : null;
  const s = ['race', 'class'];
  if (cl && cl.subclassLevel === 1) s.push('subclass');
  s.push('bg', 'attrs', 'skills');
  if (cl && cl.spellcasting) s.push('spells');
  s.push('pack', 'difficulty');
  return s[c.step];
}
while (stepsNow() === 'pack') UI.act('c:next');
UI.act('c:diff', { id: '1' });
UI.act('c:start');
console.log('  开局: ' + R.classLabel(App.run.player) + ' HP' + App.run.player.maxHp + ' AC' + App.run.player.ac);

console.log('-- 完整一局（render no-op）--');
let guard = 0; const seen = {}; const t0 = Date.now(); let lastT = t0;
while (App.run && !App.run.ended && guard++ < 1500) {
  const s = App.screen;
  seen[s] = (seen[s] || 0) + 1;
  const now = Date.now(); ptrace(`#${guard} screen=${s} dt=${(now - lastT).toFixed(0)}`); lastT = now;
  if (s === 'map') { const av = NK.MapGen.available(App.run); if (!av.length) { errors.push('地图无路可走'); break; } step('node', () => UI.act('node', { id: av[0].id })); }
  else if (s === 'battle') {
    const cc = App.run._combat;
    if (cc.over) { step('continue', () => UI.act('b:continue')); if (errors.length) break; continue; }
    const p = App.run.player;
    if (p.dying) { step('pass', () => UI.act('b:pass')); continue; }
    const a = NK.Combat.autoAction(cc);
    App.targetUid = a.target;   // 模拟真人点击目标（smoke 之前漏传，导致攻击落空、战斗卡死）
    if (a.type === 'cast') step('cast', () => UI.act('b:cast', { id: a.spellId, slot: String(a.slot) }));
    else if (a.type === 'bonus') step('bonus', () => UI.act('b:bonus', { id: a.id }));
    else if (a.type === 'item') step('item', () => UI.act('b:item', { index: String(a.index) }));
    else if (a.type === 'move') step('move', () => UI.act('b:move', { dir: a.dir }));
    else if (a.type === 'attack') step('attack', () => UI.act('b:attack'));
    else step('end', () => UI.act('b:end'));
    if (errors.length) break;
  } else if (s === 'levelup') {
    const p = App.run.player;
    const pend = R.pendingChoices(p)[0];
    if (!pend) { step('done', () => UI.act('l:done')); continue; }
    if (pend.kind === 'subclass') step('sub', () => UI.act('l:subclass', { id: R.classDef(p.classId).subclasses[0].id }));
    else if (pend.kind === 'style') step('style', () => UI.act('l:style', { id: NK.Data.get('rules').fightingStyles[0].id }));
    else if (pend.kind === 'expertise') step('exp', () => UI.act('l:expertise', { id: p.proficiencies.skills[0] }));
    else if (pend.kind === 'asi') step('asi', () => { UI.act('l:attr:add', { k: R.classDef(p.classId).primary }); UI.act('l:attr:add', { k: R.classDef(p.classId).primary }); UI.act('l:asi'); });
    else if (pend.kind === 'classlevel') step('cl', () => UI.act('l:classlevel', { id: p.lastLeveledClassId }));
    else if (pend.kind === 'invocation') step('inv', () => UI.act('l:invocation', { id: NK.Data.get('rules').invocations[0].id }));
    else if (pend.kind === 'metamagic') step('meta', () => UI.act('l:metamagic', { id: NK.Data.get('rules').metamagics[0].id }));
    else if (pend.kind === 'pactBoon') step('pact', () => UI.act('l:pactboon', { id: NK.Data.get('rules').pactBoons[0].id }));
    else { const cls = R.classDef(p.classId); const known = pend.kind === 'cantrips' ? p.cantrips : (cls.spellcasting.prepared ? p.prepared : p.knownSpells); const maxLv = R.maxSpellLevel(p) || 1; const pool = NK.Data.get('spells').spells.filter((x) => x.classes.includes(p.classId) && (pend.kind === 'cantrips' ? x.level === 0 : (x.level >= 1 && x.level <= maxLv)) && !known.includes(x.id)); step('spell', () => UI.act('l:spell', { id: pool[0].id })); }
  } else if (s === 'event') { if (App.run.eventResult) step('evc', () => UI.act('ev:next')); else { const i = App.run.event.options.findIndex((o) => NK.Events.checkRequire(App.run, o).ok); step('evo', () => UI.act('ev:opt', { index: String(i < 0 ? 0 : i) })); } }
  else if (s === 'shop') { step('buy', () => { const e = App.run.shop.items.concat(App.run.shop.consumables).find((x) => !x.sold && App.run.gold >= x.price); if (e) UI.act('buy', { id: e.id }); }); step('leave', () => UI.act('shop:leave')); }
  else if (s === 'rest') { step('rest', () => { const o = NK.Run.restOptions(App.run); const useLong = App.run.player.hp / App.run.player.maxHp < 0.3 && o.long.ok; UI.act(useLong ? 'rest:long' : (o.short.ok ? 'rest:short' : 'rest:none'), { n: '2' }); }); }
  else if (s === 'treasure') { step('tr', () => UI.act('t:continue')); }
  else if (s === 'over') break;
  else break;
}
console.log(`  结束：guard=${guard} t=${((Date.now()-t0)/1000).toFixed(1)}s screen=${App.screen} ended=${App.run && App.run.ended}`);
console.log('  屏幕分布：' + JSON.stringify(seen));
if (App.screen === 'over') { console.log('  ✔ 走到了结算'); }
else { console.log('  ✘ 没走到结算，停在 ' + App.screen); }
if (errors.length) console.log('  错误：\n  ' + errors.join('\n  '));
else console.log('  ✔ 无运行期错误');
