// 内容表自检：结构 + 交叉引用。用法：node tools/check-data.mjs
// 合并了原先的 check_items / check_monsters / check_events / audit_events 四个脚本。
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));

const rules = load('rules.json');
const races = load('races.json');
const classes = load('classes.json');
const backgrounds = load('backgrounds.json');
const spells = load('spells.json');
const monsters = load('monsters.json');
const items = load('items.json');
const events = load('events.json');
const maps = load('maps.json');

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const ATTRS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const SKILLS = new Set((rules.skills || []).map((s) => s.id));
const CONDS = new Set(Object.keys(rules.conditions || {}));
const DMG_TYPES = new Set(['挥砍', '穿刺', '钝击', '火焰', '冰霜', '闪电', '雷鸣', '强酸', '毒素', '暗蚀', '光耀', '心灵', '力场']);
const CLASS_IDS = new Set((classes.classes || []).map((c) => c.id));
const WEAPON_IDS = new Set((items.weapons || []).map((w) => w.id));
const ARMOR_IDS = new Set((items.armors || []).map((a) => a.id));
const TRAITS = new Set(Object.keys(monsters.traits || {}));
const EFFECT_KEYS = new Set(['hp', 'hpPct', 'heal', 'healPct', 'tempHp', 'gold', 'food', 'xp', 'item', 'potion', 'scroll',
  'buff', 'curse', 'reveal', 'fight', 'rest_free', 'slot_restore', 'ringSlot', 'ringSlots', 'foodGain']);

const uniq = (arr, label, key = 'id') => {
  const seen = new Set();
  for (const x of arr) {
    if (!x[key]) err(`${label}: 缺少 ${key}`);
    else if (seen.has(x[key])) err(`${label}: ${key} 重复 -> ${x[key]}`);
    else seen.add(x[key]);
  }
};

/* ---------- 1. 数量 ---------- */
const counts = [
  ['武器', items.weapons.length, 14], ['护甲/盾', items.armors.length, 8], ['魔法物品', items.magicItems.length, 24],
  ['消耗品', items.consumables.length, 12], ['普通饰品', (items.mundane || []).length, 12], ['怪物', monsters.monsters.length, 21],
  ['事件', events.events.length, 20], ['法术', spells.spells.length, 30], ['种族', races.races.length, 9],
  ['职业', classes.classes.length, 6], ['背景', backgrounds.backgrounds.length, 8], ['专长', (rules.feats || []).length, 12],
];
for (const [name, got, min] of counts) {
  if (got < min) err(`数量不足：${name} ${got} < ${min}`);
}

/* ---------- 2. 唯一性 ---------- */
uniq(items.weapons, '武器');
uniq(items.armors, '护甲');
uniq(items.magicItems, '魔法物品');
uniq(items.consumables, '消耗品');
uniq(items.mundane || [], '普通饰品');
uniq(monsters.monsters, '怪物');
uniq(events.events, '事件');
uniq(spells.spells, '法术');
uniq(rules.feats || [], '专长');
uniq(rules.fightingStyles || [], '战斗风格');
for (const c of classes.classes) {
  uniq(c.subclasses || [], `职业 ${c.id} 的子职`);
  for (const s of c.subclasses || []) uniq(s.features || [], `${c.id}/${s.id} 的特性`, 'level');
}

/* ---------- 3. 物品 ---------- */
for (const w of items.weapons) {
  if (!/^\d+d\d+/.test(w.dice || '')) err(`武器 ${w.id}: dice 非法 -> ${w.dice}`);
  if (!DMG_TYPES.has(w.type)) err(`武器 ${w.id}: 伤害类型非法 -> ${w.type}`);
  if (!Array.isArray(w.verbs) || !w.verbs.length) err(`武器 ${w.id}: 缺少 attackVerbs`);
}
for (const a of items.armors) {
  if (a.category !== 'shield' && typeof a.base !== 'number') err(`护甲 ${a.id}: 缺少 base`);
  if (a.category === 'heavy' && !a.minStr) err(`护甲 ${a.id}: 重甲应给出力量需求`);
}
for (const m of items.magicItems) {
  if (!['weapon', 'armor', 'shield', 'trinket', 'mainHand', 'offHand', 'body', 'legs', 'neck', 'ring', 'rings', 'bracers', 'greaves', 'helm', 'boots'].includes(m.slot)) err(`魔法物品 ${m.id}: slot 非法 -> ${m.slot}`);
  if (m.base) {
    if (!WEAPON_IDS.has(m.base) && !ARMOR_IDS.has(m.base)) err(`魔法物品 ${m.id}: base 不存在 -> ${m.base}`);
  } else if (m.slot === 'weapon' || m.slot === 'armor' || m.slot === 'shield') warn(`魔法物品 ${m.id}: 武器/护甲却没有 base`);
  if (m.extraDice && !m.extraType) err(`魔法物品 ${m.id}: 有 extraDice 却没有 extraType`);
  if (m.extraType && !DMG_TYPES.has(m.extraType)) err(`魔法物品 ${m.id}: extraType 非法 -> ${m.extraType}`);
  if (m.cond_on_hit && !CONDS.has(m.cond_on_hit.id)) err(`魔法物品 ${m.id}: 命中状态非法 -> ${m.cond_on_hit.id}`);
  for (const r of m.resist || []) if (!DMG_TYPES.has(r)) err(`魔法物品 ${m.id}: resist 非法 -> ${r}`);
}
for (const c of items.consumables) {
  if (!c.effect || !Object.keys(c.effect).length) err(`消耗品 ${c.id}: 缺少 effect`);
  if (c.effect && c.effect.cast && !spells.spells.some((s) => s.id === c.effect.cast)) err(`消耗品 ${c.id}: 卷轴法术不存在 -> ${c.effect.cast}`);
}

/* ---------- 4. 法术 ---------- */
for (const s of spells.spells) {
  if (typeof s.level !== 'number' || s.level < 0 || s.level > 5) err(`法术 ${s.id}: 环阶非法 -> ${s.level}`);
  if (!Array.isArray(s.classes) || !s.classes.length) err(`法术 ${s.id}: 缺少 classes`);
  for (const c of s.classes || []) if (!CLASS_IDS.has(c)) err(`法术 ${s.id}: 职业不存在 -> ${c}`);
  if (s.save && !ATTRS.includes(s.save)) err(`法术 ${s.id}: 豁免属性非法 -> ${s.save}`);
  if (s.dmgType && !DMG_TYPES.has(s.dmgType)) err(`法术 ${s.id}: 伤害类型非法 -> ${s.dmgType}`);
  if (s.cond && !CONDS.has(s.cond.id)) err(`法术 ${s.id}: 状态非法 -> ${s.cond.id}`);
  if ((s.kind === 'save' || s.kind === 'spell_attack') && !s.dice) err(`法术 ${s.id}: 伤害法术缺少 dice`);
}
// 每个施法职业至少有 3 个可用法术（遵循 spellList 继承，与引擎一致）
const spellListOf = (id) => { const d = classes.classes.find((x) => x.id === id); const b = [id]; if (d && Array.isArray(d.spellList)) b.push.apply(b, d.spellList); return b; };
for (const c of classes.classes) {
  if (!c.spellcasting) continue;
  const eff = spellListOf(c.id);
  const n = spells.spells.filter((s) => s.classes.some((x) => eff.includes(x))).length;
  if (n < 3) err(`职业 ${c.id}: 可用法术只有 ${n} 个`);
}

/* ---------- 5. 怪物 ---------- */
const acts = new Set((maps.acts || []).map((a, i) => i + 1));
for (const m of monsters.monsters) {
  if (!acts.has(m.act)) err(`怪物 ${m.id}: act 非法 -> ${m.act}`);
  if (!['normal', 'elite', 'boss'].includes(m.rank)) err(`怪物 ${m.id}: rank 非法 -> ${m.rank}`);
  if (typeof m.hp !== 'number' || m.hp <= 0) err(`怪物 ${m.id}: hp 非法`);
  if (typeof m.ac !== 'number') err(`怪物 ${m.id}: ac 非法`);
  for (const a of ATTRS) if (typeof m.attrs[a] !== 'number') err(`怪物 ${m.id}: 缺少属性 ${a}`);
  if (!/^\d+d\d+/.test(m.attack.dice || '')) err(`怪物 ${m.id}: attack.dice 非法`);
  if (!DMG_TYPES.has(m.attack.type)) err(`怪物 ${m.id}: 攻击类型非法 -> ${m.attack.type}`);
  for (const t of m.traits || []) if (!TRAITS.has(t.effect)) err(`怪物 ${m.id}: 特性不存在 -> ${t.effect}`);
  for (const r of (m.resist || []).concat(m.immune || [], m.vuln || [])) if (!DMG_TYPES.has(r)) err(`怪物 ${m.id}: 抗性类型非法 -> ${r}`);
  for (const a of m.abilities || []) {
    if (!a.id || !a.name) err(`怪物 ${m.id}: 技能缺少 id/name`);
    if (typeof a.cooldown !== 'number') err(`怪物 ${m.id}/${a.id}: 缺少 cooldown`);
    if (!['save', 'debuff', 'heal_self', 'buff_self', 'drain'].includes(a.kind)) err(`怪物 ${m.id}/${a.id}: kind 非法 -> ${a.kind}`);
    if (a.cond && !CONDS.has(a.cond.id)) err(`怪物 ${m.id}/${a.id}: 状态非法 -> ${a.cond.id}`);
    if (a.cond && !a.cond.turns) warn(`怪物 ${m.id}/${a.id}: 状态没写 turns，会按 2 回合处理`);
    if (a.dice && !/^\d+d\d+/.test(a.dice)) err(`怪物 ${m.id}/${a.id}: dice 非法 -> ${a.dice}`);
    if (a.kind === 'save' && !a.save) err(`怪物 ${m.id}/${a.id}: 豁免技能缺少 save`);
  }
}

/* ---------- 6. 事件 ---------- */
for (const e of events.events) {
  if (!e.name || !e.text) err(`事件 ${e.id}: 缺少 name/text`);
  if (!Array.isArray(e.acts) || !e.acts.length) err(`事件 ${e.id}: 缺少 acts`);
  if (!Array.isArray(e.options) || e.options.length < 2) err(`事件 ${e.id}: 选项少于 2 个`);
  for (const o of e.options || []) {
    if (!o.label) err(`事件 ${e.id}: 选项缺少 label`);
    if (o.check) {
      if (o.check.skill && !SKILLS.has(o.check.skill)) err(`事件 ${e.id}: 技能不存在 -> ${o.check.skill}`);
      if (o.check.attr && !ATTRS.includes(o.check.attr)) err(`事件 ${e.id}: 属性非法 -> ${o.check.attr}`);
      if (typeof o.check.dc !== 'number') err(`事件 ${e.id}: 检定缺少 dc`);
      if (!o.success || !o.failure) warn(`事件 ${e.id}: 有检定但没写成功/失败分支`);
    }
    const effs = [];
    if (o.effect) effs.push(o.effect);
    if (o.success && o.success.effect) effs.push(o.success.effect);
    if (o.failure && o.failure.effect) effs.push(o.failure.effect);
    for (const o2 of o.outcomes || []) if (o2.effect) effs.push(o2.effect);
    for (const eff of effs) for (const k of Object.keys(eff)) if (!EFFECT_KEYS.has(k)) err(`事件 ${e.id}: 未知效果键 -> ${k}`);
  }
}
// 技能覆盖
const covered = new Set();
for (const e of events.events) for (const o of e.options || []) if (o.check && o.check.skill) covered.add(o.check.skill);
const missing = [...SKILLS].filter((s) => !covered.has(s));
if (missing.length) warn(`事件没有覆盖这些技能：${missing.join('、')}`);

/* ---------- 7. 种族 / 职业 / 背景 ---------- */
for (const r of races.races) {
  const hasBonus = r.bonus && ATTRS.some((a) => r.bonus[a]);
  const hasChoice = r.bonusChoice || (r.traits || []).some((t) => t.effects && (t.effects.bonusChoice || t.effects.attrChoice));
  if (!hasBonus && !hasChoice) err(`种族 ${r.id}: 没有属性加值`);
  if (typeof r.speed !== 'number') err(`种族 ${r.id}: 缺少 speed`);
  if (!(r.traits || []).length) warn(`种族 ${r.id}: 没有种族特性`);
  for (const t of r.traits || []) {
    for (const k of Object.keys(t.effects || {})) {
      const v = t.effects[k];
      if (Array.isArray(v)) for (const x of v) { if (['resist', 'immune', 'vuln'].includes(k) && !DMG_TYPES.has(x)) err(`种族 ${r.id}: ${k} 非法 -> ${x}`); }
    }
  }
}
for (const c of classes.classes) {
  if (!c.hitDie || !c.primary) err(`职业 ${c.id}: 缺少 hitDie/primary`);
  if (!Array.isArray(c.skillChoices && c.skillChoices.from)) err(`职业 ${c.id}: 缺少技能选择池`);
  for (const s of c.skillChoices.from) if (!SKILLS.has(s)) err(`职业 ${c.id}: 技能不存在 -> ${s}`);
  for (const f of c.features) {
    if (typeof f.level !== 'number' || f.level < 1 || f.level > 10) err(`职业 ${c.id}/${f.name}: 等级非法 -> ${f.level}`);
    if (f.choice && !['fightingStyle', 'expertise'].includes(f.choice)) err(`职业 ${c.id}/${f.name}: choice 非法 -> ${f.choice}`);
  }
  if (!(c.subclasses || []).length) err(`职业 ${c.id}: 没有子职`);
  if (typeof c.subclassLevel !== 'number') err(`职业 ${c.id}: 缺少 subclassLevel`);
}
for (const b of backgrounds.backgrounds) {
  if (!Array.isArray(b.skills) || b.skills.length !== 2) err(`背景 ${b.id}: 应该有 2 个技能`);
  for (const s of b.skills || []) if (!SKILLS.has(s)) err(`背景 ${b.id}: 技能不存在 -> ${s}`);
}

/* ---------- 8. 地图与平衡 ---------- */
for (const [i, a] of (maps.acts || []).entries()) {
  if (!a.pool || !a.pool.length) err(`第 ${i + 1} 幕: 没有普通怪物池`);
  if (!a.boss) err(`第 ${i + 1} 幕: 没有关底`);
  for (const id of [].concat(a.pool || [], a.elites || [], a.boss || [])) {
    const m = monsters.monsters.find((x) => x.id === id);
    if (!m) err(`第 ${i + 1} 幕: 怪物不存在 -> ${id}`);
    else if (m.act !== i + 1) warn(`第 ${i + 1} 幕用了第 ${m.act} 幕的怪物 ${id}`);
  }
}
for (const k of ['1', '2', '3']) {
  const b = (maps.balance || {})[k];
  if (!b) { err(`balance 缺少第 ${k} 幕`); continue; }
  for (const rank of ['normal', 'elite', 'boss']) {
    if (!b[rank]) err(`balance[${k}] 缺少 ${rank}`);
    else for (const f of ['hp', 'dmg']) if (typeof b[rank][f] !== 'number') err(`balance[${k}].${rank} 缺少 ${f}`);
  }
}
if (!(maps.difficulties || []).length) err('没有难度配置');

/* ---------- 输出 ---------- */
console.log(`内容表自检：${counts.map(([n, g]) => `${n} ${g}`).join('　')}`);
if (warns.length) {
  console.log(`\n警告 ${warns.length} 条：`);
  for (const w of warns) console.log('  · ' + w);
}
if (errors.length) {
  console.error(`\n✘ 发现 ${errors.length} 个问题：`);
  for (const e of errors.slice(0, 40)) console.error('  ✘ ' + e);
  if (errors.length > 40) console.error(`  …… 还有 ${errors.length - 40} 条`);
  process.exit(1);
}
console.log('\n✔ 数据表结构与交叉引用全部通过。');
