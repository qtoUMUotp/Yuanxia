// 无浏览器冒烟测试：加载全部脚本，走完建卡 → 三幕 → 结算，并断言核心规则
// 用法：node tools/smoke.mjs
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

const errors = [];
for (const f of FILES) {
  const code = readFileSync(join(root, 'js', f), 'utf8');
  try { new vm.Script(code, { filename: 'js/' + f }); vm.runInContext(code, ctx, { filename: 'js/' + f }); }
  catch (e) { errors.push(`${f}: ${e.message}`); console.error(`  ✘ ${f}: ${e.message}`); }
}
if (errors.length) process.exit(1);
console.log(`  ✔ 脚本加载完成（${FILES.length} 个）`);

const NK = ctx.NK;
await NK.Data.load();
const R = NK.Rules;
const UI = NK.UI;
const App = UI.App;

function step(label, fn) {
  try { fn(); } catch (e) { errors.push(`${label}: ${e.message}`); console.error(`  ✘ ${label}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }
  return errors.length === 0;
}

/* ---------- 建卡 ---------- */
console.log('\n-- 建卡向导 --');
step('初始化', () => UI.init());
step('进入建卡', () => UI.act('t:new'));
step('选种族', () => { UI.act('c:race', { id: 'half_orc' }); if (App.create.raceId !== 'half_orc') throw new Error('种族未选中'); });
step('选职业', () => { UI.act('c:class', { id: 'warrior' }); if (App.create.classId !== 'warrior') throw new Error('职业未选中'); });
step('选背景', () => UI.act('c:bg', { id: 'soldier' }));
step('购点校验', () => {
  const c = App.create;
  // 花光 27 点：15/14/14/8/8/8 → 9+7+7+0+0+0 = 23，再补
  c.attrs = { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 10 };
  const cost = R.pointBuyCost(c.attrs);
  if (cost !== 27) throw new Error('购点成本应为 27，实际 ' + cost);
});
step('选技能', () => { UI.act('c:skill', { id: 'athletics' }); UI.act('c:skill', { id: 'perception' }); });
step('下一步到装备', () => { while (['attrs', 'skills'].includes(stepsNow())) UI.act('c:next'); });
function stepsNow() {
  const c = App.create;
  const cls = c.classId ? R.classDef(c.classId) : null;
  const s = ['race', 'class'];
  if (cls && cls.subclassLevel === 1) s.push('subclass');
  s.push('bg', 'attrs', 'skills');
  if (cls && cls.spellcasting) s.push('spells');
  s.push('pack', 'difficulty');
  return s[c.step];
}
step('选装备与难度后开局', () => {
  while (stepsNow() === 'pack') UI.act('c:next');
  if (stepsNow() !== 'difficulty') throw new Error('没有走到难度步骤，停在 ' + stepsNow());
  UI.act('c:diff', { id: '1' });
  UI.act('c:start');
  if (!App.run) throw new Error('没有创建 run');
});
step('角色数值合理', () => {
  const p = App.run.player;
  if (p.maxHp < 12 || p.maxHp > 40) throw new Error('1 级战士最大生命异常: ' + p.maxHp);
  if (p.ac < 12 || p.ac > 20) throw new Error('AC 异常: ' + p.ac);
  if (R.attackBonus(p) < 3) throw new Error('命中加值异常: ' + R.attackBonus(p));
  if (p.proficiencies.skills.length < 3) throw new Error('技能熟练太少: ' + p.proficiencies.skills.join(','));
  if (!p.hitDice || p.hitDice.total !== 1) throw new Error('生命骰异常');
  console.log(`    · ${R.raceDef(p.raceId).name} ${R.classDef(p.classId).name} HP${p.maxHp} AC${p.ac} 命中${R.attackBonus(p)} 伤害${R.weaponDice(p)}+${R.damageBonus(p)} 技能${p.proficiencies.skills.length}项`);
});

/* ---------- 走完一局 ---------- */
console.log('\n-- 完整一局 --');
// 期间跳过重型 UI 渲染（否则每步重建整页 HTML，1500 步要几十分钟）；后续 HTML 断言测试会重新打开渲染
ctx.__NO_RENDER__ = true;
let guard = 0;
const seen = {};
while (App.run && !App.run.ended && guard++ < 1500) {
  const s = App.screen;
  seen[s] = (seen[s] || 0) + 1;
  if (s === 'map') {
    // 没有通关了：走太久还没死就主动收手，保证一定能走到结算
    if (guard > 400) { step('主动收手', () => { UI.act('map:abandon'); UI.act('map:abandon'); }); continue; }
    const av = NK.MapGen.available(App.run);
    if (!av.length) { errors.push('地图无路可走'); break; }
    step('进入节点 ' + av[0].type, () => UI.act('node', { id: av[0].id }));
  } else if (s === 'battle') {
    const c = App.run._combat;
    if (c.over) { step('战斗结束', () => UI.act('b:continue')); if (errors.length) break; continue; }
    const p = App.run.player;
    if (p.dying) { step('濒死等待', () => UI.act('b:pass')); continue; }
    const a = NK.Combat.autoAction(c);
    if (a.type === 'cast') step('施法', () => UI.act('b:cast', { id: a.spellId, slot: String(a.slot) }));
    else if (a.type === 'bonus') step('附赠动作', () => UI.act('b:bonus', { id: a.id }));
    else if (a.type === 'item') step('使用物品', () => UI.act('b:item', { index: String(a.index) }));
    else if (a.type === 'move') step('移动', () => UI.act('b:move', { dir: a.dir }));
    else if (a.type === 'attack') { App.targetUid = a.target; step('攻击', () => UI.act('b:attack')); }
    else step('结束回合', () => UI.act('b:end'));
    if (errors.length) break;
  } else if (s === 'levelup') {
    const p = App.run.player;
    const pend = R.pendingChoices(p)[0];
    if (!pend) { step('升级完成', () => UI.act('l:done')); continue; }
    if (pend.kind === 'classlevel') step('职业进阶', () => UI.act('l:classlevel', { id: p.lastLeveledClassId }));
    else if (pend.kind === 'subclass') step('选子职', () => UI.act('l:subclass', { id: R.classDef(p.classId).subclasses[0].id }));
    else if (pend.kind === 'style') step('选风格', () => UI.act('l:style', { id: NK.Data.get('rules').fightingStyles[0].id }));
    else if (pend.kind === 'expertise') step('选专精', () => UI.act('l:expertise', { id: p.proficiencies.skills[0] }));
    else if (pend.kind === 'asi') {
      step('属性提升', () => {
        UI.act('l:attr:add', { k: R.classDef(p.classId).primary });
        UI.act('l:attr:add', { k: R.classDef(p.classId).primary });
        UI.act('l:asi');
      });
    } else {
      const cls = R.classDef(p.classId);
      const known = pend.kind === 'cantrips' ? p.cantrips : (cls.spellcasting.spellbook ? p.knownSpells : (cls.spellcasting.prepared ? p.prepared : p.knownSpells));
      const maxLv = R.maxSpellLevel(p) || 1;
      const pool = NK.Data.get('spells').spells.filter((x) => x.classes.includes(p.classId) && (pend.kind === 'cantrips' ? x.level === 0 : (x.level >= 1 && x.level <= maxLv)) && !known.includes(x.id));
      step('学法术', () => UI.act('l:spell', { id: pool[0].id }));
    }
  } else if (s === 'event') {
    if (App.run.eventResult) step('事件继续', () => UI.act('ev:next'));
    else {
      const i = App.run.event.options.findIndex((o) => NK.Events.checkRequire(App.run, o).ok);
      step('事件选项', () => UI.act('ev:opt', { index: String(i < 0 ? 0 : i) }));
    }
  } else if (s === 'shop') {
    step('商店购买', () => { const e = App.run.shop.items.concat(App.run.shop.consumables).find((x) => !x.sold && App.run.gold >= x.price); if (e) UI.act('buy', { id: e.id }); });
    step('离开商店', () => UI.act('shop:leave'));
  } else if (s === 'rest') {
    step('短休', () => { const o = NK.Run.restOptions(App.run); const useLong = App.run.player.hp / App.run.player.maxHp < 0.3 && o.long.ok; UI.act(useLong ? 'rest:long' : (o.short.ok ? 'rest:short' : 'rest:none'), { n: '2' }); });
  } else if (s === 'treasure') {
    step('宝库继续', () => UI.act('t:continue'));
  } else if (s === 'over') {
    break;
  } else break;
}
console.log(`  循环 ${guard} 步：${JSON.stringify(seen)}`);
ctx.__NO_RENDER__ = false;
step('走到结算', () => {
  if (App.screen !== 'over') throw new Error('没有走到结算界面，停在 ' + App.screen + ' / state=' + (App.run && App.run.state));
});
step('结算内容', () => {
  if (!App.overSummary) throw new Error('没有结算数据');
  const s = App.overSummary;
  console.log(`    · ${s.victory ? '通关' : '死亡'}（${s.deathCause || '—'}）第 ${s.act} 幕 Lv.${s.level} 击杀 ${s.kills}`);
});

/* ---------- 规则单元测试 ---------- */
console.log('\n-- 规则单元测试 --');
step('熟练加值', () => {
  if (R.profBonus(1) !== 2 || R.profBonus(5) !== 3 || R.profBonus(9) !== 4) throw new Error('熟练加值错误');
});
step('AC 计算（重甲不吃敏捷）', () => {
  const p = R.createPlayer({ raceId: 'dwarf', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 8 }, skills: ['athletics', 'perception'], equipment: [NK.Items.armor('chain_mail')] });
  if (p.ac !== 16) throw new Error('锁子甲 AC 应为 16（不吃敏捷），实际 ' + p.ac);
  // 精灵 dex15+2=17 → +3；皮甲 11+3 = 14
  const p2 = R.createPlayer({ raceId: 'elf', classId: 'rogue', bgId: 'urchin', attrs: { str: 8, dex: 15, con: 14, int: 10, wis: 10, cha: 10 }, skills: [], equipment: [NK.Items.armor('leather_armor')] });
  if (p2.ac !== 14) throw new Error('精灵游荡者皮甲 AC 应为 14（11+3），实际 ' + p2.ac);
  // 无甲法师：奥术护甲 13 + 敏捷 + 2（职业特性）
  const p3 = R.createPlayer({ raceId: 'human', classId: 'wizard', bgId: 'sage', attrs: { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 8 }, skills: [], equipment: [] });
  if (p3.ac !== 17) throw new Error('法师 AC 应为 17（13+3+2，敏捷 15），实际 ' + p3.ac);
  if (R.spellDc(p3) < 13) throw new Error('法术 DC 异常: ' + R.spellDc(p3));
});
step('法术位表', () => {
  const p = R.createPlayer({ raceId: 'human', classId: 'wizard', bgId: 'sage', attrs: { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 8 }, skills: [], cantrips: ['fire_bolt', 'ray_of_frost', 'shocking_grasp'], knownSpells: ['magic_missile'] });
  if (p.slotsMax[0] !== 2) throw new Error('1 级法师应有 2 个一环法术位，实际 ' + p.slotsMax[0]);
  R.gainXp(p, 5000);
  if (p.level < 10) throw new Error('经验结算后应至少 10 级，实际 ' + p.level);
  if (p.slotsMax[2] !== 3) throw new Error('10 级法师三环法术位应为 3，实际 ' + p.slotsMax[2]);
});
step('职业选择队列完整', () => {
  for (const cid of ['warrior', 'rogue', 'ranger', 'cleric', 'wizard', 'paladin', 'sorcerer', 'bard']) {
    const p = R.createPlayer({ raceId: 'human', classId: cid, bgId: 'soldier', attrs: { str: 14, dex: 14, con: 14, int: 12, wis: 12, cha: 12 }, skills: [R.classDef(cid).skillChoices.from[0]], cantrips: [], knownSpells: [], prepared: [] });
    R.gainXp(p, 5000);
    let g = 0;
    while (R.pendingChoices(p).length && g++ < 400) {
      const pend = R.pendingChoices(p)[0];
      if (pend.kind === 'classlevel') R.chooseClassLevel(p, { classId: p.lastLeveledClassId });
      else if (pend.kind === 'subclass') R.chooseSubclass(p, R.classDef(cid).subclasses[0].id);
      else if (pend.kind === 'style') R.chooseStyle(p, NK.Data.get('rules').fightingStyles[0].id);
      else if (pend.kind === 'expertise') {
        const cand = p.proficiencies.skills.find((s) => !(p.expertise || []).includes(s));
        if (!cand) throw new Error('没有可专精的技能了');
        R.chooseExpertise(p, cand);
      }
      else if (pend.kind === 'asi') { const a = {}; a[R.classDef(cid).primary] = 2; R.chooseAsi(p, a); }
      else if (pend.kind === 'invocation') R.chooseInvocation(p, NK.Data.get('rules').invocations[(p.invocations || []).length].id);
      else if (pend.kind === 'metamagic') R.chooseMetamagic(p, NK.Data.get('rules').metamagics[(p.metamagics || []).length].id);
      else if (pend.kind === 'pactBoon') R.choosePactBoon(p, NK.Data.get('rules').pactBoons[0].id);
      else {
        const cls = R.classDef(cid);
        const known = pend.kind === 'cantrips' ? p.cantrips : (cls.spellcasting.spellbook ? p.knownSpells : (cls.spellcasting.prepared ? p.prepared : p.knownSpells));
        const eff = R.spellListOf(cid);
        const pool = NK.Data.get('spells').spells.filter((x) => x.classes.some((c) => eff.includes(c)) && (pend.kind === 'cantrips' ? x.level === 0 : x.level <= (R.maxSpellLevel(p) || 1)) && !known.includes(x.id));
        if (!pool.length) throw new Error(cid + ' 的法术池空了（' + pend.kind + '）');
        R.learnSpell(p, pool[0].id, pend.kind === 'cantrips');
        p.spellChoicesTaken.push(pend.level);
      }
    }
    if (R.pendingChoices(p).length) throw new Error(cid + ' 还有未处理的选择');
    if (!p.subclassId) throw new Error(cid + ' 没有子职');
    console.log(`    · ${R.classDef(cid).name} → ${R.subclassOf(p).name} HP${p.maxHp} AC${p.ac} 命中${R.attackBonus(p)} 法术${R.castableSpells(p).length}个`);
  }
});

/* ---------- 新职业：术士 / 吟游诗人（已知法术模型，验证创建流程选法术 + 施法）---------- */
console.log('\n-- 新职业：术士 / 吟游诗人 --');
function createCaster(cid, raceId, attrs, skills) {
  UI.act('t:new');
  const c = App.create;
  c.raceId = raceId; c.classId = cid; c.bgId = 'soldier';
  c.attrs = Object.assign({}, attrs);
  for (const sk of skills) UI.act('c:skill', { id: sk });
  const cls = R.classDef(cid);
  let g = 0;
  while (stepsNow() !== 'difficulty' && g++ < 30) {
    const s = stepsNow();
    if (s === 'subclass') UI.act('c:subclass', { id: cls.subclasses[0].id });
    else if (s === 'spells') {
      const eff = R.spellListOf(cid);
      const needC = cls.spellcasting.cantrips || 0;
      const needS = cls.spellcasting.knownByLevel ? cls.spellcasting.knownByLevel[0] : 0;
      const cl = NK.Data.get('spells').spells.filter((x) => x.classes.some((k) => eff.includes(k)) && x.level === 0);
      const sl = NK.Data.get('spells').spells.filter((x) => x.classes.some((k) => eff.includes(k)) && x.level === 1);
      while (c.cantrips.length < needC) UI.act('c:cantrip', { id: cl[c.cantrips.length].id });
      while (c.spells.length < needS) UI.act('c:spell', { id: sl[c.spells.length].id });
      if (c.cantrips.length !== needC || c.spells.length !== needS) throw new Error(cid + ' 创建流程法术选择未完成');
    } else UI.act('c:next');
  }
  UI.act('c:diff', { id: '1' });
  UI.act('c:start');
  if (!App.run) throw new Error(cid + ' 创建后没有开局');
  return App.run;
}
step('术士可通过创建向导选法术并开局施法', () => {
  const r = createCaster('sorcerer', 'human', { str: 8, dex: 14, con: 14, int: 10, wis: 10, cha: 15 }, ['arcana', 'insight']);
  const p = r.player;
  if (R.castableSpells(p).length < 4) throw new Error('术士开局可用法术太少: ' + R.castableSpells(p).length);
  if (p.maxHp < 6 || p.maxHp > 20) throw new Error('术士 1 级最大生命异常: ' + p.maxHp);
  const c = NK.Run.startBattle(r, 'normal');
  p.maxHp = 300; p.hp = 300;
  // 自动打几个回合，确保施法动作不崩
  let t = 0;
  while (!c.over && t++ < 25) { NK.Combat.autoPlayerTurn(c); if (c.over) break; NK.Combat.enemyTurn(c, c.enemies.find((e) => !e.dead) || c.enemies[0]); }
  console.log(`    · 术士 ${R.classDef(p.classId).name} HP${p.maxHp} AC${p.ac} 法术${R.castableSpells(p).length}个，开战 ${c.result || '进行中'}`);
});
step('吟游诗人可通过创建向导选法术并开局施法', () => {
  const r = createCaster('bard', 'human', { str: 8, dex: 15, con: 14, int: 10, wis: 10, cha: 15 }, ['performance', 'persuasion', 'arcana']);
  const p = r.player;
  if (R.castableSpells(p).length < 4) throw new Error('吟游诗人开局可用法术太少: ' + R.castableSpells(p).length);
  if (p.skillProfs && p.skillProfs.length < 3) throw new Error('吟游诗人技能熟练太少');
  const c = NK.Run.startBattle(r, 'normal');
  p.maxHp = 300; p.hp = 300;
  let t = 0;
  while (!c.over && t++ < 25) { NK.Combat.autoPlayerTurn(c); if (c.over) break; NK.Combat.enemyTurn(c, c.enemies.find((e) => !e.dead) || c.enemies[0]); }
  console.log(`    · 吟游诗人 ${R.classDef(p.classId).name} HP${p.maxHp} AC${p.ac} 法术${R.castableSpells(p).length}个，开战 ${c.result || '进行中'}`);
});
step('战斗：死亡豁免与恢复', () => {
  const p = R.createPlayer({ raceId: 'human', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 12, con: 15, int: 8, wis: 10, cha: 8 }, skills: [], equipment: [NK.Items.weapon('longsword'), NK.Items.armor('chain_mail')] });
  const rng = NK.RNG.make(3);
  const e = NK.Combat.makeEnemy('goblin_cutter', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
  const c = NK.Combat.start(p, [e], { rng, tier: { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, act: 1, source: 'normal' });
  NK.Combat.autoPlayerTurn(c);
  if (!c.over) throw new Error('自动战斗没有结束');
  if (!['victory', 'defeat', 'fled'].includes(c.result)) throw new Error('战斗结果异常: ' + c.result);
  console.log(`    · 战斗结果 ${c.result}，日志 ${c.log.length} 行`);
});

/* ---------- 存档 / 继续 ---------- */
console.log('\n-- 存档与继续 --');
step('战斗中刷新后继续', () => {
  App.screen = 'title'; App.run = null;
  UI.act('t:new');
  const c = App.create;
  c.raceId = 'human'; c.classId = 'ranger'; c.bgId = 'folk_hero';
  c.attrs = { str: 12, dex: 15, con: 14, int: 10, wis: 12, cha: 8 };
  c.skills = ['perception', 'stealth', 'survival'];
  c.pack = 0; c.difficulty = 1;
  // 直接跳到最后一页
  while (stepsNow() !== 'difficulty') UI.act('c:next');
  UI.act('c:start');
  let n = 0;
  while (App.screen !== 'battle' && n++ < 20) {
    const s = App.screen;
    if (s === 'map') { const av = NK.MapGen.available(App.run); UI.act('node', { id: av[0].id }); }
    else if (s === 'event') { const i = App.run.event.options.findIndex((o) => NK.Events.checkRequire(App.run, o).ok); UI.act('ev:opt', { index: String(i < 0 ? 0 : i) }); }
    else if (s === 'rest') UI.act('rest:none');
    else if (s === 'levelup') { const pend = R.pendingChoices(App.run.player)[0]; if (pend && pend.kind === 'style') UI.act('l:style', { id: NK.Data.get('rules').fightingStyles[0].id }); else UI.act('l:done'); }
    else break;
  }
  if (App.screen !== 'battle') throw new Error('没能进入战斗，停在 ' + App.screen);
  NK.Run.save(App.run);
  if (JSON.parse(store['yuanxia_run_v1']).state !== 'battle') throw new Error('存档状态不是 battle');
  App.run = null; App.screen = 'title'; App.modal = null;
  UI.init();
  if (!html.innerHTML.includes('继续未完成的一局')) throw new Error('标题没有出现继续按钮');
  UI.act('t:continue');
  if (!App.run) throw new Error('没有载入存档');
  UI.render();
  if (!NK.MapGen.available(App.run).length) throw new Error('继续后地图没有可走节点');
});

step('行动会自动写入存档（不依赖手动保存）', () => {
  const run = App.run;
  const p = run.player;
  p.bag.push(NK.Items.mundaneItem('iron_helm'));
  const idx = p.bag.length - 1;
  NK.Run.equip(run, p.bag[idx], 'helm');
  const raw = JSON.parse(store['yuanxia_run_v1']);
  if (!raw || !raw.player) throw new Error('存档结构不对');
  if (!raw.player.items.helm) throw new Error('装备后没有自动存档——刷新会丢装备');
  if (raw.player.items.helm.name !== '铁面盔') throw new Error('存档里的装备不对');
  // 卸下也要存
  NK.Run.unequip(run, 'helm');
  const raw2 = JSON.parse(store['yuanxia_run_v1']);
  if (raw2.player.items.helm) throw new Error('卸下后没有自动存档');
});

/* ---------- 装备效果与装备技能 ---------- */
console.log('\n-- 装备效果与装备技能 --');

function freshWarrior(equip) {
  const p = R.createPlayer({
    raceId: 'dwarf', classId: 'warrior', bgId: 'soldier',
    attrs: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 8 }, skills: ['athletics', 'perception'],
    equipment: [NK.Items.weapon('longsword'), NK.Items.armor('chain_mail')].concat(equip || []),
  });
  return p;
}

step('种族抗性生效', () => {
  const p = freshWarrior();
  if (!p.resist.includes('毒素')) throw new Error('矮人应该有毒素抗性，实际 ' + JSON.stringify(p.resist));
  const elf = R.createPlayer({ raceId: 'tiefling', classId: 'wizard', bgId: 'sage', attrs: { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 8 }, skills: [] });
  if (!elf.resist.includes('火焰')) throw new Error('提夫林应该有火焰抗性');
});

step('装备抗性生效（战斗结算减半）', () => {
  const p = freshWarrior();
  p.items.rings.push(NK.Items.magic('ash_ward_ring'));
  R.recalc(p);
  if (!p.resist.includes('火焰')) throw new Error('灰烬护环应该给火焰抗性，实际 ' + JSON.stringify(p.resist));
  const rng = NK.RNG.make(5);
  const e = NK.Combat.makeEnemy('goblin_cutter', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
  const c = NK.Combat.start(p, [e], { rng, tier: { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, act: 1, source: 'normal', allowSurprise: false });
  const before = p.hp;
  NK.Combat.damage(c, p, 10, '火焰', e);
  const taken = before - p.hp;
  if (taken !== 5) throw new Error('火焰抗性应该把 10 点减到 5，实际 ' + taken);
  const before2 = p.hp;
  NK.Combat.damage(c, p, 10, '挥砍', e);
  if (before2 - p.hp !== 10) throw new Error('挥砍不该被减免');
});

step('装备技能被收集并可用', () => {
  const p = freshWarrior();
  p.items.helm = NK.Items.magic('steadfast_helm');
  R.recalc(p);
  if (!(p.itemAbilities || []).find((a) => a.id === 'clear_mind')) throw new Error('定神盔的技能没有被收集');
  const rng = NK.RNG.make(9);
  const e = NK.Combat.makeEnemy('goblin_cutter', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
  const c = NK.Combat.start(p, [e], { rng, tier: { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, act: 1, source: 'normal', allowSurprise: false });
  // 先让玩家中一个状态，看技能是否清除
  NK.Combat.addCond(c, p, { id: 'frightened', name: '恐惧', turns: 2 });
  const acts = NK.Combat.availableActions(c);
  const entry = acts.bonus.find((b) => b.id === 'item:clear_mind');
  if (!entry) throw new Error('定神没有出现在附赠动作里：' + acts.bonus.map((b) => b.id).join(','));
  NK.Combat.playerAction(c, { type: 'bonus', id: 'item:clear_mind' });
  if (p.conditions.some((x) => x.id === 'frightened')) throw new Error('定神没有清除恐惧');
  if (c.playerStats.dmgDealt) { /* 不检查伤害 */ }
  const again = NK.Combat.availableActions(c).bonus.find((b) => b.id === 'item:clear_mind');
  if (again) throw new Error('定神应该每场战斗只能用一次');
});

step('回息之冠：被动复活', () => {
  const p = freshWarrior();
  p.items.helm = NK.Items.magic('crown_of_second_breath');
  R.recalc(p);
  if (!p.itemPassives.second_breath) throw new Error('回息之冠的被动没有被识别');
  if (!p.resist.includes('毒素') || !p.resist.includes('暗蚀')) throw new Error('回息之冠的抗性没生效');
  const rng = NK.RNG.make(11);
  const e = NK.Combat.makeEnemy('goblin_cutter', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
  const c = NK.Combat.start(p, [e], { rng, tier: { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, act: 1, source: 'normal', allowSurprise: false });
  NK.Combat.damage(c, p, p.hp + 5, '挥砍', e);   // 5：巨量伤害即死已实装，溢出 ≥ 最大生命会直接死
  if (p.hp !== 1) throw new Error('回息之冠应该以 1 HP 站起，实际 HP ' + p.hp);
  if (c.over) throw new Error('不应该判定死亡');
});

step('魔法武器无视物理抗性', () => {
  const p = freshWarrior();
  p.items.mainHand = NK.Items.magic('flame_tongue');
  R.recalc(p);
  if (!p.items.mainHand.magic) throw new Error('魔法武器标记丢失');
  const rng = NK.RNG.make(13);
  const e = NK.Combat.makeEnemy('treant_sapling', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
  const c = NK.Combat.start(p, [e], { rng, tier: { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, act: 1, source: 'normal', allowSurprise: false });
  e.maxHp = 200; e.hp = 200;   // 抬高血量，避免一次打死影响测量
  const before = e.hp;
  NK.Combat.damage(c, e, 10, '穿刺', p, { weapon: p.items.mainHand });
  if (before - e.hp !== 10) throw new Error('魔法武器的穿刺伤害不该被树精抗性减半，实际 ' + (before - e.hp));
  const before2 = e.hp;
  NK.Combat.damage(c, e, 10, '穿刺', p, { weapon: NK.Items.weapon('dagger') });
  if (before2 - e.hp !== 5) throw new Error('非魔法武器应该被减半，实际 ' + (before2 - e.hp));
});

step('装备面板列出效果', () => {
  const p = freshWarrior([NK.Items.magic('flame_tongue')]);
  p.items.mainHand = NK.Items.magic('flame_tongue');
  const eff = NK.Items.effects(p.items.mainHand);
  const texts = eff.map((e) => e.text).join(' | ');
  if (!texts.includes('火焰')) throw new Error('装备效果里没有额外伤害：' + texts);
  if (!eff.some((e) => e.kind === 'onhit')) throw new Error('缺少命中特效条目');
  const helm = NK.Items.magic('steadfast_helm');
  if (!NK.Items.effects(helm).some((e) => e.kind === 'skill')) throw new Error('装备技能没有被列出来');
  if (!NK.Items.describe(helm).includes('定神')) throw new Error('describe 没有包含装备技能');
});

/* ---------- 休息不设上限 ---------- */
console.log('\n-- 休息（不设次数上限）--');
step('短休受生命骰限制，长休不限次', () => {
  const r = NK.Run.start({ rng: NK.RNG.make(3), raceId: 'dwarf', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 8 }, skills: ['athletics', 'perception'], pack: 0, difficulty: 1, name: 'T', equipment: [NK.Items.weapon('longsword'), NK.Items.armor('chain_mail')] });
  if (r.rest) throw new Error('不应该再有休息次数计数器');
  const p = r.player;
  p.hp = 1;
  const before = p.hitDice.left;
  const res = NK.Run.restShort(r, 1);
  if (!res.ok) throw new Error('短休失败：' + res.msg);
  if (p.hitDice.left !== before - 1) throw new Error('生命骰没有扣减：' + before + ' → ' + p.hitDice.left);
  if (p.hp <= 1) throw new Error('短休没有回血');
  // 把生命骰用光后再短休应该失败，但长休仍然可以
  if (p.hitDice.left > 0) NK.Run.restShort(r, p.hitDice.left);
  if (p.hitDice.left !== 0) throw new Error('生命骰应该用光了');
  if (NK.Run.restOptions(r).short.ok) throw new Error('没有生命骰时不该还能短休');
  if (!NK.Run.restOptions(r).long.ok) throw new Error('长休不应该被次数限制');
  const lr = NK.Run.restLong(r);
  if (!lr.ok) throw new Error('长休失败：' + lr.msg);
  if (p.hp !== p.maxHp) throw new Error('长休没有回满生命');
  if (p.hitDice.left <= 0) throw new Error('长休没有恢复生命骰');
  // 第二次长休照样可以
  if (!NK.Run.restLong(r).ok) throw new Error('第二次长休应该仍然可用');
});

/* ---------- 角色配置存档 ---------- */
console.log('\n-- 角色配置保存 / 读取 --');
step('保存后可在标题界面直接开局', () => {
  UI.init();
  UI.act('t:new');
  const c = App.create;
  c.raceId = 'elf'; c.classId = 'ranger'; c.bgId = 'folk_hero';
  c.attrs = { str: 12, dex: 15, con: 14, int: 10, wis: 12, cha: 8 };
  c.bonusChoice = { str: 1, con: 1 };
  c.skills = ['perception', 'stealth', 'survival'];
  c.cantrips = []; c.spells = ['hunter_mark']; c.pack = 0; c.difficulty = 2; c.name = '测试游侠';
  UI.act('b:save');
  const list = JSON.parse(store['yuanxia_builds_v1'] || '[]');
  if (!list.length) throw new Error('没有写入配置存档');
  if (list[0].name !== '测试游侠' || list[0].difficulty !== 2) throw new Error('配置内容不对：' + JSON.stringify(list[0]));
  // 模拟重新打开页面：App 被重建，只剩 localStorage
  App.run = null; App.create = null; App.screen = 'title'; App.modal = null;
  UI.init();
  if (!html.innerHTML.includes('测试游侠')) throw new Error('标题界面没有列出保存的配置');
  const id = list[0].id;
  UI.act('t:quickstart', { id });
  if (!App.run) throw new Error('用配置开局失败');
  const p2 = App.run.player;
  if (p2.classId !== 'ranger' || p2.raceId !== 'elf') throw new Error('开局的角色不对');
  if (App.run.difficulty !== 2) throw new Error('难度没有沿用');
  if (!['perception', 'stealth', 'survival'].every((s) => p2.proficiencies.skills.includes(s))) throw new Error('技能熟练没有沿用：' + p2.proficiencies.skills.join(','));
  if (R.castableSpells(p2).length < 1) throw new Error('法术没有沿用');
  console.log(`    · 复用配置开局：${R.raceDef(p2.raceId).name} ${R.classDef(p2.classId).name} Lv.${p2.level} HP${p2.maxHp} AC${p2.ac} 难度${App.run.difficulty}`);
  // 上一局记录
  if (!store['yuanxia_lastbuild_v1']) throw new Error('没有记录上次使用的配置');
  UI.act('t:delbuild', { id });
  if (JSON.parse(store['yuanxia_builds_v1'] || '[]').length !== 0) throw new Error('删除配置失败');
});

/* ---------- 下拉式动作 ---------- */
console.log('\n-- 战斗动作下拉框 --');
step('下拉框选择并执行法术', () => {
  const p = R.createPlayer({
    raceId: 'human', classId: 'wizard', bgId: 'sage',
    attrs: { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 8 }, skills: [],
    cantrips: ['fire_bolt'], knownSpells: ['magic_missile'], equipment: [],
  });
  const r = NK.Run.start({ rng: NK.RNG.make(21), raceId: 'human', classId: 'wizard', bgId: 'sage', attrs: { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 8 }, skills: [], cantrips: ['fire_bolt'], spells: ['magic_missile'], pack: 0, difficulty: 1, name: 'W', equipment: [], knownSpells: ['magic_missile'] });
  NK.Run._soul = null;
  App.run = r; App.screen = 'battle'; App.modal = null; App.selAction = 0;
  const c = NK.Run.startBattle(r, 'normal');
  if (!c) throw new Error('战斗没有开始');
  UI.render();
  const htmlStr = html.innerHTML;
  if (!htmlStr.includes('sel:action')) throw new Error('战斗界面没有渲染下拉框');
  // 下拉框的第一项应该是伤害法术（戏法或法术）
  const opts = [];
  const acts = NK.Combat.availableActions(c);
  for (const s of acts.spells) if (s.ok) opts.push({ kind: 'spell', id: s.spell.id, slot: s.slot });
  if (!opts.length) throw new Error('法师没有可用法术');
  App.selAction = 0;
  const before = c.enemies[0].hp;
  UI.act('b:do');
  if (c.enemies[0].hp >= before && c.log.filter((l) => l.k === 'dmg').length === 0) throw new Error('执行下拉框动作没有产生效果');
});

step('已经移除脱离战斗', () => {
  const src = readFileSync(join(root, 'js', 'combat.js'), 'utf8');
  if (/allowFlee|result === 'fled'|'flee'/.test(src)) throw new Error('combat.js 里还残留脱离战斗');
  const ui = readFileSync(join(root, 'js', 'ui.js'), 'utf8');
  if (ui.includes('b:flee')) throw new Error('ui.js 里还有脱离战斗按钮');
});

/* ---------- 新装备槽 / 双手武器 / 双持 / 戒指 / 护甲惩罚 ---------- */
console.log('\n-- 装备槽位与武器规则 --');

step('十个装备槽位齐全', () => {
  const p = freshWarrior();
  const slots = NK.Items.SLOTS.map((s) => s.id);
  for (const s of ['mainHand', 'offHand', 'body', 'legs', 'neck', 'helm', 'bracers', 'greaves', 'boots', 'rings']) {
    if (!slots.includes(s)) throw new Error('缺少槽位 ' + s);
    if (s !== 'rings' && !(s in p.items)) throw new Error('玩家对象缺少槽位 ' + s);
  }
  if (!Array.isArray(p.items.rings)) throw new Error('戒指应该是数组');
});

step('双手武器占用左右手', () => {
  const p = freshWarrior();
  p.items.offHand = NK.Items.weapon('dagger');
  R.recalc(p);
  const great = NK.Items.magic('frostbite_greatsword');
  if (great.hands !== 2) throw new Error('霜噬巨剑应该是双手武器');
  if (R.canEquip(p, great, 'offHand').ok) throw new Error('双手武器不能装到左手');
  const r = NK.Run.start({ rng: NK.RNG.make(7), raceId: 'dwarf', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 8 }, skills: [], pack: 0, difficulty: 1, name: 'T', equipment: [] });
  const pl = r.player;
  pl.bag.push(NK.Items.weapon('longsword'), NK.Items.weapon('dagger'), NK.Items.weapon('greatsword'));
  NK.Run.equip(r, pl.bag[0], 'mainHand');
  NK.Run.equip(r, pl.bag[0], 'offHand');
  if (!pl.items.offHand) throw new Error('副手装备失败');
  const res = NK.Run.equip(r, pl.bag[0], 'mainHand');   // 装巨剑
  if (!res.ok) throw new Error('应该能装双手武器：' + res.msg);
  if (pl.items.offHand) throw new Error('双手武器上身后左手必须空出来');
  if (R.canEquip(pl, NK.Items.weapon('dagger'), 'offHand').ok) throw new Error('右手是双手武器时左手不该能装东西');
});

step('右手单手武器 = 单手骰；左手空了才吃双手骰', () => {
  const p = freshWarrior();
  p.items.mainHand = NK.Items.weapon('longsword');
  p.items.offHand = null;
  R.recalc(p);
  if (R.weaponDice(p) !== '1d10') throw new Error('空左手时长剑应使用双手骰 1d10，实际 ' + R.weaponDice(p));
  p.items.offHand = NK.Items.weapon('dagger');
  R.recalc(p);
  if (R.weaponDice(p) !== '1d8') throw new Error('左手有武器时长剑应回到单手骰 1d8，实际 ' + R.weaponDice(p));
});

step('副手攻击：附赠动作 + 不加属性调整值', () => {
  const p = freshWarrior();
  p.items.mainHand = NK.Items.weapon('longsword');
  p.items.offHand = NK.Items.weapon('dagger');
  R.recalc(p);
  const rng = NK.RNG.make(31);
  const e = NK.Combat.makeEnemy('goblin_cutter', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
  e.maxHp = 300; e.hp = 300;
  const c = NK.Combat.start(p, [e], { rng, tier: { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, act: 1, source: 'normal' });
  e.band = 0;   // 贴身距离，副手攻击才够得到
  const acts = NK.Combat.availableActions(c);
  if (!acts.bonus.find((b) => b.id === 'offhand')) throw new Error('左手有武器时应该出现「副手攻击」：' + acts.bonus.map((b) => b.id).join(','));
  const mainBonus = R.damageBonus(p, p.items.mainHand);
  const offBonus = R.damageBonus(p, p.items.offHand, { offhand: true });
  if (offBonus >= mainBonus) throw new Error(`副手伤害加值应低于主手（主 ${mainBonus} / 副 ${offBonus}）`);
  NK.Combat.playerAction(c, { type: 'bonus', id: 'offhand' });
  if (c.turn.bonus) throw new Error('副手攻击应该消耗附赠动作');
  if (!c.log.some((l) => l.t.includes('副手攻击'))) throw new Error('日志里没有副手攻击');
});

step('戒指上限与能量干涉', () => {
  const r = NK.Run.start({ rng: NK.RNG.make(41), raceId: 'dwarf', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 8 }, skills: [], pack: 0, difficulty: 1, name: 'T', equipment: [] });
  const pl = r.player;
  if (R.ringCap(pl) !== 1) throw new Error('默认戒指上限应为 1，实际 ' + R.ringCap(pl));
  pl.bag = [NK.Items.mundaneItem('copper_ring'), NK.Items.mundaneItem('iron_ring')];
  if (!NK.Run.equip(r, pl.bag[0], 'rings').ok) throw new Error('第一枚戒指应该能戴上');
  if (NK.Run.equip(r, pl.bag[0], 'rings').ok) throw new Error('默认上限 1 时不该能戴第二枚');
  if (R.interference(pl) !== 0) throw new Error('1 枚戒指不该有干涉');
  pl.buffs.push({ kind: 'buff', turns: null, name: '戒指容量', mods: { ringSlots: 3 } });
  R.recalc(pl);
  if (R.ringCap(pl) !== 4) throw new Error('上限应为 4，实际 ' + R.ringCap(pl));
  pl.bag.push(NK.Items.mundaneItem('iron_ring'), NK.Items.mundaneItem('copper_ring'));
  NK.Run.equip(r, pl.bag[0], 'rings');
  NK.Run.equip(r, pl.bag[0], 'rings');
  if (R.ringCount(pl) !== 3) throw new Error('应该戴上了 3 枚，实际 ' + R.ringCount(pl));
  if (R.interference(pl) !== 2) throw new Error('3 枚戒指干涉应为 -2，实际 ' + R.interference(pl));
  const hitWith = R.attackBonus(pl);
  const saveWith = R.saveBonus(pl, 'wis');
  NK.Run.unequip(r, 'rings', 0);
  if (R.attackBonus(pl) !== hitWith + 1) throw new Error(`卸下一枚戒指后命中应 +1：${hitWith} → ${R.attackBonus(pl)}`);
  if (R.saveBonus(pl, 'wis') !== saveWith + 1) throw new Error('卸下一枚戒指后豁免也应 +1');
  console.log(`    · 3 枚戒指：命中 ${hitWith}、感知豁免 ${saveWith}（干涉 -2），上限 ${R.ringCap(pl)}`);
});

step('护甲熟练与惩罚', () => {
  const wiz = R.createPlayer({ raceId: 'human', classId: 'wizard', bgId: 'sage', attrs: { str: 10, dex: 14, con: 14, int: 15, wis: 10, cha: 8 }, skills: [], equipment: [NK.Items.armor('chain_mail')], cantrips: ['fire_bolt'] });
  const pen = R.armorPenalty(wiz);
  if (!pen.badArmor || !pen.noSpellcasting) throw new Error('法师穿锁子甲应该触发未熟练惩罚');
  if (R.saveMode(wiz, 'dex') !== 'dis') throw new Error('未熟练护甲应让敏捷豁免劣势');
  if (R.saveMode(wiz, 'wis') !== null) throw new Error('未熟练护甲不该影响感知豁免');
  const rng = NK.RNG.make(51);
  const e = NK.Combat.makeEnemy('goblin_cutter', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
  const c = NK.Combat.start(wiz, [e], { rng, tier: { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, act: 1, source: 'normal' });
  if (NK.Combat.availableActions(c).spells.length) throw new Error('未熟练护甲下不该列出任何法术');
  NK.Combat.playerAction(c, { type: 'cast', spellId: 'fire_bolt', slot: 0 });
  if (!c.log.some((l) => l.t.includes('无法施法'))) throw new Error('应该提示无法施法');
  const w = freshWarrior();
  if (R.armorPenalty(w).badArmor) throw new Error('战士穿锁子甲是熟练的，不该有惩罚');
  const weak = R.createPlayer({ raceId: 'halfling', classId: 'warrior', bgId: 'soldier', attrs: { str: 8, dex: 14, con: 14, int: 8, wis: 10, cha: 8 }, skills: [], equipment: [NK.Items.armor('plate_armor')] });
  if (!weak.acPenalty.heavyStrPenalty) throw new Error('力量不足应该被标记');
  const plate = R.createPlayer({ raceId: 'dwarf', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 8 }, skills: [], equipment: [NK.Items.armor('plate_armor')] });
  if (plate.ac !== 18) throw new Error('力量 15 穿板甲 AC 应为 18，实际 ' + plate.ac);
});

step('新槽位饰品生效', () => {
  const p = freshWarrior();
  const baseAc = p.ac; const baseHp = p.maxHp;
  p.items.helm = NK.Items.mundaneItem('iron_helm');
  p.items.bracers = NK.Items.mundaneItem('iron_bracers');
  p.items.greaves = NK.Items.mundaneItem('iron_greaves');
  p.items.legs = NK.Items.mundaneItem('leather_legs');
  p.items.boots = NK.Items.mundaneItem('soft_boots');
  R.recalc(p);
  if (p.ac <= baseAc) throw new Error('铁面盔+铁护腕+铁护胫 应该提高 AC');
  if (p.maxHp <= baseHp) throw new Error('皮护腿裤应该提高最大生命');
});

/* ---------- 食物与休息 ---------- */
console.log('\n-- 食物与营地休息 --');
step('长休消耗食物，没食物就不能长休', () => {
  const r = NK.Run.start({ rng: NK.RNG.make(61), raceId: 'dwarf', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 8 }, skills: [], pack: 0, difficulty: 1, name: 'T', equipment: [] });
  const p = r.player;
  if (typeof r.food !== 'number') throw new Error('开局应该有食物计数');
  r.food = 0; p.hp = 1;
  if (NK.Run.restOptions(r).long.ok) throw new Error('没有食物时长休不该可用');
  if (NK.Run.restLong(r).ok) throw new Error('没有食物时长休应该失败');
  if (p.hp === p.maxHp) throw new Error('失败的长休不该回血');
  r.food = 2;
  if (!NK.Run.restOptions(r).long.ok) throw new Error('有食物时应该能长休');
  const ok = NK.Run.restLong(r);
  if (!ok.ok) throw new Error('长休失败：' + ok.msg);
  if (r.food !== 1) throw new Error('长休应该消耗 1 份食物，剩余 ' + r.food);
  if (p.hp !== p.maxHp) throw new Error('长休应该回满血');
});

step('战斗掉落食物', () => {
  let dropped = 0;
  for (let i = 0; i < 30; i++) {
    const rr = NK.Run.start({ rng: NK.RNG.make(200 + i), raceId: 'dwarf', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 8 }, skills: [], pack: 0, difficulty: 1, name: 'T', equipment: [] });
    const c = NK.Run.startBattle(rr, 'elite');
    c.enemies.forEach((e) => { e.hp = 0; });
    c.over = true; c.result = 'victory';
    NK.Run.finishBattle(rr);
    if (rr.food > 3) dropped += 1;
  }
  if (dropped < 29) throw new Error('精英战应该稳定掉食物，30 局里只有 ' + dropped + ' 次');
});

step('已经移除脱离战斗', () => {
  const src = readFileSync(join(root, 'js', 'combat.js'), 'utf8');
  if (/allowFlee|result === 'fled'|'flee'/.test(src)) throw new Error('combat.js 里还残留脱离战斗');
  if (readFileSync(join(root, 'js', 'ui.js'), 'utf8').includes('b:flee')) throw new Error('ui.js 里还有脱离战斗按钮');
});

step('没有残留旧装备槽字段', () => {
  const bad = [];
  for (const f of ['core.js', 'rules.js', 'items.js', 'combat.js', 'events.js', 'shop.js', 'codex.js', 'run.js', 'ui.js']) {
    const src = readFileSync(join(root, 'js', f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\.items\.(weapon|armor|shield|trinket)\b/.test(line)) bad.push(`${f}:${i + 1} ${line.trim()}`);
    });
  }
  if (bad.length) throw new Error('还在用旧槽位字段 p.items.weapon/armor/shield/trinket：\n      ' + bad.join('\n      '));
});

/* ---------- 距离机制 ---------- */
console.log('\n-- 距离机制 --');
function fieldBattle(classId, extra) {
  const rng = NK.RNG.make(101 + (extra || 0));
  const p = classId === 'wizard'
    ? R.createPlayer({ raceId: 'human', classId: 'wizard', bgId: 'sage', attrs: { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 8 }, skills: [], cantrips: ['fire_bolt'], knownSpells: ['magic_missile'] })
    : R.createPlayer({ raceId: 'human', classId: 'ranger', bgId: 'folk_hero', attrs: { str: 12, dex: 15, con: 14, int: 10, wis: 12, cha: 8 }, skills: [], equipment: [NK.Items.weapon('longbow'), NK.Items.weapon('longsword')] });
  const e = NK.Combat.makeEnemy('goblin_cutter', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
  const ranged = NK.Combat.makeEnemy('goblin_shaman', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
  p.maxHp = 400; p.hp = 400;   // 抬高血量，专注测机制而不是测生死
  const c = NK.Combat.start(p, [e, ranged], { rng, tier: { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, act: 1, source: 'normal', allowSurprise: false });
  return { c, p, melee: e, ranged };
}

step('开战距离：近战怪压近、远程怪站远、伏击者贴脸', () => {
  const mk = (id) => NK.Combat.makeEnemy(id, { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, NK.RNG.make(7));
  const gob = mk('goblin_cutter');
  const sham = mk('goblin_shaman');
  const wolf = mk('bog_wolf');
  if (NK.Combat.initialBand(gob, false) !== 1) throw new Error('近战怪初始应为「中距」，实际 ' + NK.Combat.initialBand(gob, false));
  if (NK.Combat.initialBand(sham, false) !== 2) throw new Error('远程怪初始应为「远距」');
  if (NK.Combat.initialBand(wolf, false) !== 0) throw new Error('伏击者初始应该贴脸');
  if (NK.Combat.initialBand(gob, true) !== 2) throw new Error('被偷袭时近战怪应该还在远距');
  if (NK.Combat.initialBand(sham, true) !== 2) throw new Error('距离上限就是远距');
  if (sham.range !== 'ranged' || gob.range !== 'melee') throw new Error('怪物射程标记不对');
});

step('近战武器够不到中距，远程武器可以', () => {
  const { p, melee } = fieldBattle('ranger');
  const sword = NK.Items.weapon('longsword');
  const bow = NK.Items.weapon('longbow');
  melee.band = 1;
  if (NK.Combat.canReach(p, melee, sword)) throw new Error('长剑不该够得到中距的敌人');
  if (!NK.Combat.canReach(p, melee, bow)) throw new Error('长弓应该够得到中距');
  melee.band = 0;
  if (!NK.Combat.canReach(p, melee, sword)) throw new Error('贴身后长剑应该够得到');
  const halberd = NK.Items.weapon('halberd');
  melee.band = 1;
  if (!NK.Combat.canReach(p, melee, halberd)) throw new Error('长戟有「触及」，中距也能打');
  melee.band = 2;
  if (NK.Combat.canReach(p, melee, halberd)) throw new Error('触及也够不到远距');
});

step('移动：每回合一次，改变所有敌人的距离', () => {
  const { c, p } = fieldBattle('ranger');
  const before = c.enemies.map((e) => e.band);
  NK.Combat.move(c, 'in');
  if (c.turn.moved !== true) throw new Error('移动后应该标记已移动');
  if (c.enemies.some((e, i) => e.band !== Math.max(0, before[i] - 1))) throw new Error('接近没有生效');
  const mid = c.enemies.map((e) => e.band);
  NK.Combat.move(c, 'in');
  if (c.enemies.some((e, i) => e.band !== mid[i])) throw new Error('同一回合不该能移动两次');
  // 新回合又能移动
  c.turn.moved = false;
  NK.Combat.move(c, 'out');
  if (c.enemies.some((e, i) => e.band !== Math.min(2, mid[i] + 1))) throw new Error('拉开没有生效');
});

step('远程攻击在近身距离有劣势', () => {
  const { c, p, melee } = fieldBattle('ranger');
  p.conditions = []; // 隔离测试：本用例只验证「距离」带来的劣势，先清掉开局可能被敌人施加的状态（如目盲）
  melee.band = 0;
  p.items.mainHand = NK.Items.weapon('longbow');
  if (NK.Combat.attackMode(c, p, melee, { ranged: true }) !== 'dis') throw new Error('近身射箭应该是劣势');
  melee.band = 1;
  if (NK.Combat.attackMode(c, p, melee, { ranged: true }) === 'dis') throw new Error('中距射箭不该有劣势');
  // 近战武器不受距离惩罚
  if (NK.Combat.attackMode(c, p, melee) === 'dis') throw new Error('长剑不该因为距离吃劣势');
});

step('近战怪冲锋：一轮扑到面前但这一轮不攻击', () => {
  const { c, melee } = fieldBattle('ranger');
  melee.band = 2;
  c.turnIndex = c.order.findIndex((o) => o.ref === melee);
  const hpBefore = c.player.hp;
  melee.intent = null;
  NK.Combat.enemyTurn(c, melee);
  if (melee.band !== 0) throw new Error('冲锋应该扑到近身，实际 band=' + melee.band);
  if (c.player.hp !== hpBefore) throw new Error('冲锋的那一轮不该造成伤害');
});

step('远程怪不会主动逼近', () => {
  const { c, ranged } = fieldBattle('ranger');
  ranged.band = 2;
  ranged.intent = null;
  NK.Combat.enemyTurn(c, ranged);
  if (ranged.band !== 2) throw new Error('远程怪不该移动，实际 band=' + ranged.band);
});

/* ---------- 行动顺序 ---------- */
console.log('\n-- 行动顺序 --');
step('延后行动：把自己移到本回合最后，且这一轮仍然能行动', () => {
  const { c, p } = fieldBattle('ranger');
  c.order = [{ ref: p, init: 20, name: '你' }].concat(c.order.filter((o) => o.ref !== p));
  c.turnIndex = 0;
  c.turn = { action: true, bonus: true, moved: false };
  const roundBefore = c.round;
  const acted = [];
  NK.Combat.delayTurn(c);
  if (c.order[c.order.length - 1].ref !== p) throw new Error('延后之后玩家应该排在最后');
  if (c.delayedThisRound !== true) throw new Error('没有标记本回合已延后');
  if (c.over) throw new Error('不该战斗结束');
  if (c.round !== roundBefore) throw new Error(`延后不该推进回合数（${roundBefore} → ${c.round}）`);
  if (!(c.order[c.turnIndex] && c.order[c.turnIndex].ref === p)) throw new Error('延后后应该在同一回合内再轮到玩家，实际轮到 ' + (c.order[c.turnIndex] || {}).name);
  // 原本排在玩家后面的敌人不应该被跳过
  const enemyActs = c.log.filter((l) => /▶ .+使用了|向你冲过来|向你逼近|受到/.test(l.t)).length;
  if (enemyActs === 0) throw new Error('延后之后敌人应该照常行动');
});

step('已经排在最后时不能延后', () => {
  const { c, p } = fieldBattle('ranger');
  c.order = c.order.filter((o) => o.ref !== p).concat([{ ref: p, init: -99, name: '你' }]);
  c.turnIndex = c.order.length - 1;
  c.turn = { action: true, bonus: true, moved: false };
  const before = c.order.map((o) => o.name).join(',');
  NK.Combat.delayTurn(c);
  if (c.order.map((o) => o.name).join(',') !== before) throw new Error('排最后时不该改变顺序');
  if (c.delayedThisRound) throw new Error('失败时不该标记已延后');
  if (!c.log.some((l) => l.t.includes('已经排在本回合最后'))) throw new Error('应该提示已经排在最后');
});

step('延后每回合只能一次', () => {
  const { c, p } = fieldBattle('ranger');
  c.turn = { action: true, bonus: true, moved: false };
  NK.Combat.delayTurn(c);
  const len = c.order.length;
  c.delayedThisRound = true;
  c.turnIndex = c.order.findIndex((o) => o.ref === p);
  NK.Combat.delayTurn(c);
  if (c.order.length !== len) throw new Error('第二次延后不该改变顺序');
});

step('回合结束时重置延后与移动标记', () => {
  const { c } = fieldBattle('ranger');
  c.delayedThisRound = true;
  c.turn.moved = true;
  NK.Combat.endOfRound(c);
  if (c.delayedThisRound) throw new Error('新回合应该重置延后标记');
});

step('行动顺序条会渲染出来', () => {
  // 用一局真实的战斗渲染界面，保证 App.run 与 c 是同一套对象
  const r = NK.Run.start({ rng: NK.RNG.make(103), raceId: 'human', classId: 'ranger', bgId: 'folk_hero', attrs: { str: 12, dex: 15, con: 14, int: 10, wis: 12, cha: 8 }, skills: [], pack: 0, difficulty: 1, name: '顺序测试', equipment: [NK.Items.weapon('longbow')] });
  r.player.maxHp = 400; r.player.hp = 400;
  const c = NK.Run.startBattle(r, 'normal');
  App.run = r; App.screen = 'battle'; App.modal = null;
  c.turnIndex = c.order.findIndex((o) => o.ref === r.player);
  c.turn = { action: true, bonus: true, moved: false };
  UI.render();
  const out = html.innerHTML;
  if (!out.includes('orderbar')) throw new Error('战斗界面没有行动顺序条');
  if (!out.includes('orderchip on')) throw new Error('行动顺序条没有高亮当前行动者');
  if (!out.includes('延后行动')) throw new Error('没有延后行动按钮');
  if (!out.includes('距离')) throw new Error('没有显示距离');
  if (!out.includes('接近') || !out.includes('拉开')) throw new Error('没有移动按钮');
  console.log('    · 行动顺序：' + c.order.map((o) => o.name).join(' > ') + '　初始距离 ' + NK.Combat.distance(c).text);
});

/* ---------- 只有法师能抄写 ---------- */
console.log('\n-- 抄写权限 --');
step('六个职业里只有法师能抄写卷轴', () => {
  const scroll = NK.Items.consumableById('scroll_fireball');
  const allowed = [];
  for (const cid of ['warrior', 'rogue', 'ranger', 'cleric', 'wizard', 'paladin']) {
    const cls = R.classDef(cid);
    const p = R.createPlayer({
      raceId: 'human', classId: cid, bgId: 'sage',
      attrs: { str: 13, dex: 13, con: 13, int: 13, wis: 13, cha: 13 }, skills: [],
      cantrips: ['fire_bolt'], knownSpells: ['magic_missile'], prepared: [],
    });
    p.level = 10; R.recalc(p);
    if (R.canCopyScroll(p, scroll).ok) allowed.push(cls.name);
  }
  if (allowed.length !== 1 || allowed[0] !== '法师') throw new Error('能抄写的职业应该是「只有法师」，实际：' + (allowed.join('、') || '无'));
  console.log('    · 可抄写职业：' + allowed.join('、'));
});

step('非法师的背包里不出现抄写按钮', () => {
  // 法师能看到抄写按钮
  const wiz = NK.Run.start({ rng: NK.RNG.make(111), raceId: 'human', classId: 'wizard', bgId: 'sage', attrs: { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 8 }, skills: [], pack: 0, difficulty: 1, name: 'W', equipment: [], cantrips: ['fire_bolt'] });
  wiz.player.inventory = [NK.Items.consumableById('scroll_shield')];
  wiz.gold = 500;
  App.run = wiz; App.screen = 'map'; App.modal = 'bag';
  UI.render();
  if (!html.innerHTML.includes('抄写')) throw new Error('法师背包里应该有抄写按钮');
  // 战士看不到
  const war = NK.Run.start({ rng: NK.RNG.make(112), raceId: 'dwarf', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 8 }, skills: [], pack: 0, difficulty: 1, name: 'F', equipment: [] });
  war.player.inventory = [NK.Items.consumableById('scroll_shield')];
  war.gold = 500;
  App.run = war;
  UI.render();
  if (html.innerHTML.includes('抄写')) throw new Error('战士背包里不该出现抄写按钮');
  App.modal = null;
});

/* ---------- 敌人意图预告 ---------- */
console.log('\n-- 敌人意图预告 --');
step('每个敌人都有意图，且与实际行动一致', () => {
  const p = freshWarrior();
  const rng = NK.RNG.make(71);
  const e = NK.Combat.makeEnemy('spider_queen_priestess', { id: 1, hpMul: 0.22, dmgMul: 0.68, hitAdd: 0 }, rng);
  const c = NK.Combat.start(p, [e], { rng, tier: { id: 1, hpMul: 0.22, dmgMul: 0.68, hitAdd: 0 }, act: 1, source: 'boss', allowSurprise: false });
  if (!e.intent) throw new Error('开战时没有规划敌人意图');
  if (!e.intent.detail) throw new Error('意图缺少细节描述：' + JSON.stringify(e.intent));
  if (!['attack', 'ability', 'disabled'].includes(e.intent.kind)) throw new Error('意图类型非法: ' + e.intent.kind);
  console.log(`    · 蛛后祭司的意图：${e.intent.name} —— ${e.intent.detail}`);
  const planned = e.intent;
  const before = c.log.length;
  NK.Combat.enemyTurn(c, e);
  const lines = c.log.slice(before).map((l) => l.t).join('\n');
  if (planned.kind === 'ability' && !lines.includes(planned.name)) throw new Error(`预告「${planned.name}」，实际日志里没有：\n${lines}`);
  if (planned.kind === 'attack' && !/受到|未命中/.test(lines)) throw new Error('预告攻击，实际却没打：\n' + lines);
});

step('回合结束时刷新意图', () => {
  const p = freshWarrior();
  const rng = NK.RNG.make(73);
  const e = NK.Combat.makeEnemy('goblin_cutter', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
  const c = NK.Combat.start(p, [e], { rng, tier: { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, act: 1, source: 'normal', allowSurprise: false });
  e.intent = null;
  NK.Combat.endOfRound(c);
  if (!e.intent) throw new Error('endOfRound 之后应该重新规划意图');
});

step('被定住的敌人在意图里显示为无法行动', () => {
  const p = freshWarrior();
  const rng = NK.RNG.make(75);
  const e = NK.Combat.makeEnemy('goblin_cutter', { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, rng);
  const c = NK.Combat.start(p, [e], { rng, tier: { id: 1, hpMul: 1, dmgMul: 1, hitAdd: 0 }, act: 1, source: 'normal', allowSurprise: false });
  e.conditions.push({ id: 'stunned', name: '眩晕', turns: 2 });
  const it = NK.Combat.planIntent(c, e);
  if (it.kind !== 'disabled') throw new Error('被定住时意图应该是 disabled，实际 ' + it.kind);
  if (it.tone !== 'good') throw new Error('被定住对玩家是好消息，tone 应该是 good');
});

/* ---------- 法术卷轴与抄写 ---------- */
console.log('\n-- 法术卷轴 --');
step('卷轴战斗中可用一次', () => {
  const r = NK.Run.start({ rng: NK.RNG.make(81), raceId: 'dwarf', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 8 }, skills: [], pack: 0, difficulty: 1, name: 'T', equipment: [] });
  const pl = r.player;
  pl.inventory = [NK.Items.consumableById('scroll_fireball')];
  if (!NK.Items.isScroll(pl.inventory[0])) throw new Error('卷轴识别失败');
  const c = NK.Run.startBattle(r, 'normal');
  c.enemies[0].maxHp = 400; c.enemies[0].hp = 400;
  const acts = NK.Combat.availableActions(c);
  if (!acts.items.find((x) => x.item.name.includes('火球'))) throw new Error('卷轴没有出现在物品列表里');
  NK.Combat.playerAction(c, { type: 'item', index: 0, target: c.enemies[0].uid });
  if (pl.inventory.length) throw new Error('用过的卷轴应该被消耗');
  if (!c.log.some((l) => l.t.includes('火球'))) throw new Error('使用卷轴没有施放法术');
});

step('法师可以把卷轴抄进法术书', () => {
  const r = NK.Run.start({ rng: NK.RNG.make(83), raceId: 'human', classId: 'wizard', bgId: 'sage', attrs: { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 8 }, skills: [], pack: 0, difficulty: 1, name: 'W', equipment: [], cantrips: ['fire_bolt'], knownSpells: ['magic_missile'] });
  const p = r.player;
  p.level = 5; R.recalc(p);
  p.inventory = [NK.Items.consumableById('scroll_fireball')];
  r.gold = 100;
  if (NK.Run.copyScroll(r, 0).ok) throw new Error('金币不够时不该抄写成功');
  r.gold = 500;
  const res = NK.Run.copyScroll(r, 0);
  if (!res.ok) throw new Error('抄写失败：' + res.msg);
  if (!p.knownSpells.includes('fireball')) throw new Error('法术没有进法术书');
  if (p.inventory.length) throw new Error('抄写后卷轴应该被消耗');
  if (r.gold !== 275) throw new Error(`三环卷轴应花费 225，剩余金币 ${r.gold}`);
  if (NK.Run.copyScroll(r, 0).ok) throw new Error('卷轴已经用掉了');
  const p2 = R.createPlayer({ raceId: 'human', classId: 'wizard', bgId: 'sage', attrs: { str: 8, dex: 14, con: 14, int: 15, wis: 10, cha: 8 }, skills: [] });
  if (R.canCopyScroll(p2, NK.Items.consumableById('scroll_fireball')).ok) throw new Error('1 级法师不该能抄三环卷轴');
  const f = R.createPlayer({ raceId: 'dwarf', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 8 }, skills: [] });
  if (R.canCopyScroll(f, NK.Items.consumableById('scroll_fireball')).ok) throw new Error('战士不该能抄卷轴');
  console.log(`    · 抄写火球术花费 ${NK.Items.copyCost(R.spellDef('fireball'))} 金，抄完剩 ${r.gold}`);
});

/* ---------- 通关记录与图鉴 ---------- */
console.log('\n-- 通关记录与图鉴 --');
step('打完一局会写入记录并补图鉴', () => {
  for (const k of Object.keys(store)) if (k.startsWith('yuanxia_records') || k.startsWith('yuanxia_codex')) delete store[k];
  const r = NK.Run.start({ rng: NK.RNG.make(91), raceId: 'elf', classId: 'ranger', bgId: 'folk_hero', attrs: { str: 12, dex: 15, con: 14, int: 10, wis: 12, cha: 8 }, skills: ['perception'], pack: 0, difficulty: 2, name: '记录测试', equipment: [] });
  NK.Run.startBattle(r, 'normal');
  if (!NK.Codex.seen('monsters').length) throw new Error('遭遇怪物后图鉴没有记录');
  const before = NK.Codex.records().length;
  r.victory = false; r.deathCause = '测试怪';
  NK.Run.settle(r);
  const recs = NK.Codex.records();
  if (recs.length !== before + 1) throw new Error('没有写入通关记录');
  const rec = recs[0];
  if (rec.name !== '记录测试' || rec.difficulty !== 2) throw new Error('记录内容不对：' + JSON.stringify(rec));
  if (rec.result !== 'defeat' || rec.deathCause !== '测试怪') throw new Error('记录没有正确反映失败');
  if (!rec.className || !rec.level) throw new Error('记录缺少角色信息');
  if (NK.Codex.recordStats().total < 1) throw new Error('统计不对');
  console.log(`    · 记录：${rec.race} ${rec.className} Lv.${rec.level} 第 ${rec.act} 幕 击杀 ${rec.kills}`);
});

step('图鉴条目与进度', () => {
  const prog = NK.Codex.progress();
  for (const k of ['monsters', 'spells', 'items', 'events']) {
    if (!prog[k] || typeof prog[k].total !== 'number') throw new Error('缺少图鉴进度: ' + k);
    if (prog[k].seen > prog[k].total) throw new Error(`${k} 已见超过总数`);
  }
  const firstId = NK.Codex.seen('monsters')[0];
  const entry = NK.Codex.entry('monsters', firstId);
  if (!entry || !entry.name || !entry.lines.length) throw new Error('怪物图鉴条目内容为空');
  if (NK.Codex.entry('monsters', 'nonexistent')) throw new Error('不存在的条目应该返回 null');
  console.log(`    · 图鉴：怪物 ${prog.monsters.seen}/${prog.monsters.total}　法术 ${prog.spells.seen}/${prog.spells.total}　物品 ${prog.items.seen}/${prog.items.total}　事件 ${prog.events.seen}/${prog.events.total}`);
});

step('记录与图鉴界面能渲染', () => {
  UI.init();
  App.modal = 'records'; UI.render();
  if (!html.innerHTML.includes('行走记录')) throw new Error('记录界面没有渲染');
  App.modal = 'codex'; App.codexTab = 'monsters'; UI.render();
  if (!html.innerHTML.includes('图鉴')) throw new Error('图鉴界面没有渲染');
  if (!html.innerHTML.includes('？？？')) throw new Error('未解锁的图鉴条目应该显示 ？？？');
  UI.act('codex:tab', { tab: 'spells' }); UI.render();
  if (!html.innerHTML.includes('法术')) throw new Error('图鉴分页切换失败');
  App.modal = null;
});

/* ---------- 界面减负 ---------- */
console.log('\n-- 界面减负 --');
step('战斗日志默认折叠、人物卡分页', () => {
  const rng = NK.RNG.make(95);
  const r = NK.Run.start({ rng, raceId: 'dwarf', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 8 }, skills: [], pack: 0, difficulty: 1, name: 'T', equipment: [] });
  App.run = r; App.screen = 'battle'; App.modal = null; App.logFull = false;
  const c = NK.Run.startBattle(r, 'normal');
  for (let i = 0; i < 40; i++) NK.Combat.line(c, 'sys', '测试日志行 ' + i);
  UI.render();
  if (!html.innerHTML.includes('展开全部')) throw new Error('长日志应该出现折叠按钮');
  UI.act('log:toggle');
  if (App.logFull !== true) throw new Error('展开按钮没有生效');
  UI.act('log:toggle');
  App.modal = 'sheet'; App.sheetTab = 'core'; UI.render();
  if (!html.innerHTML.includes('sheet:tab')) throw new Error('人物卡没有分页标签');
  for (const t of ['combat', 'features', 'skills', 'equip']) { App.sheetTab = t; UI.render(); if (!html.innerHTML.includes('sheet:tab')) throw new Error('分页 ' + t + ' 渲染失败'); }
  App.modal = null;
  console.log('    · 日志折叠 + 人物卡分页渲染正常');
});

console.log('\n-- 弹窗渲染 --');
UI.act('t:new');
step('人物卡与背包', () => {
  for (const m of ['help', 'sheet', 'bag']) { App.modal = m; UI.render(); }
  App.modal = null;
  UI.render();
});
step('背包渲染出全部十个装备槽', () => {
  const r = NK.Run.start({ rng: NK.RNG.make(999), raceId: 'dwarf', classId: 'warrior', bgId: 'soldier', attrs: { str: 15, dex: 14, con: 14, int: 8, wis: 10, cha: 8 }, skills: [], pack: 0, difficulty: 1, name: '槽位测试', equipment: [NK.Items.weapon('longsword'), NK.Items.armor('chain_mail')] });
  r.player.bag.push(NK.Items.weapon('greatsword'), NK.Items.weapon('dagger'), NK.Items.mundaneItem('iron_helm'), NK.Items.mundaneItem('copper_ring'));
  App.run = r; App.screen = 'map'; App.modal = 'bag';
  UI.render();
  const out = html.innerHTML;
  for (const name of ['右手', '左手', '上身', '下身', '头盔', '项链', '护腕', '护腿', '鞋', '戒指']) {
    if (!out.includes(name)) throw new Error('背包里没有渲染出「' + name + '」槽位');
  }
  if (!out.includes('装右手') || !out.includes('装左手')) throw new Error('武器没有提供右手/左手两个装备按钮');
  if (out.includes('data-slot="offHand">装左手</button>') && !out.includes('data-slot="mainHand">装右手</button>')) throw new Error('按钮的槽位参数不对');
  if (!out.includes('戴上')) throw new Error('戒指没有「戴上」按钮');
  App.modal = null;
});

console.log(`\n最终 HTML 长度：${html.innerHTML.length}`);
if (errors.length) {
  console.error(`\n✘ 冒烟测试失败，共 ${errors.length} 个错误：`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('\n✔ 冒烟测试通过：建卡 → 三幕 → 升级 → 结算全流程无异常，规则单元测试全部通过。');
