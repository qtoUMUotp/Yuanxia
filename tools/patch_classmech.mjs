/* 一次性补丁：为邪术师（魔契恩泽 / 魔能祈愿）、术士（超魔）、德鲁伊（野性形态）、吟游诗人（吟游灵感）
   补上可选列表与职业特性数据。改完需 node tools/build-data.mjs 重建。 */
import { readFileSync, writeFileSync } from 'node:fs';

const RULES = 'data/rules.json';
const CLS = 'data/classes.json';
const rd = JSON.parse(readFileSync(RULES, 'utf8'));
const cd = JSON.parse(readFileSync(CLS, 'utf8'));

/* ---------- 1. 可选列表 ---------- */
rd.invocations = [
  { id: 'inv_agonizing', name: '痛苦魔爆', desc: '魔能爆的每一束射线都加上你的魅力调整值伤害。', effects: { ebAgonizing: true } },
  { id: 'inv_repelling', name: '斥力魔爆', desc: '魔能爆命中时把目标推开一档距离（近战怪会被推到中距）。', effects: { ebRepelling: true } },
  { id: 'inv_grasping', name: '缚影魔爆', desc: '魔能爆命中后，目标本回合无法再移动。', effects: { ebGrasping: true } },
  { id: 'inv_lance', name: '长柄魔爆', desc: '魔能爆射程更远：任何距离都不会因贴身而劣势，且伤害 +1。', effects: { ebLance: true } },
  { id: 'inv_armor', name: '魔能护甲', desc: '你可以随意以魔力裹身，AC +2（不需要法术位）。', effects: { ac: 2 } },
  { id: 'inv_vigor', name: '邪魔活力', desc: '契约在你身上留下痕迹：最大生命 +8。', effects: { maxHp: 8 } },
  { id: 'inv_whispers', name: '低语之主', desc: '你的主人附在你耳边：法术 DC +1。', effects: { spellDc: 1 } },
  { id: 'inv_eyes', name: '魔能之眼', desc: '你在黑暗中看得清，也比别人先一步反应：先攻 +2。', effects: { initBonus: 2 } },
];

rd.metamagics = [
  { id: 'mm_quicken', name: '瞬发法术', desc: '消耗 1 术法点：本次施法改为附赠动作，你仍可再做一个动作。', cost: 1 },
  { id: 'mm_empower', name: '强效法术', desc: '消耗 1 术法点：本次伤害法术额外加上你的魅力调整值伤害。', cost: 1 },
  { id: 'mm_twinned', name: '孪生法术', desc: '消耗 1 术法点：本次单体法术额外指定第二个目标。', cost: 1 },
  { id: 'mm_careful', name: '精准法术', desc: '消耗 1 术法点：本次法术的豁免 DC +2。', cost: 1 },
  { id: 'mm_heighten', name: '高阶法术', desc: '消耗 1 术法点：本次法术的伤害 +2d6。', cost: 1 },
];

rd.pactBoons = [
  { id: 'pact_tome', name: '书之契约', desc: '你的主人给了你一本会自己写字的书：额外学会 3 个戏法。', effects: { pactTome: true } },
  { id: 'pact_chain', name: '链之契约', desc: '一只魔宠跟着你：每场战斗开始时它会显现，并在你的回合自行骚扰敌人。', effects: { pactChain: true } },
  { id: 'pact_blade', name: '刃之契约', desc: '你可以随手召出契约武器（1d8，视为魔法，命中与伤害各 +1）。', effects: { pactBlade: true } },
];

/* ---------- 2. 职业特性 ---------- */
const byId = (id) => cd.classes.find((c) => c.id === id);

// 邪术师：魔能祈愿改为可选；3 级补魔契恩泽
const wl = byId('warlock');
wl.features = [
  { level: 1, name: '邪术师法术', desc: '你的法术来自契约，而非学习。法术位少，但每次短休都能拿回来。', effects: {} },
  { level: 1, name: '邪能之触', desc: '契约烙在你的语言里：法术 DC +1。', effects: { spellDc: 1 } },
  { level: 2, name: '魔能祈愿', desc: '你的主人允许你从它的力量里取走一小块。选择 2 项魔能祈愿。', choice: 'invocation', choiceCount: 2 },
  { level: 3, name: '魔契恩泽', desc: '契约结成实物。选择一项魔契：书、链、刃。', choice: 'pactBoon', choiceCount: 1 },
  { level: 5, name: '魔能祈愿·深', desc: '你索取更多。再选择 1 项魔能祈愿。', choice: 'invocation', choiceCount: 1 },
  { level: 6, name: '复生契约', desc: '你的主人在你倒下时拉了你一把：每天额外一次短休。', effects: { restShort: 1 } },
  { level: 7, name: '魔能祈愿·秘', desc: '再选择 1 项魔能祈愿。', choice: 'invocation', choiceCount: 1 },
  { level: 10, name: '契约主宰', desc: '你不再是乞求者：法术伤害 +2。', effects: { spellDmg: 2 } },
];

// 术士：3 级补超魔
const sr = byId('sorcerer');
sr.features = [
  { level: 1, name: '术法来源', desc: '魔法是你血脉里的东西：法术 DC +1、法术伤害 +1。', effects: { spellDc: 1, spellDmg: 1 } },
  { level: 1, name: '法术转生', desc: '每天额外一次短休；短休时你的术法点也会回来 1 点。', effects: { restShort: 1 } },
  { level: 3, name: '超魔', desc: '你能把术法拧成别的形状。选择 2 项超魔，并获得术法点（上限等于你的术士等级，长休恢复）。', choice: 'metamagic', choiceCount: 2, effects: { metamagic: true } },
  { level: 5, name: '法术穿透', desc: '法术 DC +1、法术伤害 +1。', effects: { spellDc: 1, spellDmg: 1 } },
  { level: 6, name: '血脉之力', desc: '血脉在你身上显形：最大生命 +8，减伤 1。', effects: { maxHp: 8, dr: 1 } },
  { level: 8, name: '强效术法', desc: '法术伤害 +2。', effects: { spellDmg: 2 } },
  { level: 10, name: '真名术法', desc: '法术 DC +1、法术伤害 +2；再选择 1 项超魔。', effects: { spellDc: 1, spellDmg: 2 }, choice: 'metamagic', choiceCount: 1 },
];

// 德鲁伊：野性形态真正可用（2 次/长休）
const dr = byId('druid');
for (const f of dr.features) {
  if (f.name === '野性形态') {
    f.desc = '你可以变成一头野兽：临时生命 4×等级，伤害 +2、减伤 1、AC +1，持续到战斗结束。每天 2 次，长休恢复。';
    f.effects = { wildShape: 2 };
  }
}

// 吟游诗人：吟游灵感真正可用（次数 = 魅力调整值，最少 1，短休恢复）
const bd = byId('bard');
for (const f of bd.features) {
  if (f.name === '吟游灵感') {
    f.desc = '你能把一句旋律塞进别人骨头里：技能检定 +1、最大生命 +6。此外每场战斗前可激励自己 1 次（次数 = 魅力调整值，最少 1），下一次攻击掷骰 +1d6，短休恢复。';
    f.effects = { skillBonus: 1, maxHp: 6, bardicInspiration: true };
  }
}

writeFileSync(RULES, JSON.stringify(rd, null, 2), 'utf8');
writeFileSync(CLS, JSON.stringify(cd, null, 2), 'utf8');
console.log('patched rules.json + classes.json');
console.log('invocations', rd.invocations.length, '| metamagics', rd.metamagics.length, '| pactBoons', rd.pactBoons.length);
console.log('warlock features', wl.features.map((f) => f.level + f.name).join(' '));
console.log('sorcerer features', sr.features.map((f) => f.level + f.name).join(' '));
