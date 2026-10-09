// 一次性补丁：classes.json —— 等级上限 20、ASI 按 5e、职业/子职特性补到 20 级、已知法术表按 5e
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const p = join(root, 'data', 'classes.json');
const D = JSON.parse(readFileSync(p, 'utf8'));
const byId = {};
for (const c of D.classes) byId[c.id] = c;

const F = (level, name, desc, effects, choice, choiceCount) => {
  const f = { level, name, desc, effects: effects || {} };
  if (choice) { f.choice = choice; f.choiceCount = choiceCount || 1; }
  return f;
};

/* ============ 1. 施法表按 5e ============ */
const SC = {
  ranger: { knownByLevel: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11], cantripsByLevel: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  sorcerer: { knownByLevel: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15], cantripsByLevel: [4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6] },
  bard: { knownByLevel: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22], cantripsByLevel: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2] },
  warlock: { knownByLevel: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15], cantripsByLevel: [2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3] },
  wizard: { cantripsByLevel: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], prepared: true },
  cleric: { cantripsByLevel: [3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4] },
  druid: { cantripsByLevel: [2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3] },
  artificer: { cantripsByLevel: [2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4] },
  paladin: { cantripsByLevel: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
};
for (const [id, patch] of Object.entries(SC)) {
  if (!byId[id] || !byId[id].spellcasting) continue;
  Object.assign(byId[id].spellcasting, patch);
}

/* ============ 2. ASI 等级按 5e ============ */
const ASI = {
  warrior: [4, 6, 8, 12, 14, 16, 19],
  rogue: [4, 8, 10, 12, 16, 19],
  ranger: [4, 8, 12, 16, 19],
  cleric: [4, 8, 12, 16, 19],
  wizard: [4, 8, 12, 16, 19],
  paladin: [4, 8, 12, 16, 19],
  sorcerer: [4, 8, 12, 16, 19],
  bard: [4, 8, 12, 16, 19],
  druid: [4, 8, 12, 16, 19],
  artificer: [4, 8, 12, 16, 19],
  warlock: [4, 8, 12, 16, 19],
  barbarian: [4, 8, 12, 16, 19],
  monk: [4, 8, 12, 16, 19],
};
for (const [id, arr] of Object.entries(ASI)) if (byId[id]) byId[id].asiLevels = arr;

/* ============ 3. 主职特性补到 20 级 ============ */
const ADD = {
  /* --- 战士 --- */
  warrior: [
    F(11, '额外攻击·二', '使用攻击动作时攻击三次。', { extraAttack: 1 }),
    F(13, '不屈·二', '不屈可以多使用一次。', { indomitableUses: 1 }),
    F(17, '动作如潮·二', '动作如潮每场战斗可以用两次。', { actionSurgeUses: 1 }),
    F(20, '额外攻击·三', '使用攻击动作时攻击四次。', { extraAttack: 1 }),
  ],
  /* --- 游荡者 --- */
  rogue: [
    F(11, '可靠天赋', '任何已熟练的属性检定掷出 9 以下时，按 10 计算。', { reliableTalent: 1 }),
    F(13, '偷袭提升', '偷袭伤害 +1d6。', { sneakAttack: 1 }),
    F(14, '盲感', '看不见的敌人对你没有优势。', { blindsense: 1 }),
    F(15, '滑溜心智', '获得感知豁免熟练。', { saveProfExtra: ['wis'] }),
    F(17, '偷袭提升', '偷袭伤害 +1d6。', { sneakAttack: 1 }),
    F(18, '难以捉摸', '只要你能看见攻击者，它对你就没有优势。', { elusive: 1 }),
    F(20, '命运一击', '每场战斗一次，可以把一次未命中改成命中。', { strokeOfLuck: 1 }),
  ],
  /* --- 游侠 --- */
  ranger: [
    F(11, '狩猎律动', '攻击动作改为对范围内每个敌人各射一箭（简化为额外攻击 +1）。', { extraAttack: 1 }),
    F(13, '偷袭提升', '偷袭伤害 +1d6。', {}),
    F(14, '隐匿于野', '专注移动与隐匿：先攻 +2，隐匿检定 +2。', { initBonus: 2, skillBonus: 2 }),
    F(15, '宿敌提升', '对宿敌的伤害再 +2。', { favoredEnemy: 2 }),
    F(18, '猎鹰之眼', '远程攻击不会再因距离吃亏（近身射击不再劣势）。', { farShot: 1 }),
    F(20, '克敌制胜', '每场战斗第一次攻击必定命中并附加 5 点伤害。', { firstAttackAdvantage: 1 }),
  ],
  /* --- 牧师 --- */
  cleric: [
    F(11, '摧毁亡灵·进阶', '可以摧毁更强大的亡灵（更高 CR 直接湮灭）。', { destroyUndead: 2 }),
    F(14, '摧毁亡灵·高阶', '湮灭门槛再提高一档。', { destroyUndead: 2 }),
    F(17, '摧毁亡灵·大师', '湮灭门槛再提高一档。', { destroyUndead: 2 }),
    F(18, '引导神力·三', '每次休息可以引导神力三次。', { channelUses: 1 }),
    F(20, '神力干预·必成', '神力干预必定成功（不再掷骰）。', { divineInterventionImproved: 1 }),
  ],
  /* --- 法师 --- */
  wizard: [
    F(18, '法术掌控', '一~二环法术不再消耗法术位（每场战斗各一次免费施放）。', { spellMastery: 1 }),
    F(20, '署名法术', '每场战斗可以免费施放一次三环法术。', { signatureSpell: 1 }),
  ],
  /* --- 圣武士 --- */
  paladin: [
    F(11, '至圣斩强化', '每次近战命中都附加 1d8 光耀伤害。', { improvedSmite: 1 }),
    F(14, '净化之触', '附赠动作清除身上一个负面状态（每次长休两次）。', { cleansingTouch: 1 }),
    F(18, '光环扩展', '守护光环的范围与加值都提升（豁免加值再 +1）。', { auraSave: 0, auraRange: 1 }),
    F(20, '神圣誓约', '每场战斗一次，以一个动作进入强化形态：命中 +2、伤害 +5，持续 3 回合。', { sacredOath: 1 }),
  ],
  /* --- 术士 --- */
  sorcerer: [
    F(17, '超魔·再启', '再学一个新超魔。', {}, 'metamagic', 1),
    F(20, '法术转生', '每次短休恢复 4 点术法点。', { sorcerousRestoration: 1 }),
  ],
  /* --- 吟游诗人 --- */
  bard: [
    F(5, '激励骰·d8', '吟游激励骰提升为 d8，且短休即可恢复灵感。', { bardDie: 2, fontOfInspiration: 1 }),
    F(10, '激励骰·d10', '吟游激励骰提升为 d10。', { bardDie: 2 }),
    F(10, '魔法秘典·二', '又从任意职业法术列表中偷来两个法术（计入已知法术）。', { magicalSecrets: 1 }),
    F(14, '魔法秘典·三', '再偷两个法术。', { magicalSecrets: 1 }),
    F(15, '激励骰·d12', '吟游激励骰提升为 d12。', { bardDie: 2 }),
    F(20, '至尊激励', '吟游激励用完后，短休外也可在战斗开始时立刻恢复一次。', { superiorInspiration: 1 }),
  ],
  /* --- 德鲁伊 --- */
  druid: [
    F(4, '野性形态·进阶', '可以变成更强大的野兽（挑战等级上限提高）。', { wildShapeCR: 1 }),
    F(8, '野性形态·高阶', '挑战等级上限再提高一档。', { wildShapeCR: 1 }),
    F(14, '兽形施法', '变形后依然可以施放法术。', { beastSpells: 1 }),
    F(18, '不朽之躯', '衰老减缓；每场战斗开始时回复 10 点生命。', { timelessBody: 1, battleStartTempHp: 8 }),
    F(20, '大德鲁伊', '野性形态次数无限，短休即可恢复。', { archdruid: 1 }),
  ],
  /* --- 奥术工匠 --- */
  artificer: [
    F(11, '法术 storing', '可以把一个一~二环法术存进物品里留待后用（简化为额外一次免费施法）。', { spellStoringItem: 1 }),
    F(15, '魔能护体', 'AC +2。', { ac: 2 }),
    F(20, '灵魂工匠', '最大生命 +20，所有豁免 +1。', { maxHp: 20, saveBonus: 1 }),
  ],
  /* --- 邪术师 --- */
  warlock: [
    F(9, '魔能祈愿·再启', '再学一个新的魔能祈愿。', {}, 'invocation', 1),
    F(11, '玄奥秘术·六环', '每日一次，可以施放一个六环法术而不消耗法术位。', { mysticArcanum: 6 }),
    F(12, '魔能祈愿·再启', '再学一个新的魔能祈愿。', {}, 'invocation', 1),
    F(13, '玄奥秘术·七环', '每日一次，可以施放一个七环法术而不消耗法术位。', { mysticArcanum: 7 }),
    F(15, '魔能祈愿·再启', '再学一个新的魔能祈愿。', {}, 'invocation', 1),
    F(15, '玄奥秘术·八环', '每日一次，可以施放一个八环法术而不消耗法术位。', { mysticArcanum: 8 }),
    F(17, '玄奥秘术·九环', '每日一次，可以施放一个九环法术而不消耗法术位。', { mysticArcanum: 9 }),
    F(18, '魔能祈愿·再启', '再学一个新的魔能祈愿。', {}, 'invocation', 1),
    F(20, ' Eldritch 主宰', '每场战斗开始时，用附赠动作恢复全部契约法术位（每日一次）。', { eldritchMaster: 1 }),
  ],
  /* --- 野蛮人 --- */
  barbarian: [
    F(3, '狂暴·再启', '每日狂暴次数 +1。', { rageMax: 1 }),
    F(6, '狂暴·再启', '每日狂暴次数 +1。', { rageMax: 1 }),
    F(9, '凶蛮重击', '重击时额外附加一颗武器伤害骰。', { brutalCrit: 1 }),
    F(11, '坚韧狂暴', '狂暴中倒下时，可以过一次体质豁免（DC 10）以 1 点生命站起。', { relentlessRage: 1 }),
    F(12, '狂暴·再启', '每日狂暴次数 +1。', { rageMax: 1 }),
    F(13, '凶蛮重击·二', '重击时再额外附加一颗武器伤害骰。', { brutalCrit: 1 }),
    F(15, '持续狂暴', '狂暴不会因为一回合没有攻击而中断。', { persistentRage: 1 }),
    F(17, '狂暴·再启', '每日狂暴次数 +1。', { rageMax: 1 }),
    F(17, '凶蛮重击·三', '重击时再额外附加一颗武器伤害骰。', { brutalCrit: 1 }),
    F(20, '原始勇士', '力量与体质各 +4（上限提高到 24）。', { attrStr: 4, attrCon: 4, attrCap: 4 }),
  ],
  /* --- 武僧 --- */
  monk: [
    F(7, '灵动闪避', '豁免成功时不再受伤害；豁免失败也只受一半。', { evasion: 1 }),
    F(10, '纯净之躯', '免疫毒素与疾病；最大生命 +10。', { poisonImmune: 1, maxHp: 10 }),
    F(13, '日月之舌', '所有语言你都听得懂（事件检定 +2）。', { skillBonus: 2 }),
    F(14, '金刚之魂', '获得全部豁免熟练。', { diamondSoul: 1 }),
    F(18, '空灵之躯', '每场战斗一次，以附赠动作进入虚无状态：受到的伤害减半，持续 2 回合。', { emptyBody: 1 }),
    F(20, '完美自我', '战斗开始时若气点为 0，立刻回复 4 点气。', { perfectSelf: 1 }),
  ],
};

/* 需要「改掉」的旧特性（而不是新增） */
function drop(id, level, name) {
  const c = byId[id];
  if (!c) return;
  c.features = c.features.filter((f) => !(f.level === level && f.name === name));
}
// 术士「法术转生」原本在 1 级（5e 应为 20 级特性）
drop('sorcerer', 1, '法术转生');
// 邪术师原本 10 级的祈愿改到 9 级（5e 表：2/5/7/9/12/15/18）
drop('warlock', 10, '魔能祈愿·秘');
// 德鲁伊 4 级的占位「属性提升」与 ASI 重复
drop('druid', 4, '属性提升');
drop('artificer', 8, '属性提升');

for (const [id, list] of Object.entries(ADD)) {
  if (!byId[id]) continue;
  const have = new Set(byId[id].features.map((f) => f.level + ':' + f.name));
  for (const f of list) if (!have.has(f.level + ':' + f.name)) byId[id].features.push(f);
  byId[id].features.sort((a, b) => a.level - b.level);
}

/* ============ 4. 子职补 6 / 14 级特性 ============ */
const SUB_ADD = {
  'warrior/champion': [
    F(6, '运动健将·进阶', '先攻 +1，最大生命 +8。', { initBonus: 1, maxHp: 8 }),
    F(14, '精通重击·双刃', '重击范围再扩大一点（19-20 → 18-20）。', { critRange: 18 }),
  ],
  'warrior/battlemaster': [
    F(6, '战技精研·进阶', '卓越骰上限 +1。', { superiority: 1 }),
    F(14, '战术大师', '卓越骰再 +1，且短休即可恢复。', { superiority: 1 }),
  ],
  'warrior/berserker': [
    F(6, '狂暴·回气', '狂暴中每次击杀回复 5 点生命。', { rageHealOnKill: 5 }),
    F(14, '致命狂怒', '狂暴中重击额外多一颗伤害骰。', { critExtraDice: 1 }),
  ],
  'rogue/assassin': [
    F(6, '致命毒素', '伤害 +2。', { dmg: 2 }),
    F(14, '死亡一击', '偷袭对未行动过的敌人额外 +2d6。', {}),
  ],
  'rogue/thief': [
    F(6, '轻身', 'AC +1，先攻 +1。', { ac: 1, initBonus: 1 }),
    F(14, '万能工具', '所有技能检定 +2。', { skillBonus: 2 }),
  ],
  'ranger/hunter': [
    F(6, '巨兽杀手·进阶', '对大型敌人的伤害 +2。', { dmg: 2 }),
    F(14, '猎杀专家', '每场战斗第一次攻击必定命中。', { firstAttackAdvantage: 1 }),
  ],
  'ranger/gloomstalker': [
    F(6, '暗影之眼', '黑暗中也能看清；先攻 +2。', { initBonus: 2 }),
    F(14, '幽域之影', '每回合第一次攻击若命中，额外造成 1d6 暗蚀伤害。', { elemDmg: 3 }),
  ],
  'cleric/life': [
    F(8, '神圣打击强化', '近战命中附加 1d8 光耀伤害。', { divineStrike: 1 }),
    F(14, '至善治疗', '你施放的治疗法术额外回复 +10。', { healBonus: 10 }),
  ],
  'cleric/light': [
    F(8, '炽光', '法术强度 +2。', { spellDmg: 2 }),
    F(14, '光耀庇护', 'AC +1，法术 DC +1。', { ac: 1, spellDc: 1 }),
  ],
  'cleric/war': [
    F(8, '战争祭司', '命中 +1，伤害 +1。', { hit: 1, dmg: 1 }),
    F(14, '神圣军备·进阶', '伤害再 +2。', { dmg: 2 }),
  ],
  'wizard/evocation': [
    F(10, '强效塑能', '塑能法术伤害 +3。', { elemDmg: 3 }),
    F(14, '过载塑能', '塑能法术伤害再 +3，法术 DC +1。', { elemDmg: 3, spellDc: 1 }),
  ],
  'wizard/abjuration': [
    F(10, '法术抗性', '法术豁免 +2。', { saveBonus: 2 }),
    F(14, '反制结界', '奥术结界的容量翻倍。', { arcaneWard: 1 }),
  ],
  'wizard/conjuration': [
    F(10, '瞬发咒文', '召唤物额外多存在 1 回合。', {}),
    F(14, '坚韧咒文', '召唤物生命 +10。', { maxHp: 10 }),
  ],
  'wizard/illusion': [
    F(10, '虚实之间', '法术 DC +1。', { spellDc: 1 }),
    F(14, '真实幻象', '法术 DC 再 +1，法术强度 +2。', { spellDc: 1, spellDmg: 2 }),
  ],
  'paladin/devotion': [
    F(6, '奉献光环·进阶', '光环豁免加值再 +1。', { auraSave: 1 }),
    F(14, '纯洁之魂·进阶', '法术 DC +1，豁免 +1。', { spellDc: 1, saveBonus: 1 }),
  ],
  'paladin/vengeance': [
    F(6, '灵魂追猎·进阶', '对仇敌的伤害 +2。', { vowOfEnmity: 1, dmg: 2 }),
    F(14, '不屈复仇者', '最大生命 +15。', { maxHp: 15 }),
  ],
  'sorcerer/draconic': [
    F(6, '元素亲和', '对应元素的法术伤害 +3。', { elemDmg: 3 }),
    F(14, '龙之翼', '获得飞行；AC +1。', { flight: 1, ac: 1 }),
  ],
  'sorcerer/wild_magic': [
    F(6, '幸运爆发', '每场战斗一次，可以把一次掷骰结果改成 20。', { luckPoints: 1 }),
    F(14, '熵增', '法术伤害 +3。', { spellDmg: 3 }),
  ],
  'bard/valor': [
    F(6, '战歌·额外攻击', '使用攻击动作时攻击两次。', { extraAttack: 1 }),
    F(14, '斩杀之歌', '命中 +1，伤害 +2。', { hit: 1, dmg: 2 }),
  ],
  'bard/lore': [
    F(6, '万能学识·二', '再从任意职业法术列表里偷两个法术。', { magicalSecrets: 1 }),
    F(14, '切割咒文·进阶', '技能检定 +2，法术 DC +1。', { skillBonus: 2, spellDc: 1 }),
  ],
  'druid/moon': [
    F(6, '元素野性', '变形为元素形态；最大生命 +10。', { maxHp: 10 }),
    F(14, '远古之躯', '变形后伤害 +2，AC +1。', { dmg: 2, ac: 1 }),
  ],
  'druid/land': [
    F(6, '复生自然', '每场战斗开始时回复 6 点生命。', { battleStartTempHp: 6 }),
    F(14, '自然主宰', '法术 DC +1，法术强度 +2。', { spellDc: 1, spellDmg: 2 }),
  ],
  'artificer/alchemist': [
    F(6, '活化药剂', '消耗品效果增强：使用消耗品时额外回复 5 点生命。', { healBonus: 5 }),
    F(14, '万能溶剂', '法术强度 +3，最大生命 +10。', { spellDmg: 3, maxHp: 10 }),
  ],
  'artificer/battlesmith': [
    F(6, '重装核心', '钢铁卫士获得额外生命与伤害（守卫更强）。', { dmg: 2, maxHp: 10 }),
    F(14, '超频核心', '命中 +1，伤害 +2。', { hit: 1, dmg: 2 }),
  ],
  'warlock/fiend': [
    F(10, '地狱之主', '获得一种伤害抗性（毒素）。', { resist: ['毒素'] }),
    F(14, '烈焰仆从·进阶', '魔能爆伤害 +3。', { elemDmg: 3 }),
  ],
  'warlock/greatold': [
    F(10, '深渊低语', '法术 DC +1。', { spellDc: 1 }),
    F(14, '心灵侵蚀', '法术 DC 再 +1，法术强度 +2。', { spellDc: 1, spellDmg: 2 }),
  ],
  'barbarian/berserker': [
    F(6, '猛击', '狂暴中命中 +1。', { hit: 1 }),
    F(14, '无情狂怒', '狂暴中伤害 +2。', { rageDmg: 2 }),
  ],
  'barbarian/totem': [
    F(6, '鹰之图腾', '先攻 +2，察觉检定 +2。', { initBonus: 2, skillBonus: 2 }),
    F(14, '狼之图腾', '狂暴中命中 +1，伤害 +1。', { hit: 1, dmg: 1 }),
  ],
  'barbarian/zealot': [
    F(6, '魂火', '狂暴中每次命中额外 1d6 光耀伤害（简化为伤害 +3）。', { elemDmg: 3 }),
    F(14, '不灭信仰', '狂暴中倒下时，一次体质豁免（DC 10）成功即以半血站起。', { relentlessRage: 1 }),
  ],
  'monk/openhand': [
    F(6, '开掌', '命中时可以推动目标（简化为伤害 +2）。', { dmg: 2 }),
    F(14, '四两拨千斤', '被近战命中时可以用反应反打（简化为伤害 +2）。', { dmg: 2, riposte: 1 }),
  ],
  'monk/shadow': [
    F(6, '影袭', '先攻 +2，命中 +1。', { initBonus: 2, hit: 1 }),
    F(14, '暗影主宰', '每场战斗一次，可以进入隐形状态两回合。', { shadowMaster: 1 }),
  ],
};
for (const c of D.classes) {
  for (const s of (c.subclasses || [])) {
    const list = SUB_ADD[c.id + '/' + s.id];
    if (!list) continue;
    const have = new Set((s.features || []).map((f) => f.level + ':' + f.name));
    for (const f of list) if (!have.has(f.level + ':' + f.name)) s.features.push(f);
    s.features.sort((a, b) => a.level - b.level);
  }
}

/* ============ 5. 法师：法术书 + 已准备（5e） ============ */
// 已由上面的 SC.wizard 处理（prepared: true）

writeFileSync(p, JSON.stringify(D, null, 2) + '\n', 'utf8');
console.log('classes.json 已更新：ASI 20 级、职业/子职特性补到 20 级、已知法术表按 5e、法师改为「法术书 + 需准备」。');
