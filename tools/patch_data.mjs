// 一次性数据补丁：补齐 sorcerer/bard/druid/artificer/warlock 的法术池，新增魔能爆/寒触/邪咒等，并给 warlock/artificer 加机制特性。
// 用法：node tools/patch_data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sPath = join(root, 'data', 'spells.json');
const cPath = join(root, 'data', 'classes.json');

const spells = JSON.parse(readFileSync(sPath, 'utf8'));
const classes = JSON.parse(readFileSync(cPath, 'utf8'));

/* ---------- 1) 给现有法术追加职业标签 ---------- */
function tag(id, clsList) {
  const s = spells.spells.find((x) => x.id === id);
  if (!s) { console.warn('  跳过不存在的法术:', id); return; }
  for (const c of clsList) if (!s.classes.includes(c)) s.classes.push(c);
}
// 术士（cha，法术列表含 wizard）
['fire_bolt', 'ray_of_frost', 'shocking_grasp', 'poison_spray', 'blade_ward', 'true_strike'].forEach((id) => tag(id, ['sorcerer']));
['magic_missile', 'shield', 'burning_hands', 'thunderwave', 'mage_armor', 'scorching_ray'].forEach((id) => tag(id, ['sorcerer']));
// 吟游诗人（cha）
['healing_word', 'bless', 'shield_of_faith'].forEach((id) => tag(id, ['bard']));
// 德鲁伊（wis）
['guidance', 'cure_wounds'].forEach((id) => tag(id, ['druid']));
['thunderwave'].forEach((id) => tag(id, ['druid']));
// 奥术工匠（int，法术列表含 wizard）
['fire_bolt', 'shocking_grasp', 'blade_ward'].forEach((id) => tag(id, ['artificer']));
['shield', 'thunderwave', 'cure_wounds'].forEach((id) => tag(id, ['artificer']));
// 邪术师（cha，法术列表含 wizard/cleric）
['poison_spray', 'shield'].forEach((id) => tag(id, ['warlock']));

/* ---------- 2) 新增法术 ---------- */
const NEW_SPELLS = [
  // 邪术师招牌
  {
    id: 'eldritch_blast', name: '魔能爆', level: 0, classes: ['warlock'], school: '塑能',
    action: '动作', range: '120 尺', concentration: false, kind: 'spell_attack',
    dice: '1d10', dmgType: '力场', desc: '你指尖吐出一道青白的电弧，撕裂空气直贯目标。这是邪术师最著名的把戏——每道射线独立判定，随等级分裂出更多束。',
    upcast: null, addMain: false,
  },
  {
    id: 'chill_touch', name: '寒触', level: 0, classes: ['warlock', 'sorcerer'], school: '死灵',
    action: '动作', range: '120 尺', concentration: false, kind: 'spell_attack',
    dice: '1d8', dmgType: '坏死', desc: '一缕尸冷的精气从你指尖探出，缠上它的血脉。命中造成 1d8 坏死伤害，并在短时间内阻断它的自愈。',
    upcast: null, addMain: false,
  },
  {
    id: 'hex', name: '邪咒', level: 1, classes: ['warlock'], school: '附魔',
    action: '附赠动作', range: '90 尺', concentration: true, kind: 'buff', turns: 99,
    mark: { dice: '1d6', type: '坏死' },
    desc: '你以一句古老的诅咒钉住它的影子。此后你对它造成的每次攻击额外承受 1d6 坏死伤害，直到你转移诅咒或战斗结束。',
    upcast: null,
  },
  // 吟游诗人
  {
    id: 'vicious_mockery', name: '维妙嘲讽', level: 0, classes: ['bard'], school: '附魔',
    action: '动作', range: '60 尺', concentration: false, kind: 'spell_attack',
    dice: '1d4', dmgType: '心灵', desc: '你吐出一句精准的讥讽，戳中它最在意的软肋。命中造成 1d4 心灵伤害，并让它心烦意乱，下一次攻击具有劣势。',
    upcast: null, addMain: false, disadvantageOnHit: true,
  },
  {
    id: 'minor_illusion', name: '小幻术', level: 0, classes: ['bard'], school: '幻术',
    action: '动作', range: '30 尺', concentration: false, kind: 'utility', desc: '你凭空织出一段声音或影像，骗过眼睛与耳朵。纯戏法，只用于制造假象与脱身。',
    upcast: null,
  },
  {
    id: 'charm_person', name: '魅惑人类', level: 1, classes: ['bard', 'sorcerer', 'wizard'], school: '附魔',
    action: '动作', range: '30 尺', concentration: false, kind: 'debuff',
    save: 'wis', cond: { id: 'charmed', name: '魅惑', turns: 1 }, desc: '你抛出一句裹着魔力的软语，它的眼神软下来。感知豁免失败则陷入「魅惑」，暂时把你当同伴。',
    upcast: null,
  },
  {
    id: 'sleep', name: '睡眠术', level: 1, classes: ['bard', 'wizard'], school: '附魔',
    action: '动作', range: '90 尺', concentration: false, kind: 'save',
    targets: 'all', save: 'wis', half: false, dice: '5d8', dmgType: '心灵', desc: '一片暖洋洋的困意如潮水漫过，范围内的敌人纷纷合上眼睛陷入沉睡（5d8 心灵伤害，豁免减半——实际表现为沉睡）。',
    upcast: { per: '2d8' },
  },
  // 德鲁伊
  {
    id: 'produce_flame', name: '生产烈焰', level: 0, classes: ['druid'], school: '塑能',
    action: '动作', range: '接触', concentration: false, kind: 'spell_attack',
    dice: '1d8', dmgType: '火焰', desc: '你掌心里浮起一团不会灼手的火。它既是照明，也是武器：命中造成 1d8 火焰伤害。',
    upcast: null, addMain: false,
  },
  {
    id: 'shillelagh', name: '橡棍术', level: 0, classes: ['druid'], school: '塑能',
    action: '附赠动作', range: '自身', concentration: false, kind: 'buff', turns: 3,
    mods: { dmg: 2 }, desc: '你以一句古谚唤醒手中的木棍，让它坚硬如铁。3 回合内你的近战攻击额外 +2 伤害。',
    upcast: null,
  },
  {
    id: 'entangle', name: '纠缠术', level: 1, classes: ['druid', 'ranger'], school: '咒法',
    action: '动作', range: '自身', concentration: false, kind: 'save',
    targets: 'all', save: 'str', half: false, dice: '2d6', dmgType: '穿刺',
    cond: { id: 'restrained', name: '束缚', turns: 2 }, desc: '你跺地念咒，藤蔓与荆棘从地面窜出缠住周围的一切。力量豁免失败者受 2d6 穿刺伤害并被束缚 2 回合。',
    upcast: { per: '1d6' },
  },
  // 奥术工匠
  {
    id: 'mending', name: '修补术', level: 0, classes: ['artificer'], school: '变化',
    action: '动作', range: '接触', concentration: false, kind: 'utility', desc: '你以一道细密的魔光抚过破损的物件，修好一道裂缝或一处断口。纯戏法。',
    upcast: null,
  },
  {
    id: 'magic_stone', name: '魔石', level: 0, classes: ['artificer'], school: '咒法',
    action: '动作', range: '接触', concentration: false, kind: 'spell_attack',
    dice: '1d6', dmgType: '力场', desc: '你向三颗石子注入奥术力场，掷出时化作闪光的弹丸。命中造成 1d6 力场伤害（视为魔法攻击）。',
    upcast: null, addMain: false,
  },
  // 召唤体系
  {
    id: 'summon_shadow', name: '召唤暗影', level: 1, classes: ['warlock', 'wizard', 'druid', 'sorcerer'], school: '咒法',
    action: '动作', range: '60 尺', concentration: true, kind: 'summon', turns: 10,
    ally: { id: 'shadow_hound', name: '暗影爪牙', rank: 'summon', hp: 12, ac: 12, attackBonus: 4, dmgDice: '1d6', dmgType: '黯蚀', range: 'ranged' },
    desc: '你撕开一道通往影界的裂缝，一头由纯粹阴影凝成的猎犬扑出。它会在你的每回合自动扑向最近的敌人，持续 10 回合（专注维持）。',
    upcast: null,
  },
];

const existing = new Set(spells.spells.map((s) => s.id));
for (const s of NEW_SPELLS) {
  if (existing.has(s.id)) console.warn('  法术已存在，跳过:', s.id);
  else spells.spells.push(s);
}

/* ---------- 3) 给 sorcerer 补 spellList（共享 wizard 法术列表） ---------- */
const sorcerer = classes.classes.find((c) => c.id === 'sorcerer');
if (sorcerer && !sorcerer.spellList) sorcerer.spellList = ['wizard'];

/* ---------- 4) 邪术师：加「魔能祈愿」特性（2 级） ---------- */
const warlock = classes.classes.find((c) => c.id === 'warlock');
if (warlock && !warlock.features.some((f) => f.name === '魔能祈愿')) {
  warlock.features.push({
    level: 2, name: '魔能祈愿', desc: '你习得魔能祈愿：每道魔能爆射线附加你的魅力调整值（痛苦祈愿），并把命中的目标击退一步（击退祈愿）。',
    effects: { ebAgonizing: true, ebRepelling: true },
  });
}

/* ---------- 5) 奥术工匠：加「奥术附魔」（1 级，武器视为魔法）+「奥术冲量」（2 级，附赠动作） ---------- */
const artificer = classes.classes.find((c) => c.id === 'artificer');
if (artificer) {
  if (!artificer.features.some((f) => f.name === '奥术附魔')) {
    artificer.features.push({ level: 1, name: '奥术附魔', desc: '你把奥术力场焊进武器与护甲。你的武器攻击被视为魔法攻击，可无视非魔法物理抗性。', effects: { magicalStrikes: true } });
  }
  if (!artificer.features.some((f) => f.name === '奥术冲量')) {
    artificer.features.push({ level: 2, name: '奥术冲量', desc: '附赠动作：你给武器注入一束奥能，下一次武器攻击额外造成 1d6 力场伤害（每回合一次）。', effects: { arcaneJolt: true } });
  }
}

/* ---------- 写出 ---------- */
writeFileSync(sPath, JSON.stringify(spells, null, 2) + '\n', 'utf8');
writeFileSync(cPath, JSON.stringify(classes, null, 2) + '\n', 'utf8');

/* ---------- 校验 ---------- */
const cl = classes.classes;
console.log('\n[patch] 校验各职业法术池（含 spellList 继承）：');
for (const c of cl) {
  const sc = c.spellcasting; if (!sc) continue;
  const eff = [c.id].concat(sc.spellList || []);
  const pool = spells.spells.filter((s) => s.classes.some((x) => eff.includes(x)));
  const c0 = pool.filter((s) => s.level === 0).length;
  const c1 = pool.filter((s) => s.level === 1).length;
  const needC = sc.cantrips || 0;
  const needS = sc.knownByLevel ? sc.knownByLevel[0] : (sc.prepared ? 99 : 0);
  const ok = c0 >= needC && c1 >= needS;
  console.log(`  ${c.id.padEnd(11)} 戏法池=${c0}(需${needC}) 1环池=${c1}(需${needS}) ${ok ? 'OK' : '⚠ 不足'}`);
}
console.log('\n[patch] 完成。已写入 spells.json / classes.json。记得运行 node tools/build-data.mjs 重建内嵌数据。');
