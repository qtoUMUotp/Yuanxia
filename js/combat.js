/* 战斗：先攻、动作/附赠动作/反应、法术位、状态、死亡豁免 */
(function (global) {
  const NK = (global.NK = global.NK || {});
  const U = NK.Util;
  const R = NK.Rules;
  const D = NK.Dice;

  const K = {
    sys: 'sys', flavor: 'flavor', roll: 'roll', hit: 'hit', miss: 'miss', crit: 'crit',
    dmg: 'dmg', heal: 'heal', save: 'save', death: 'death', warn: 'warn', spell: 'spell',
  };

  const PHYS = ['挥砍', '穿刺', '钝击'];
  /** 距离档位：0 近身 / 1 中距 / 2 远距 */
  const BAND_NAMES = ['近身', '中距', '远距'];

  /** 装备技能（来自物品的 daily 字段） */
  const ITEM_ABILITIES = {
    clear_mind: {
      action: 'bonus', label: '定神',
      use(c, p, used) {
        const n = Combat.clearConds(c, p);
        p.flags.firstAttackAdvantage = 1;
        p.turnFlags.firstAttackDone = false;
        Combat.line(c, K.spell, `▶ 定神：你把杂念清空（清除 ${n} 个负面状态，本回合攻击具有优势）。`);
      },
    },
    dawn_burst: {
      action: 'bonus', label: '破晓',
      use(c, p) {
        p.buffs.push({ name: '破晓之光', turns: 1, mods: { ac: 2 } });
        R.recalc(p);
        Combat.line(c, K.spell, '▶ 破晓：晨光从盾面炸开（AC +2，并对所有敌人结算 3d8 光耀）。');
        for (const e of c.enemies.filter((x) => x.hp > 0)) {
          Combat.saveDamage(c, e, { dice: '3d8', type: '光耀', dc: R.spellDc(p), attr: 'con', half: true, source: p, isMagic: true });
        }
      },
    },
  };

  function isPlayer(t) { return t.isPlayer === true; }
  function nm(t) { return isPlayer(t) ? '你' : t.name; }
  function condOf(t, id) { return (t.conditions || []).find((x) => x.id === id); }
  function hasTrait(e, id) { return (e.traits || []).some((t) => t.effect === id); }

  const Combat = {
    K,

    /* ================= 构建 ================= */
    balanceFor(def, tier) {
      const table = (NK.Data.get('maps').balance || {})[String(def.act)] || {};
      return table[def.rank] || { hp: 1, dmg: 1, ac: 0, hit: 0 };
    },

    makeEnemy(defId, tier, rng) {
      const def = NK.Data.get('monsters').monsters.find((m) => m.id === defId);
      if (!def) throw new Error('未知怪物: ' + defId);
      const bal = Combat.balanceFor(def, tier);
      const e = {
        isPlayer: false, uid: U.uid('e'),
        id: def.id, name: def.name, rank: def.rank, act: def.act, type: def.type,
        maxHp: Math.max(1, Math.round(def.hp * bal.hp * (tier.hpMul || 1))),
        ac: def.ac + (bal.ac || 0) + (def.rank === 'boss' ? Math.max(0, (tier.id || 1) - 1) : 0),
        attrs: Object.assign({}, def.attrs),
        saveProfs: def.saveProfs || [], skills: def.skills || {},
        resist: (def.resist || []).slice(), immune: (def.immune || []).slice(), vuln: (def.vuln || []).slice(),
        traits: (def.traits || []).slice(),
        atk: {
          name: def.attack.name, bonus: (def.attack.bonus || 4) + (bal.hit || 0) + (tier.hitAdd || 0),
          dice: def.attack.dice, type: def.attack.type, verbs: def.attack.verbs || ['攻击'],
        },
        multiattack: def.multiattack || 0,
        range: def.range || 'melee',
        isRangedAttacker: (def.range || 'melee') === 'ranged',
        abilities: (def.abilities || []).map((a) => Object.assign({}, a)),
        cd: {}, mods: {}, conditions: [], buffs: [],
        dmgMul: (tier.dmgMul || 1) * (bal.dmg || 1),
        xp: def.xp, gold: def.gold, flavor: def.flavor,
        legendary: def.rank === 'boss' ? 1 : 0, legendaryLeft: def.rank === 'boss' ? 1 : 0,
        usedRelentless: false, usedFortitude: false, tempHp: 0,
      };
      e.hp = e.maxHp;
      for (const a of e.abilities) e.cd[a.id] = 0;
      if (hasTrait(e, 'pack_leader')) e.atk.bonus += 1;
      return e;
    },

    makeEncounter(actDef, kind, tier, rng) {
      const cfg = NK.Data.get('maps').encounterRules;
      const list = [];
      if (kind === 'boss') list.push({ id: actDef.boss });
      else if (kind === 'elite') {
        list.push({ id: rng.pick(actDef.elites) });
        if (rng.chance(cfg.elite.addNormalChance)) list.push({ id: rng.pick(actDef.pool), minion: true });
      } else {
        list.push({ id: rng.pick(actDef.pool) });
        const extra = cfg.normal.secondChance + Math.min(0.25, ((tier.id || 1) - 1) * 0.08);
        if (rng.chance(extra)) {
          list.push({ id: rng.pick(actDef.pool), minion: true });
          if (rng.chance(0.2)) list.push({ id: rng.pick(actDef.pool), minion: true });
        }
      }
      return list.map((x) => {
        const e = Combat.makeEnemy(x.id, tier, rng);
        if (x.minion) { e.maxHp = Math.max(1, Math.round(e.maxHp * 0.55)); e.hp = e.maxHp; e.dmgMul *= 0.55; e.minion = true; e.abilities = []; e.xp = Math.round(e.xp * 0.6); }
        return e;
      });
    },

    /** 初始距离：远程怪远远站着，近战怪压到中距，伏击者贴脸；被偷袭则整体拉开一档 */
    initialBand(e, surprise) {
      let b = e.range === 'ranged' ? 2 : (hasTrait(e, 'ambusher') ? 0 : 1);
      if (surprise && b < 2) b += 1;
      return b;
    },

    /* ================= 开战 ================= */
    start(player, enemies, opts) {
      const rng = opts.rng;
      const c = {
        rng, player, enemies, tier: opts.tier, act: opts.act,
        log: [], round: 0, over: false, result: null, source: opts.source || 'battle',
        order: [], turnIndex: 0,
        turn: { action: false, bonus: false, moved: false }, firstRound: true, delayedThisRound: false,
        playerStats: { hits: 0, misses: 0, crits: 0, dmgDealt: 0, dmgTaken: 0 },
      };
      const p = player;
      p.conditions = [];
      p.buffs = (p.buffs || []).filter((b) => b.permanent);
      p.deathSaves = { success: 0, fail: 0 };
      p.dying = false;
      p.tempHp = 0;
      p.usedThisBattle = {};
      p.openedWith = false;
      p.concentration = null;
      p.turnFlags = { usedSneak: false, usedDivineStrike: false, usedGiantKiller: false, uncannyUsed: false, shieldUsed: false, riposteUsed: false, firstAttackDone: false };

      Combat.line(c, K.sys, `—— 战斗开始 ——${c.source === 'boss' ? '【关底】' : c.source === 'elite' ? '【精英】' : ''}`);
      for (const e of enemies) {
        Combat.line(c, K.flavor, `${e.name}：${e.flavor || ''}`);
        Combat.line(c, K.sys, `　${e.name}${e.minion ? '（残兵）' : ''}　HP ${e.hp}　AC ${e.ac}　攻击 ${e.atk.bonus >= 0 ? '+' + e.atk.bonus : e.atk.bonus}　${e.atk.dice}${e.traits.length ? '　' + e.traits.map((t) => { const d = NK.Data.get('monsters').traits[t.effect]; return d ? d.name : t.name; }).join('、') : ''}`);
      }

      // 战斗开始效果
      if (p.flags.battleStartTempHp) { p.tempHp += p.flags.battleStartTempHp; Combat.line(c, K.sys, `你获得 ${p.flags.battleStartTempHp} 点临时生命。`); }
      if (p.flags.arcaneWard) { p.wardHp = p.level * 2 * ((p.mods.arcaneWard || 1) > 1 ? 2 : 1); Combat.line(c, K.sys, `奥术结界展开（${p.wardHp} 点）。`); }
      // 装备被动：先手面甲
      if (p.itemPassives && p.itemPassives.read_the_room) {
        p.readTheRoom = true;
        Combat.line(c, K.sys, '【装备技能】读局：你一眼扫过敌人的架势，本场战斗每回合的第一次攻击都更从容。');
      }

      // 隐匿突袭
      let surprise = false;
      if (opts.allowSurprise !== false) {
        const stealth = R.skillBonus(p, 'stealth');
        const passive = Math.max.apply(null, enemies.map((e) => 10 + (R.mod(e.attrs.wis) || 0) + (e.skills.perception || 0)));
        const res = D.check(rng, stealth, null);
        if (res.total >= passive) {
          surprise = true;
          Combat.line(c, K.sys, `你悄无声息地接近（隐匿 ${res.total} VS 被动察觉 ${passive}）——敌人尚未发现你。`);
        } else {
          Combat.line(c, K.sys, `你的脚步声被听见了（隐匿 ${res.total} VS 被动察觉 ${passive}）。`);
        }
      }

      // 先攻
      const pInit = D.check(rng, R.initiative(p), null);
      p.initRoll = pInit.total;
      const entries = [{ ref: p, init: pInit.total, name: '你' }];
      for (const e of enemies) {
        const i = D.check(rng, R.mod(e.attrs.dex) + (hasTrait(e, 'swift') ? 3 : 0), null);
        entries.push({ ref: e, init: i.total, name: e.name });
        e.initRoll = i.total;
      }
      if (surprise) entries.forEach((x) => { if (!isPlayer(x.ref)) x.init -= 100; });
      entries.sort((a, b) => b.init - a.init);
      c.order = entries;
      c.turnIndex = 0;
      Combat.line(c, K.roll, '先攻顺序：' + entries.map((x) => `${x.name} ${x.init}`).join('　>　'));
      // 初始距离：远程怪远远地站着，近战怪已经压上来，伏击者贴脸
      for (const e of enemies) e.band = Combat.initialBand(e, surprise);
      Combat.line(c, K.sys, `距离：${Combat.distance(c).text}　（你每回合可以移动一档；近战武器需要「近身」，远程与法术在「近身」时有劣势）`);
      // 敌人意图判定：战斗开始时，用你的「察觉 / 洞悉」判定能读穿多少——低感知角色只会感到危险
      {
        const useInsight = (p.proficiencies.skills || []).includes('insight') && R.skillBonus(p, 'insight') >= R.skillBonus(p, 'perception');
        const skill = useInsight ? 'insight' : 'perception';
        const bonus = R.skillBonus(p, skill);
        const diffId = (opts.tier && opts.tier.id) || 1;
        const dc = 10 + (c.act - 1) * 2 + (diffId > 1 ? 2 : 0);
        const res = D.check(rng, bonus, R.checkMode(p, skill));
        const margin = res.total - dc;
        // 通过判定（margin>=0）即给「带数据的细致行为」（tier 2）；勉强没过（margin -3~ -1）只给动作名；完全没过才只给行为类别
        c.intentTier = margin >= 0 ? 2 : (margin >= -3 ? 1 : 0);
        const verdict = c.intentTier === 2 ? '你几乎看透了它们的打算。'
          : c.intentTier === 1 ? '你大致知道它们要做什么，却读不出数值。'
          : '你只隐约感到危险，却读不出细节。';
        Combat.line(c, K.sys, `【意图判定】${skill === 'insight' ? '洞悉' : '察觉'} ${res.total} VS DC ${dc} —— ${verdict}`);
      }
      c.round = 1;
      Combat.refreshIntents(c);
      Combat.line(c, K.sys, `第 1 回合`);
      Combat.beginTurn(c);
      if (!c.over) Combat.runUntilPlayer(c);
      return c;
    },

    line(c, k, t) { c.log.push({ k, t }); },

    /* ================= 回合流程 ================= */
    beginTurn(c) {
      const entry = c.order[c.turnIndex];
      if (!entry) return;
      const t = entry.ref;
      if (Combat.dead(t)) { Combat.nextTurn(c); return; }

      // 回合开始的持续效果
      if (isPlayer(t)) {
        Combat.tickConditions(c, t);
        if (c.over) return;
        Combat.playerTurnStart(c);
      } else {
        Combat.tickConditions(c, t);
        if (hasTrait(t, 'regenerate') && t.hp > 0 && !Combat.dead(t)) Combat.heal(c, t, Math.max(1, Math.round(t.maxHp * 0.05)), '再生');
      }
    },

    playerTurnStart(c) {
      const p = c.player;
      p.turnFlags = { usedSneak: false, usedDivineStrike: false, usedGiantKiller: false, uncannyUsed: false, shieldUsed: false, riposteUsed: false, firstAttackDone: false, hidden: p.turnFlags ? p.turnFlags.hidden : false };
      c.turn.moved = false;
      // 光环 / 召唤物
      for (const b of (p.buffs || [])) {
        if (b.aura && !p.dying) {
          for (const e of c.enemies.filter((x) => x.hp > 0)) {
            Combat.line(c, K.spell, `${b.name}的光环灼烧着${e.name}。`);
            Combat.saveDamage(c, e, { dice: b.aura.dice, type: b.aura.type, dc: R.spellDc(p), attr: b.aura.save, half: b.aura.half, source: p });
          }
        }
        if (b.recurring && !p.dying) {
          const target = c.enemies.filter((x) => x.hp > 0)[0];
          if (target) {
            const r = D.roll(b.recurring.dice, c.rng);
            Combat.line(c, K.spell, `${b.name}自行出击。`);
            Combat.damage(c, target, r.total, b.recurring.type, p);
          }
        }
      }
      if (c.over) return;
      // 死亡豁免
      if (p.dying) {
        Combat.line(c, K.warn, '你在血泊里，意识正在往下沉。');
        Combat.deathSave(c);
        if (!c.over) Combat.endPlayerTurn(c);
        return;
      }
      c.turn = { action: true, bonus: true, moved: false };
      Combat.line(c, K.sys, `▶ 你的回合（第 ${c.round} 回合）`);
    },

    endTurn(c) {
      Combat.nextTurn(c);
      if (!c.over) Combat.runUntilPlayer(c);
    },

    nextTurn(c) {
      if (c.over) return;
      let guard = 0;
      do {
        c.turnIndex += 1;
        if (c.turnIndex >= c.order.length) {
          c.turnIndex = 0;
          c.round += 1;
          c.firstRound = false;
          Combat.endOfRound(c);
          if (c.over) return;
          Combat.line(c, K.sys, `── 第 ${c.round} 回合 ──`);
        }
        if (guard++ > 40) break;
      } while (c.order[c.turnIndex] && Combat.dead(c.order[c.turnIndex].ref));
      Combat.beginTurn(c);
    },

    endOfRound(c) {
      // 状态回合数递减
      for (const t of [c.player].concat(c.enemies)) {
        (t.conditions || []).forEach((x) => { if (x.turns) x.turns -= 1; });
        t.conditions = (t.conditions || []).filter((x) => !x.turns || x.turns > 0);
        (t.buffs || []).forEach((b) => { if (b.turns) b.turns -= 1; });
        const expired = (t.buffs || []).filter((b) => b.turns !== undefined && b.turns !== null && b.turns <= 0);
        if (expired.length) {
          t.buffs = t.buffs.filter((b) => !expired.includes(b));
          for (const b of expired) {
            Combat.line(c, K.sys, `「${b.name}」结束了。`);
            if (t.isPlayer && b.concentration) t.concentration = null;
          }
          if (t.isPlayer) R.recalc(t);
          else Combat.recalcEnemy(t);
        }
      }
      // 敌人冷却在这里结算，随后立刻规划意图——所以预告与实际行动完全一致
      for (const e of c.enemies) {
        for (const k of Object.keys(e.cd)) if (e.cd[k] > 0) e.cd[k] -= 1;
      }
      c.delayedThisRound = false;
      Combat.refreshIntents(c);
    },

    /** 一直推进到轮到我方行动（或战斗结束） */
    runUntilPlayer(c) {
      let guard = 0;
      while (!c.over && guard++ < 60) {
        const cur = c.order[c.turnIndex];
        if (!cur) break;
        if (isPlayer(cur.ref)) {
          if (cur.ref.dying) { Combat.deathSave(c); if (c.over) return; Combat.nextTurn(c); continue; }
          c.turn = { action: true, bonus: true, moved: false };
          return;
        }
        if (Combat.dead(cur.ref)) { Combat.nextTurn(c); continue; }
        Combat.enemyTurn(c, cur.ref);
        if (c.over) return;
        Combat.nextTurn(c);
      }
    },

    /* ================= 伤害 / 治疗 ================= */
    damage(c, target, amount, type, source, opts) {
      if (c.over) return 0;
      const o = opts || {};
      let amt = amount;
      // 免疫 / 抗性 / 易伤（魔法武器无视物理抗性，5e 规则）
      const magical = !!(opts && opts.weapon && opts.weapon.magic) || !!(opts && opts.magic);
      const physFromNonMagic = PHYS.includes(type) && !magical;
      const imm = (target.immune || []).includes(type);
      const res = (target.resist || []).includes(type) && !(PHYS.includes(type) && magical);
      const vul = (target.vuln || []).includes(type);
      if (imm) { Combat.line(c, K.sys, `${nm(target)}对${type}伤害免疫。`); return 0; }
      if (res) { amt = Math.floor(amt / 2); Combat.line(c, K.sys, `${nm(target)}对${type}伤害有抗性${magical && PHYS.includes(type) ? '（魔法武器无视了它）' : ''}。`); }
      if (vul) { amt = Math.floor(amt * 2); Combat.line(c, K.sys, `${nm(target)}对${type}伤害易伤。`); }
      // 减伤（野蛮人狂暴时减伤更高）
      if (isPlayer(target)) amt -= (target.raging ? (target.rageDr || 0) : (target.mods.dr || 0));
      else {
        amt -= (target.raging ? (target.rageDr || 0) : (target.mods.dr || 0));
        if (hasTrait(target, 'damage_resist_all') && PHYS.includes(type)) { amt -= 3; Combat.line(c, K.sys, `${target.name}的躯壳卸去了部分冲击。`); }
      }
      if (condOf(target, 'weakened')) amt = Math.floor(amt / 2);
      amt = Math.max(0, Math.round(amt));
      // 临时生命
      if (target.tempHp > 0) {
        const a = Math.min(target.tempHp, amt);
        target.tempHp -= a; amt -= a;
        Combat.line(c, K.sys, `临时生命吸收了 ${a} 点${target.tempHp > 0 ? `（剩余 ${target.tempHp}）` : '，耗尽了'}。`);
      }
      // 奥术结界
      if (isPlayer(target) && target.wardHp > 0) {
        const a = Math.min(target.wardHp, amt);
        target.wardHp -= a; amt -= a;
        Combat.line(c, K.sys, `奥术结界吸收了 ${a} 点${target.wardHp > 0 ? `（剩余 ${target.wardHp}）` : '，碎裂了'}。`);
      }
      target.hp -= amt;
      if (amt > 0) Combat.line(c, K.dmg, `${nm(target)}受到 ${amt} 点${type || ''}伤害。HP ${Math.max(0, target.hp)}/${target.maxHp}`);
      if (isPlayer(target)) c.playerStats.dmgTaken += amt;
      else c.playerStats.dmgDealt += amt;
      if (target.hp <= 0) Combat.defeat(c, target, source);
      return amt;
    },

    heal(c, target, amount, reason) {
      if (amount <= 0) return 0;
      let amt = amount;
      if (isPlayer(target)) amt += (target.mods.healBonus || 0) + (target.mods.healBonusPerLevel || 0) * target.level;
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + amt);
      const real = target.hp - before;
      if (real > 0) Combat.line(c, K.heal, `${nm(target)}回复了 ${real} 点生命${reason ? `（${reason}）` : ''}。HP ${target.hp}/${target.maxHp}`);
      return real;
    },

    defeat(c, target) {
      if (isPlayer(target)) {
        const p = target;
        if (p.flags.divineIntervention && !p.usedThisBattle.divineIntervention) {
          p.usedThisBattle.divineIntervention = true;
          p.hp = Math.max(1, Math.round(p.maxHp / 2));
          Combat.line(c, K.warn, '你倒下的瞬间，有什么东西接住了你——神力干预。你以一半生命重新站起。');
          return;
        }
        if (p.flags.relentless && !p.usedThisBattle.relentless) {
          p.usedThisBattle.relentless = true;
          p.hp = 1;
          Combat.line(c, K.warn, '半兽人的血不允许你就这么躺下（坚韧不屈）。HP 1');
          return;
        }
        // 装备技能：回息之冠
        if (p.itemPassives && p.itemPassives.second_breath && !p.usedThisBattle.second_breath) {
          p.usedThisBattle.second_breath = true;
          p.hp = 1;
          const n = Combat.clearConds(c, p);
          Combat.line(c, K.warn, `▶ 回息之冠亮了一下：你以 1 点生命重新站起（清除 ${n} 个负面状态）。`);
          return;
        }
        p.hp = 0;
        p.dying = true;
        p.deathSaves = { success: 0, fail: 0 };
        if (!condOf(p, 'dying')) p.conditions.push({ id: 'dying', name: '濒死', turns: null });
        Combat.line(c, K.death, '你倒下了。视野在收缩，耳朵里只剩下自己的心跳。');
        Combat.line(c, K.warn, `死亡豁免：成功 3 次可以稳定伤势，失败 3 次就是真的死了。（0/${3} · 0/${3}）`);
        return;
      }
      // 敌人
      if (hasTrait(target, 'relentless') && !target.usedRelentless) {
        target.usedRelentless = true;
        target.hp = 1;
        Combat.line(c, K.warn, `${target.name}摇摇晃晃地又站起来了！（不屈）`);
        return;
      }
      if (hasTrait(target, 'undead_fortitude') && !target.usedFortitude) {
        target.usedFortitude = true;
        const dc = 5 + Math.abs(target.hp);
        const r = D.check(c.rng, R.mod(target.attrs.con), null);
        if (r.total >= dc) {
          target.hp = 1;
          Combat.line(c, K.warn, `${target.name}的骨头重新拼了起来（亡灵坚韧，豁免 ${r.total} ≥ DC ${dc}）。`);
          return;
        }
      }
      if (target.magic && target.magic.rally && !target.usedRally) { /* 预留 */ }
      target.hp = 0;
      Combat.line(c, K.death, `${target.name}倒下了。`);
      if (c.enemies.every((e) => e.hp <= 0)) { c.over = true; c.result = 'victory'; }
    },

    dead(t) { return t.hp !== undefined && t.hp <= 0 && !isPlayer(t); },

    unsaved(t) { return isPlayer(t) && t.dying; },

    /* ================= 状态 ================= */
    tickConditions(c, t) {
      for (const cond of (t.conditions || []).slice()) {
        if (cond.id === 'burning' && t.hp > 0) {
          const r = D.roll('1d4', c.rng);
          Combat.line(c, K.warn, `「燃烧」在${nm(t)}身上继续。`);
          Combat.damage(c, t, r.total, '火焰', null);
        }
      }
    },
    addCond(c, t, cond, repeat) {
      if (!t.conditions) t.conditions = [];
      if (t.immune && t.immune.includes('中毒') && cond.id === 'poisoned') return false;
      if (t.traits && t.traits.some((x) => x.effect === 'turn_resistance') && ['frightened', 'stunned'].includes(cond.id)) return false;
      if (isPlayer(t) && cond.id === 'frightened' && t.flags.fearImmune) return false;
      const ex = t.conditions.find((x) => x.id === cond.id);
      if (ex) {
        if (cond.turns) ex.turns = Math.max(ex.turns || 0, cond.turns);
        if (repeat) ex.repeat = repeat;
        return false;
      }
      const cc = Object.assign({}, cond);
      if (repeat) cc.repeat = repeat;
      if (!cc.turns) cc.turns = 2;
      t.conditions.push(cc);
      if (!isPlayer(t)) Combat.recalcEnemy(t);
      else R.recalc(t);
      return true;
    },

    /** 5e：定身/束缚/中毒这类效果，受影响者每回合结束可以再投一次豁免 */
    tickRepeatSaves(c, t) {
      if (!t.conditions || !t.conditions.length) return;
      const keep = [];
      for (const cond of t.conditions) {
        if (!cond.repeat || t.hp <= 0) { keep.push(cond); continue; }
        const bonus = isPlayer(t) ? R.saveBonus(t, cond.repeat.attr)
          : (R.mod(t.attrs[cond.repeat.attr]) + ((t.saveProfs || []).includes(cond.repeat.attr) ? 2 : 0));
        const res = D.check(c.rng, bonus, null);
        if (res.total >= cond.repeat.dc) {
          Combat.line(c, K.save, `${nm(t)}挣脱了「${cond.name}」（${NK.Data.get('rules').attrLabels[cond.repeat.attr]}豁免 ${res.total} ≥ DC ${cond.repeat.dc}）。`);
        } else {
          keep.push(cond);
        }
      }
      t.conditions = keep;
      if (!isPlayer(t)) Combat.recalcEnemy(t); else R.recalc(t);
    },
    clearConds(c, t) {
      if (!t.conditions) return 0;
      const n = t.conditions.length;
      t.conditions = [];
      if (!isPlayer(t)) Combat.recalcEnemy(t); else R.recalc(t);
      return n;
    },
    recalcEnemy(e) { /* 敌人的条件不进 mods，AC 修正单独处理 */ },

    /* ================= 攻击 ================= */
    acOf(c, t) {
      let ac = t.ac;
      for (const cond of (t.conditions || [])) if (cond.ac) ac += cond.ac;
      if (isPlayer(t) && condOf(t, 'hasted')) ac += 2;
      if (isPlayer(t) && t.flags.wardingFlare && t.hp <= t.maxHp / 2) ac += 2;
      return ac;
    },

    /* ================= 距离（0 近身 / 1 中距 / 2 远距） ================= */
    bandName(b) { return BAND_NAMES[U.clamp(b || 0, 0, 2)]; },
    /** 这次攻击发生在几档距离上。band 记在敌人身上（对玩家而言的距离），所以两个方向都用它。 */
    bandOf(attacker, target) {
      return isPlayer(target) ? (attacker.band || 0) : (target.band || 0);
    },
    /** 这次攻击能不能够到目标 */
    canReach(attacker, target, weapon) {
      const w = weapon || (isPlayer(attacker) ? attacker.items.mainHand : null);
      const band = Combat.bandOf(attacker, target);
      if (!w) return band === 0;
      if (w.kind === 'ranged') return true;
      const reach = (w.properties || []).includes('reach');
      return band <= (reach ? 1 : 0);
    },
    /** 距离不够时的提示 */
    reachHint(attacker, target, weapon) {
      const w = weapon || (isPlayer(attacker) ? attacker.items.mainHand : null);
      const band = Combat.bandOf(attacker, target);
      if (band === 0) return '';
      return `${w ? w.name : '徒手'}够不到「${BAND_NAMES[band]}」的敌人——先点「接近」拉近一档。`;
    },
    /** 战斗里的距离概览（给界面用） */
    distance(c) {
      const bands = c.enemies.filter((e) => e.hp > 0).map((e) => e.band || 0);
      if (!bands.length) return { min: 0, max: 0, text: '—' };
      const min = Math.min.apply(null, bands);
      const max = Math.max.apply(null, bands);
      return { min, max, text: min === max ? BAND_NAMES[min] : `${BAND_NAMES[min]} ~ ${BAND_NAMES[max]}` };
    },
    /** 玩家移动一档（每回合一次，不消耗动作） */
    move(c, dir) {
      const p = c.player;
      if (c.turn.moved) { Combat.line(c, K.warn, '这一回合你已经调整过位置了。'); return; }
      const alive = c.enemies.filter((e) => e.hp > 0);
      if (!alive.length) return;
      const before = Combat.distance(c);
      let moved = false;
      for (const e of alive) {
        const nb = U.clamp((e.band || 0) + (dir === 'out' ? 1 : -1), 0, 2);
        if (nb !== e.band) { e.band = nb; moved = true; }
      }
      c.turn.moved = true;
      if (!moved) { Combat.line(c, K.warn, dir === 'out' ? '已经退无可退。' : '敌人已经贴在你脸上了。'); }
      else Combat.line(c, K.sys, `▶ 你${dir === 'out' ? '后撤' : '逼近'}——距离：${before.text} → ${Combat.distance(c).text}`);
      Combat.refreshIntents(c);
    },

    attackMode(c, attacker, target, extra) {
      let mode = null;
      for (const cond of (attacker.conditions || [])) {
        if (['poisoned', 'frightened', 'blinded', 'restrained', 'prone'].includes(cond.id)) mode = 'dis';
      }
      // 远程武器与远程法术在近身距离有劣势（5e 规则）
      const atkWeapon = isPlayer(attacker) ? (attacker.items.mainHand || null) : null;
      const rangedAttack = (atkWeapon && atkWeapon.kind === 'ranged') || !!(extra && extra.ranged) || !!attacker.isRangedAttacker;
      if (rangedAttack && Combat.bandOf(attacker, target) === 0) mode = 'dis';
      if (isPlayer(attacker)) {
        if ((attacker.flags.firstAttackAdvantage || (attacker.readTheRoom && !attacker.turnFlags.firstAttackDone)) && !attacker.turnFlags.firstAttackDone) mode = 'adv';
        if (attacker.flags.assassinate && c.firstRound) mode = 'adv';
        if (attacker.turnFlags.hidden) mode = 'adv';
        if (attacker.vowTarget === target.uid) mode = 'adv';
        // 中距/远距时藏身更容易
        if (attacker.turnFlags.hidden && Combat.bandOf(attacker, target) > 0) mode = 'adv';
      } else {
        if (hasTrait(attacker, 'ambusher') && c.firstRound) mode = 'adv';
        if (hasTrait(attacker, 'pack_tactics')) {
          const same = c.enemies.filter((x) => x.hp > 0 && x.id === attacker.id).length - 1;
          if (same > 0) mode = 'adv';
        }
      }
      for (const cond of (target.conditions || [])) {
        if (['restrained', 'blinded', 'prone', 'stunned'].includes(cond.id) && !(isPlayer(target) && cond.id === 'blinded')) mode = 'adv';
      }
      if (isPlayer(target) && target.flags.disadvantageAgainst) mode = 'dis';
      if (hostileAdvantage(attacker, target)) mode = 'adv';
      if (target.dying) mode = 'adv';
      return mode;
    },

    /** 一次攻击检定 + 伤害。opts: {bonus,dice,dmgMod,type,verb,mode,autoCrit,isSpell,riders} */
    attack(c, attacker, target, opts) {
      const isP = isPlayer(attacker);
      let mode = opts.mode !== undefined ? opts.mode : Combat.attackMode(c, attacker, target, { ranged: !!opts.ranged });
      let bonus = opts.bonus;
      const ac = Combat.acOf(c, target);
      // 半身人幸运
      let res = D.check(c.rng, bonus, mode);
      if (res.nat === 1 && isP && attacker.flags.halflingLuck && !attacker.usedThisBattle.halflingLuck) {
        attacker.usedThisBattle.halflingLuck = true;
        Combat.line(c, K.sys, '（幸运）你重投了这次攻击。');
        res = D.check(c.rng, bonus, mode);
      }
      if ((attacker.mods.luckPoints || isP && attacker.flags.luckPoints) && res.nat <= 2) {
        const lp = attacker.luckLeft === undefined ? (attacker.flags.luckPoints || 0) : attacker.luckLeft;
        if (lp > 0) { attacker.luckLeft = lp - 1; Combat.line(c, K.sys, `（幸运点，剩余 ${attacker.luckLeft}）重投。`); res = D.check(c.rng, bonus, mode); }
      }
      const critRange = isP ? (attacker.critRange || 20) : (opts.critRange || 20);
      let crit = !!opts.autoCrit || res.nat >= critRange;
      let hit = crit || (res.nat !== 1 && res.total >= ac);
      // —— 反应：护盾术（被命中且差距在 5 以内时自动消耗法术位）——
      if (hit && isPlayer(target) && !opts.isReaction) {
        const knowsShield = R.castableSpells(target).some((s) => s.id === 'shield') && (target.slots[0] || 0) > 0;
        if (knowsShield && res.total - ac < 5 && !target.turnFlags.shieldUsed) {
          target.slots[0] -= 1;
          target.turnFlags.shieldUsed = true;
          Combat.line(c, K.spell, `▶ 你以反应施放「护盾术」：一道力场墙在刀锋前成形（AC +5，剩余一环法术位 ${target.slots[0]}）。`);
          if (res.total < ac + 5) { hit = false; }
        }
      }
      const modeTxt = mode === 'adv' ? '（优势）' : mode === 'dis' ? '（劣势）' : '';
      Combat.line(c, K.roll, `${nm(attacker)}${opts.verb || '发起攻击'}：d20(${res.rolls.join('/')})${bonus >= 0 ? '+' + bonus : bonus} = ${res.total}${modeTxt} VS AC ${ac} —— ${hit ? (crit ? '重击！' : '命中！') : (res.nat === 1 ? '大失败！' : '未命中。')}`);
      if (isP) { if (hit) { c.playerStats.hits += 1; if (crit) c.playerStats.crits += 1; } else c.playerStats.misses += 1; }
      if (isP) attacker.turnFlags.firstAttackDone = true;
      if (isP) attacker.turnFlags.hidden = false;
      if (!hit) return { hit: false, crit: false, damage: 0, res };

      // 伤害构成
      const parts = [];
      let diceSum = 0, flat = opts.dmgMod || 0;
      const addDice = (spec, label) => {
        const r = D.roll(spec, c.rng);
        diceSum += r.total - r.mod; flat += r.mod;
        parts.push((label ? label + ' ' : '') + D.diceText(r));
      };
      if (opts.dice) {
        addDice(opts.dice);
        if (crit) {
          const extra = ((isP ? (attacker.critMult || 2) : 2) - 1) + (isP ? (attacker.mods.critExtraDice || 0) : 0);
          for (let i = 0; i < extra; i++) { parts.push('重击追加'); addDice(opts.dice); }
          if (isP && attacker.flags.savageAttacks) { parts.push('凶蛮攻击'); addDice(opts.dice); }
        }
      }
      // 玩家的附加伤害
      let autoCritApplied = false;
      if (isP) {
        const p = attacker;
        if (p.flags.sneakAttack && attacker.mods.sneakAttack && mode === 'adv' && !attacker.turnFlags.usedSneak) {
          attacker.turnFlags.usedSneak = true;
          addDice(`${attacker.mods.sneakAttack}d6`, '偷袭');
        }
        if (p.flags.divineStrike && !attacker.turnFlags.usedDivineStrike) {
          attacker.turnFlags.usedDivineStrike = true;
          addDice(`${Math.max(1, p.flags.divineStrike)}d8`, '神圣打击');
        }
        if (p.flags.giantKiller && !attacker.turnFlags.usedGiantKiller && target.maxHp > p.maxHp) {
          attacker.turnFlags.usedGiantKiller = true;
          addDice('1d8', '巨兽杀手');
        }
        if (p.flags.dreadAmbusher && c.firstRound) addDice('1d8', '恐惧伏击');
        if (p.flags.poisonDice) addDice(`${p.flags.poisonDice}d6`, '致命毒素');
        if (target.mark && target.mark.by === p.uid) addDice(target.mark.dice, '猎人印记');
        if (p.nextAttackBonus) { addDice(p.nextAttackBonus.dice, '至圣斩'); p.nextAttackBonus = null; }
        if (p.smiteQueued && p.slots && p.slots[(p.smiteQueued || 1) - 1] > 0) {
          p.slots[p.smiteQueued - 1] -= 1;
          const dd = 2 + (p.smiteQueued - 1);
          addDice(`${dd}d8`, `至圣斩（${p.smiteQueued} 环）`);
          p.smiteQueued = null;
        }
        if (opts.weapon && opts.weapon.extraDice) addDice(opts.weapon.extraDice, opts.weapon.name);
        if (attacker.flags.undeadSlayer && target.type === '亡灵') flat += attacker.flags.undeadSlayer;
        if (attacker.flags.favoredEnemy && ['野兽', '类人', '亡灵'].includes(target.type)) flat += (attacker.flags.favoredEnemy || 0);
        if (attacker.flags.elemDmg && ['火焰', '冰霜', '闪电', '强酸'].includes(opts.type)) flat += attacker.flags.elemDmg;
        if (attacker.raging) flat += (attacker.rageDmg || 0);
      }
      let total = diceSum + flat;
      if (!isP) total = Math.round(total * (attacker.dmgMul || 1));
      total = Math.max(1, total);
      Combat.line(c, K.dmg, `伤害构成：${parts.join(' + ')}　调整值 ${flat >= 0 ? '+' + flat : flat} = ${total}`);
      // 镜像术
      if (!isPlayer(target) && target.mirrorLeft > 0) {
        target.mirrorLeft -= 1;
        Combat.line(c, K.sys, `幻影替${target.name}挨了这一下（剩余 ${target.mirrorLeft} 层镜像）。`);
        return { hit: true, crit, damage: 0, res, negated: true };
      }
      if (isPlayer(target) && target.mirrorLeft > 0) {
        target.mirrorLeft -= 1;
        Combat.line(c, K.sys, `一个幻影替你碎了（剩余 ${target.mirrorLeft} 层镜像）。`);
        return { hit: true, crit, damage: 0, res, negated: true };
      }
      const dealt = Combat.damage(c, target, total, opts.type, attacker);
      // —— 反应：不屈闪避（游荡者，每回合一次伤害减半）——
      if (isPlayer(target) && dealt > 0 && target.flags.uncannyDodge && !target.turnFlags.uncannyUsed && !opts.isReaction) {
        target.turnFlags.uncannyUsed = true;
        const back = Math.floor(dealt / 2);
        target.hp = Math.min(target.maxHp, target.hp + back);
        Combat.line(c, K.sys, `（不屈闪避）你侧身卸掉了一半力道，回复 ${back} 点生命。HP ${target.hp}/${target.maxHp}`);
      }
      // 命中附带的状态
      if (opts.weapon && opts.weapon.onHitCond && target.hp > 0) {
        Combat.addCond(c, target, opts.weapon.onHitCond);
        Combat.line(c, K.warn, `${target.name}陷入了「${opts.weapon.onHitCond.name}」。`);
      }
      if (isP && attacker.flags.vampiric) Combat.heal(c, attacker, attacker.flags.vampiric, '汲血');
      // 敌人的荆棘/反伤
      if (isP && target.hp > 0 && target.thorns) Combat.damage(c, attacker, target.thorns, '穿刺', target);
      // 应战反击
      if (!isP && isPlayer(target) && target.flags.riposte && !target.turnFlags.riposteUsed) {
        target.turnFlags.riposteUsed = true;
        Combat.line(c, K.sys, '（哨兵）你抓住了它出招的间隙。');
        Combat.attack(c, target, attacker, { bonus: R.attackBonus(target), dice: R.weaponDice(target), dmgMod: R.damageBonus(target), type: target.items.mainHand ? target.items.mainHand.dmgType : '钝击', verb: '反击', weapon: target.items.mainHand });
      }
      return { hit: true, crit, damage: dealt, res };
    },

    /* ================= 豁免 ================= */
    saveDamage(c, target, opts) {
      const { dice, type, dc, attr, half, cond, source, dmgMul } = opts;
      const bonus = isPlayer(target) ? R.saveBonus(target, attr) : (R.mod(target.attrs[attr]) + ((target.saveProfs || []).includes(attr) ? Math.max(2, Math.floor((target.act || 1) + 1)) : 0));
      let mode = isPlayer(target) ? R.saveMode(target, attr) : null;
      if (!isPlayer(target) && hasTrait(target, 'magic_resistance') && opts.isMagic) mode = 'adv';
      if (isPlayer(target) && mode === 'dis' && R.armorPenalty(target).strDexDisadvantage) {
        Combat.line(c, K.warn, '（未熟练的护甲让这次豁免处于劣势）');
      }
      let res = D.check(c.rng, bonus, mode);
      if (isPlayer(target) && res.total < dc && target.flags.indomitable && !target.usedThisBattle.indomitable) {
        target.usedThisBattle.indomitable = true;
        Combat.line(c, K.sys, '（不屈）你重投了这次豁免。');
        res = D.check(c.rng, bonus, mode);
      }
      const ok = res.nat !== 1 && res.total >= dc;
      const attrName = NK.Data.get('rules').attrLabels[attr];
      Combat.line(c, K.save, `${nm(target)}进行${attrName}豁免：d20(${res.rolls.join('/')})${bonus >= 0 ? '+' + bonus : bonus} = ${res.total} VS DC ${dc} —— ${ok ? '成功' : '失败'}`);
      let total = 0;
      if (dice) {
        const r = D.roll(dice, c.rng, dmgMul || 1);
        total = r.total;
        Combat.line(c, K.roll, `伤害骰：${D.diceText(r)}`);
        if (opts.flat) total += opts.flat;
        if (ok && half) total = Math.floor(total / 2);
        if (ok && !half) total = 0;
        // 游荡者闪避
        if (ok && half && isPlayer(target) && target.flags.evasion) { total = 0; Combat.line(c, K.sys, '（闪避）你完全避开了。'); }
      }
      if (total > 0) Combat.damage(c, target, total, type, source);
      if (!ok && cond && target.hp > 0) {
        const added = Combat.addCond(c, target, cond, { attr, dc });
        Combat.line(c, K.warn, `${nm(target)}陷入了「${cond.name}」${added ? '' : '（时间叠加）'}。`);
      }
      return { ok, total };
    },

    /* ================= 死亡豁免 ================= */
    deathSave(c) {
      const p = c.player;
      const r = D.check(c.rng, 0, null);
      if (r.nat === 20) {
        p.hp = 1; p.dying = false; p.deathSaves = { success: 0, fail: 0 };
        p.conditions = p.conditions.filter((x) => x.id !== 'dying');
        Combat.line(c, K.heal, '自然 20！你猛地吸进一口气——你活过来了。HP 1');
        return;
      }
      if (r.nat === 1) { p.deathSaves.fail += 2; Combat.line(c, K.death, `自然 1！伤势急剧恶化（失败 ${p.deathSaves.fail}/3）。`); }
      else if (r.total >= 10) { p.deathSaves.success += 1; Combat.line(c, K.save, `死亡豁免：d20(${r.nat}) = ${r.total} ≥ 10 —— 成功（${p.deathSaves.success}/3）`); }
      else { p.deathSaves.fail += 1; Combat.line(c, K.save, `死亡豁免：d20(${r.nat}) = ${r.total} < 10 —— 失败（${p.deathSaves.fail}/3）`); }
      if (p.deathSaves.success >= 3) {
        p.hp = 1; p.dying = false;
        p.conditions = p.conditions.filter((x) => x.id !== 'dying');
        Combat.line(c, K.heal, '你稳住了伤势。血不再往外流——但你还在战场上。HP 1');
      } else if (p.deathSaves.fail >= 3) {
        c.over = true; c.result = 'defeat';
        Combat.line(c, K.death, '你的手从地面上滑了下去。这一次没有人会把你叫醒。');
      }
    },

    autoDeathSaves(c) { if (c.player.dying && !c.over) Combat.deathSave(c); },

    /* ================= 行动顺序 ================= */
    /** 延后：把自己移到本回合顺序的最后（每回合一次）。已经排最后就没意义了。 */
    delayTurn(c) {
      if (c.delayedThisRound) { Combat.line(c, K.warn, '这个回合你已经延后过一次了。'); return; }
      const idx = c.turnIndex;
      const entry = c.order[idx];
      if (!entry || !isPlayer(entry.ref)) return;
      if (idx >= c.order.length - 1) { Combat.line(c, K.warn, '你已经排在本回合最后了，再延后就等于放弃这一轮。'); return; }
      c.order.splice(idx, 1);
      c.order.push(entry);
      c.delayedThisRound = true;
      // 回合交给原本排在你后面、现在顶到 idx 的那一位：nextTurn 会先 +1，所以这里回退一格
      c.turnIndex = idx - 1;
      Combat.line(c, K.sys, `▶ 你让出先手，退到本回合的最后（顺序：${c.order.map((x) => x.name).join(' > ')}）。`);
      Combat.endPlayerTurn(c);
    },

    /* ================= 玩家行动 ================= */
    availableActions(c) {
      const p = c.player;
      const cls = R.classDef(p.classId);
      const skills = [];
      // 法术
      const pen = R.armorPenalty(p);
      const spells = pen.noSpellcasting ? [] : R.castableSpells(p).map((sp) => {
        if (sp.level === 0) return { spell: sp, slot: 0, label: `${sp.name}（戏法）`, ok: true };
        if (p.pactLevel) return { spell: sp, slot: p.pactLevel, label: `${sp.name}（邪术环·${NK.Data.get('rules').slotLevelNames[p.pactLevel - 1]}）`, ok: (p.pactSlots || 0) > 0 };
        const canBase = (p.slots[sp.level - 1] || 0) > 0;
        return { spell: sp, slot: sp.level, label: `${sp.name}（${NK.Data.get('rules').slotLevelNames[sp.level - 1]}）`, ok: canBase };
      });
      // 升环选项
      const upcast = [];
      for (const sp of R.castableSpells(p)) {
        if (p.pactLevel) continue;
        if (!sp.upcast || sp.level === 0) continue;
        for (let lv = sp.level + 1; lv <= 5; lv++) {
          if ((p.slots[lv - 1] || 0) > 0) upcast.push({ spell: sp, slot: lv, label: `${sp.name}（升环·${NK.Data.get('rules').slotLevelNames[lv - 1]}）`, ok: true });
        }
      }
      // 附赠动作
      const bonus = [];
      if (p.flags.secondWind && !p.usedThisBattle.secondWind) bonus.push({ id: 'secondWind', label: `回气（1d10+${p.level}）` });
      if (p.flags.cunningAction) { bonus.push({ id: 'hide', label: '灵巧动作：隐匿' }); bonus.push({ id: 'disengage', label: '灵巧动作：撤离' }); }
      if (p.flags.layOnHands) bonus.push({ id: 'layOnHands', label: `圣疗（剩余 ${p.layPool || 0}）` });
      if (p.flags.channelDivinity && !p.usedThisBattle.channel) bonus.push({ id: 'channel', label: '引导神力' });
      if (p.flags.sacredWeapon && !p.usedThisBattle.sacredWeapon) bonus.push({ id: 'sacredWeapon', label: '神圣武器' });
      if (p.flags.vowOfEnmity && !p.usedThisBattle.vow) bonus.push({ id: 'vow', label: '仇敌誓言' });
      if (p.flags.breathWeapon && !p.usedThisBattle.breath) bonus.push({ id: 'breath', label: '龙裔吐息' });
      if (p.flags.divineSmite && p.slots.some((s, i) => i > 0 && s > 0)) {
        bonus.push({ id: 'smite1', label: '至圣斩（1 环）' });
        if ((p.slots[1] || 0) > 0) bonus.push({ id: 'smite2', label: '至圣斩（2 环）' });
      }
      if (p.flags.actionSurge && !p.usedThisBattle.actionSurge) bonus.push({ id: 'actionSurge', label: '动作如潮（额外动作）' });
      if (p.flags.superiority && (p.superiorityLeft || 0) > 0) bonus.push({ id: 'superiority', label: `卓越骰（剩余 ${p.superiorityLeft}）` });
      // 双武器战斗：左手有武器时可以用附赠动作再打一次
      if (p.items.offHand && p.items.offHand.dice) bonus.push({ id: 'offhand', label: `副手攻击（${p.items.offHand.name}）` });
      // 稳定瞄准（游荡者）：本回合没移动过就能换来优势
      if (p.flags.steadyAim && !c.turn.moved && !p.turnFlags.hidden) bonus.push({ id: 'steadyAim', label: '稳定瞄准（本回合未移动）' });
      // 野蛮人：狂暴（附赠动作，本场战斗减伤/增伤/凶蛮攻击）
      if (p.flags.rage && !p.raging && (p.rageLeft || 0) > 0) bonus.push({ id: 'rage', label: `狂暴（剩余 ${p.rageLeft}）` });
      // 武僧：气技（附赠动作）
      if (p.flags.ki && (p.kiLeft || 0) >= 1 && p.flags.flurry) bonus.push({ id: 'flurry', label: '疾风连击（1 气）' });
      if (p.flags.ki && (p.kiLeft || 0) >= 1 && p.flags.stun) bonus.push({ id: 'stun', label: '震慑拳（1 气）' });
      // 装备技能（附赠动作类）
      for (const ab of (p.itemAbilities || [])) {
        const def = ITEM_ABILITIES[ab.id];
        if (!def || def.action !== 'bonus') continue;
        if (p.usedThisBattle['item_' + ab.id]) continue;
        bonus.push({ id: 'item:' + ab.id, label: `${def.label}（${ab.source}）` });
      }
      const items = (p.inventory || []).map((it, i) => ({ item: it, index: i }));
      // 距离：能不能够到最近的敌人 / 能不能移动
      const front = c.enemies.filter((e) => e.hp > 0).sort((a, b) => (a.band || 0) - (b.band || 0))[0] || null;
      const dist = Combat.distance(c);
      const move = {
        canIn: !c.turn.moved && dist.min > 0,
        canOut: !c.turn.moved && dist.max < 2,
        text: dist.text,
      };
      return { spells, upcast, bonus, items, cls, move, front, canReachFront: front ? Combat.canReach(p, front) : false };
    },

    castCost(c, cost) {
      if (cost === 'action' && !c.turn.action) { Combat.line(c, K.warn, '本回合的动作已经用掉了。'); return false; }
      if (cost === 'bonus' && !c.turn.bonus) { Combat.line(c, K.warn, '本回合的附赠动作已经用掉了。'); return false; }
      return true;
    },

    playerAction(c, action) {
      if (c.over) return c;
      const p = c.player;
      if (p.dying) { Combat.line(c, K.warn, '你正处在濒死状态，除了等待别无选择。'); return c; }
      switch (action.type) {
        case 'attack': Combat.doAttackAction(c, action); break;
        case 'cast': Combat.castSpell(c, action); break;
        case 'bonus': Combat.doBonus(c, action); break;
        case 'item': Combat.useItem(c, action); break;
        case 'move': Combat.move(c, action.dir || 'in'); break;
        case 'delay': Combat.delayTurn(c); break;
        case 'dodge':
          if (!Combat.castCost(c, 'action')) break;
          c.turn.action = false;
          p.dodging = true;
          Combat.line(c, K.sys, '你压低重心，专注防守。攻击你的检定具有劣势，直到你的下回合。');
          break;
        case 'endTurn': Combat.endPlayerTurn(c); break;
        default: break;
      }
      return c;
    },

    endPlayerTurn(c) {
      const p = c.player;
      p.dodging = false;
      Combat.tickRepeatSaves(c, p);
      if (c.over) return;
      Combat.nextTurn(c);
      if (!c.over) Combat.runUntilPlayer(c);
    },

    doAttackAction(c, action) {
      const p = c.player;
      if (!c.turn.action) { Combat.line(c, K.warn, '本回合的动作已经用掉了。'); return; }
      const first = Combat.pickTarget(c, action.target);
      if (first && !Combat.canReach(p, first)) {
        Combat.line(c, K.warn, Combat.reachHint(p, first));
        return;
      }
      c.turn.action = false;
      const times = 1 + (p.mods.extraAttack || 0);
      for (let i = 0; i < times; i++) {
        const target = Combat.pickTarget(c, action.target);
        if (!target || c.over) break;
        const w = p.items.mainHand;
        const verb = (w && w.verbs && w.verbs.length) ? c.rng.pick(w.verbs) : '挥出一击';
        Combat.attack(c, p, target, {
          bonus: R.attackBonus(p, w), dice: R.weaponDice(p, w), dmgMod: R.damageBonus(p, w),
          type: w ? w.dmgType : '钝击', verb, weapon: w,
        });
      }
    },
    pickTarget(c, uid) {
      const alive = c.enemies.filter((e) => e.hp > 0);
      if (!alive.length) return null;
      if (uid) { const t = alive.find((e) => e.uid === uid); if (t) return t; }
      return alive[0];
    },

    /* ================= 施法 ================= */
    castSpell(c, action) {
      const p = c.player;
      const sp = R.spellDef(action.spellId);
      if (!sp) return;
      const pen = R.armorPenalty(p);
      if (pen.noSpellcasting) {
        Combat.line(c, K.warn, `你穿着不熟练的护甲（${pen.badArmor ? p.items.body.name : p.items.offHand.name}），手势被绊住了——无法施法。`);
        return;
      }
      const slotLv = action.slot || 0;
      if (NK.Codex) NK.Codex.discover('spells', sp.id);
      const isBonus = sp.action === '附赠动作';
      if (!Combat.castCost(c, isBonus ? 'bonus' : 'action')) return;
      if (slotLv > 0) {
        if (p.pactLevel && slotLv === p.pactLevel) {
          if ((p.pactSlots || 0) <= 0) { Combat.line(c, K.warn, '没有可用的邪术环。'); return; }
          p.pactSlots -= 1;
        } else {
          if ((p.slots[slotLv - 1] || 0) <= 0) { Combat.line(c, K.warn, '没有可用的法术位。'); return; }
          p.slots[slotLv - 1] -= 1;
        }
      }
      if (isBonus) c.turn.bonus = false; else c.turn.action = false;
      const over = slotLv > sp.level ? `（升环 ${slotLv} 环）` : '';
      const slotInfo = p.pactLevel && slotLv === p.pactLevel
        ? `剩余邪术环 ${p.pactSlots}`
        : (p.slots.map((n, i) => n > 0 ? `${i + 1}环×${n}` : null).filter(Boolean).join(' ') || '无');
      Combat.line(c, K.spell, `▶ 你施放了「${sp.name}」${over}${slotLv > 0 ? `　${slotInfo}` : ''}`);
      const up = slotLv - sp.level;
      const extraDice = sp.upcast && sp.upcast.per && sp.upcast.per.includes('d') ? up : 0;
      const extraUnits = sp.upcast && sp.upcast.per === 'dart' ? up : 0;
      const flatUp = sp.upcast && sp.upcast.per && sp.upcast.per.startsWith('tempHp:') ? up * parseInt(sp.upcast.per.split(':')[1], 10) : 0;

      if (sp.concentration) {
        if (p.concentration) {
          p.buffs = p.buffs.filter((b) => b.spellId !== p.concentration);
          R.recalc(p);
          Combat.line(c, K.sys, '（专注）你放弃了之前的法术。');
        }
        p.concentration = sp.id;
      }

      const targets = sp.targets === 'all' ? c.enemies.filter((e) => e.hp > 0) : [Combat.pickTarget(c, action.target)].filter(Boolean);
      // 戏法随等级提升伤害骰
      const cmul = sp.level === 0 && sp.dice ? R.cantripMul(p) : 1;
      const spellDice = cmul > 1 ? R.scaleDice(sp.dice, cmul) : sp.dice;
      if (cmul > 1) Combat.line(c, K.sys, `（戏法强化：${sp.dice} → ${spellDice}）`);

      if (sp.kind === 'spell_attack') {
        const t = targets[0]; if (!t) return;
        const times = (sp.darts || 1) + extraUnits;
        for (let i = 0; i < times; i++) {
          if (c.over) break;
          const tg = Combat.pickTarget(c, action.target);
          if (!tg) break;
          Combat.attack(c, p, tg, {
            bonus: R.spellAttack(p), dice: spellDice,
            dmgMod: sp.addMain ? R.spellMod(p) : 0, type: sp.dmgType,
            verb: sp.name, isSpell: true, ranged: true,
          });
          if (sp.nextAttackAdvantage) { p.flags.firstAttackAdvantage = 1; }
        }
      } else if (sp.kind === 'auto') {
        const times = (sp.darts || 1) + extraUnits;
        for (const t of targets) {
          for (let i = 0; i < times; i++) {
            if (c.over) break;
            const r = D.roll(sp.dice, c.rng);
            Combat.line(c, K.dmg, `飞弹命中${t.name}：${D.diceText(r)}`);
            Combat.damage(c, t, r.total, sp.dmgType, p);
          }
        }
      } else if (sp.kind === 'save') {
        for (const t of targets) {
          if (c.over) break;
          let dice = cmul > 1 ? spellDice : sp.dice;
          if (extraDice) { const base = D.parse(dice); dice = `${base.count + extraDice * (sp.upcast.per.startsWith('1d') ? 1 : 1)}d${base.sides}${base.mod ? (base.mod > 0 ? '+' + base.mod : base.mod) : ''}`; }
          Combat.saveDamage(c, t, {
            dice, type: sp.dmgType, dc: R.spellDc(p), attr: sp.save, half: sp.half,
            cond: sp.cond, source: p, isMagic: true, dmgMul: 1, flat: sp.addMain ? R.spellMod(p) : 0,
          });
        }
      } else if (sp.kind === 'heal') {
        let spec = sp.dice;
        if (extraDice) { const b = D.parse(spec); spec = `${b.count + extraDice}d${b.sides}${b.mod ? (b.mod > 0 ? '+' + b.mod : b.mod) : ''}`; }
        const r = D.roll(spec, c.rng);
        let amt = r.total + (sp.addMain ? R.spellMod(p) : 0) + (p.mods.spellDmg || 0);
        Combat.line(c, K.roll, `治疗骰：${D.diceText(r)}`);
        Combat.heal(c, p, amt, sp.name);
        if (sp.cleanse) { const n = Combat.clearConds(c, p); Combat.line(c, K.sys, `负面状态被驱散了（${n} 个）。`); }
      } else if (sp.kind === 'buff') {
        if (sp.tempHp) { p.tempHp += sp.tempHp + flatUp; Combat.line(c, K.sys, `获得 ${sp.tempHp + flatUp} 点临时生命。`); }
        if (sp.mirror) { p.mirrorLeft = (p.mirrorLeft || 0) + sp.mirror; Combat.line(c, K.sys, `幻影分裂开来（${p.mirrorLeft} 层镜像）。`); }
        const mods = Object.assign({}, sp.mods || {});
        if (sp.disadvantageAgainst) mods.disadvantageAgainst = 1;
        if (sp.flight) mods.flight = 1;
        if (sp.acSet) mods.acSet = sp.acSet;
        if (sp.extraAttack) mods.extraAttack = sp.extraAttack;
        if (sp.nextAttackAdvantage) { p.flags.firstAttackAdvantage = 1; Combat.line(c, K.sys, '你的下一次攻击将具有优势。'); }
        if (sp.bonusDamageNext) { p.nextAttackBonus = sp.bonusDamageNext; Combat.line(c, K.sys, `下一次命中将附加 ${sp.bonusDamageNext.dice} ${sp.bonusDamageNext.type} 伤害。`); }
        if (sp.mark) { const t = targets[0]; if (t) { t.mark = { by: p.uid, dice: sp.mark.dice, type: sp.mark.type }; Combat.line(c, K.sys, `你标记了${t.name}。`); } }
        if (sp.aura) p.buffs.push({ name: sp.name, spellId: sp.id, turns: sp.turns || 99, concentration: sp.concentration, aura: sp.aura, mods: {} });
        if (sp.recurring) p.buffs.push({ name: sp.name, spellId: sp.id, turns: sp.turns || 99, concentration: sp.concentration, recurring: sp.recurring, mods: {} });
        if (Object.keys(mods).length) {
          p.buffs.push({ name: sp.name, spellId: sp.id, turns: sp.turns || 99, concentration: sp.concentration, mods });
          Combat.line(c, K.sys, `你获得了「${sp.name}」。`);
        }
        if (sp.cleanse) { const n = Combat.clearConds(c, p); Combat.line(c, K.sys, `负面状态被驱散了（${n} 个）。`); }
        R.recalc(p);
      } else if (sp.kind === 'debuff') {
        for (const t of targets) {
          if (c.over) break;
          if (sp.save) {
            const dc = R.spellDc(p);
            const bonus = R.mod(t.attrs[sp.save]) + (t.saveProfs.includes(sp.save) ? 2 : 0);
            const res = D.check(c.rng, bonus, null);
            const ok = res.nat !== 1 && res.total >= dc;
            Combat.line(c, K.save, `${t.name}进行${NK.Data.get('rules').attrLabels[sp.save]}豁免：d20(${res.nat})${bonus >= 0 ? '+' + bonus : bonus} = ${res.total} VS DC ${dc} —— ${ok ? '成功' : '失败'}`);
            if (ok) continue;
          }
          if (sp.cond) {
            Combat.addCond(c, t, sp.cond);
            Combat.line(c, K.warn, `${t.name}陷入了「${sp.cond.name}」。`);
          }
        }
      } else if (sp.kind === 'utility') {
        const n = Combat.clearConds(c, p);
        if (sp.dispel) { for (const t of targets) { t.buffs = []; Combat.line(c, K.sys, `${t.name}身上的增益被剥离了。`); } }
        Combat.line(c, K.sys, sp.cleanse ? `负面状态被驱散了（${n} 个）。` : '法术生效了。');
      }
    },

    /* ================= 附赠动作 ================= */
    doBonus(c, action) {
      const p = c.player;
      if (!c.turn.bonus) { Combat.line(c, K.warn, '本回合的附赠动作已经用掉了。'); return; }
      const id = action.id;
      if (id.startsWith('item:')) {
        const abId = id.slice(5);
        const def = ITEM_ABILITIES[abId];
        if (!def || p.usedThisBattle['item_' + abId]) return;
        c.turn.bonus = false;
        p.usedThisBattle['item_' + abId] = true;
        def.use(c, p);
        return;
      }
      if (id === 'offhand') {
        const w = p.items.offHand;
        if (!w || !w.dice) { Combat.line(c, K.warn, '左手没有武器。'); return; }
        const t = Combat.pickTarget(c, action.target);
        if (!t) return;
        if (!Combat.canReach(p, t, w)) { Combat.line(c, K.warn, Combat.reachHint(p, t, w)); return; }
        c.turn.bonus = false;
        const verb = (w.verbs && w.verbs.length) ? c.rng.pick(w.verbs) : '以副手挥出一击';
        Combat.line(c, K.sys, `▶ 副手攻击（${w.name}）${p.mods.offhandDmg ? `　双武器战斗风格：伤害 +${p.mods.offhandDmg}` : '　副手不加属性调整值'}`);
        Combat.attack(c, p, t, {
          bonus: R.attackBonus(p, w), dice: w.dice,
          dmgMod: R.damageBonus(p, w, { offhand: true }),
          type: w.dmgType, verb, weapon: w,
        });
        return;
      }
      if (id === 'secondWind') {
        if (!p.flags.secondWind || p.usedThisBattle.secondWind) return;
        c.turn.bonus = false; p.usedThisBattle.secondWind = true;
        const r = D.roll('1d10', c.rng);
        Combat.line(c, K.sys, '▶ 回气');
        Combat.heal(c, p, r.total + p.level, '回气');
      } else if (id === 'steadyAim') {
        c.turn.bonus = false;
        p.flags.firstAttackAdvantage = 1;
        p.turnFlags.firstAttackDone = false;
        Combat.line(c, K.sys, '▶ 稳定瞄准：你放慢呼吸，把全部的注意力压在目标身上（下一次攻击具有优势）。');
      } else if (id === 'hide') {
        c.turn.bonus = false;
        const mode = R.checkMode(p, 'stealth');
        const res = D.check(c.rng, R.skillBonus(p, 'stealth'), mode);
        Combat.line(c, K.roll, `隐匿检定：d20(${res.rolls.join('/')})${res.bonus >= 0 ? '+' + res.bonus : res.bonus} = ${res.total}${mode ? '（劣势）' : ''} VS DC 12`);
        if (res.total >= 12) { p.turnFlags.hidden = true; Combat.line(c, K.sys, '你藏进了阴影里——下一次攻击具有优势。'); }
        else Combat.line(c, K.warn, '你没藏住。');
      } else if (id === 'disengage') {
        c.turn.bonus = false;
        p.buffs.push({ name: '撤离', turns: 1, mods: { ac: 2 } });
        R.recalc(p);
        Combat.line(c, K.sys, '你退开半步，护住了自己的侧面（AC +2 直到下回合）。');
      } else if (id === 'layOnHands') {
        const pool = p.layPool || 0;
        if (pool <= 0) { Combat.line(c, K.warn, '圣疗池已经空了。'); return; }
        c.turn.bonus = false;
        const amount = Math.min(pool, Math.max(1, Math.ceil(p.maxHp * 0.35)));
        p.layPool = pool - amount;
        Combat.heal(c, p, amount, '圣疗');
      } else if (id === 'channel') {
        c.turn.bonus = false; p.usedThisBattle.channel = true;
        if (p.flags.channelHeal) {
          const r = D.roll(p.flags.channelHeal, c.rng);
          Combat.line(c, K.spell, '▶ 引导神力：维生');
          Combat.heal(c, p, r.total + R.spellMod(p), '引导神力');
        } else if (p.flags.channelBurst) {
          Combat.line(c, K.spell, '▶ 引导神力：灼光');
          for (const e of c.enemies.filter((x) => x.hp > 0)) {
            Combat.saveDamage(c, e, { dice: p.flags.channelBurst, type: '火焰', dc: R.spellDc(p), attr: 'dex', half: true, source: p, isMagic: true });
          }
        } else Combat.line(c, K.warn, '你的领域没有可用的引导神力效果。');
      } else if (id === 'sacredWeapon') {
        c.turn.bonus = false; p.usedThisBattle.sacredWeapon = true;
        p.buffs.push({ name: '神圣武器', turns: 3, mods: { hit: Math.max(1, R.mod(p.attrs.cha)) } });
        R.recalc(p);
        Combat.line(c, K.spell, `▶ 神圣武器：武器泛起白光（命中 +${Math.max(1, R.mod(p.attrs.cha))}，3 回合）。`);
      } else if (id === 'vow') {
        const t = Combat.pickTarget(c, action.target);
        if (!t) return;
        c.turn.bonus = false; p.usedThisBattle.vow = true;
        p.vowTarget = t.uid;
        Combat.line(c, K.spell, `▶ 仇敌誓言：你盯着${t.name}，直到它死。`);
      } else if (id === 'breath') {
        c.turn.bonus = false; p.usedThisBattle.breath = true;
        const dd = Math.min(5, 1 + Math.floor(p.level / 2));
        Combat.line(c, K.spell, `▶ 龙裔吐息（${dd}d6 火焰）`);
        for (const e of c.enemies.filter((x) => x.hp > 0)) {
          Combat.saveDamage(c, e, { dice: `${dd}d6`, type: '火焰', dc: 8 + p.prof + R.mod(p.attrs.con), attr: 'dex', half: true, source: p });
        }
      } else if (id === 'actionSurge') {
        c.turn.bonus = false; p.usedThisBattle.actionSurge = true;
        c.turn.action = true;
        Combat.line(c, K.sys, '▶ 动作如潮：你还有一次动作。');
      } else if (id === 'superiority') {
        c.turn.bonus = false;
        p.superiorityLeft -= 1;
        p.nextAttackBonus = { dice: `${p.mods.superiorityDie || 8}d${p.mods.superiorityDie ? '' : '8'}`.replace('d', 'd8') === '' ? '1d8' : `1d${p.mods.superiorityDie || 10}`, type: '钝击' };
        Combat.line(c, K.sys, `▶ 卓越骰：下一次命中将附加 1d${p.mods.superiorityDie || 10} 伤害。`);
      } else if (id === 'smite1' || id === 'smite2') {
        const lv = id === 'smite1' ? 1 : 2;
        p.smiteQueued = lv;
        c.turn.bonus = false;
        Combat.line(c, K.sys, `▶ 你引导圣力，准备在命中时释放至圣斩（${lv} 环）。`);
      } else if (id === 'rage') {
        if (!p.flags.rage || p.raging || (p.rageLeft || 0) <= 0) return;
        c.turn.bonus = false; p.raging = true; p.rageLeft -= 1;
        Combat.line(c, K.sys, `▶ 狂暴：你的双眼燃起血色，受到伤害 -${p.rageDr || 0}、伤害 +${p.rageDmg || 0}（剩余 ${p.rageLeft} 次）。`);
      } else if (id === 'flurry') {
        if ((p.kiLeft || 0) < 1) { Combat.line(c, K.warn, '气不够了。'); return; }
        const t = Combat.pickTarget(c, action.target); if (!t) return;
        c.turn.bonus = false; p.kiLeft -= 1;
        Combat.line(c, K.sys, '▶ 疾风连击');
        Combat.attack(c, p, t, {
          bonus: R.attackBonus(p), dice: '1d6', dmgMod: R.damageBonus(p) + (p.mods.monkDmg || 0),
          type: '钝击', verb: '徒手连击', weapon: null,
        });
      } else if (id === 'stun') {
        if ((p.kiLeft || 0) < 1) { Combat.line(c, K.warn, '气不够了。'); return; }
        const t = Combat.pickTarget(c, action.target); if (!t || !Combat.canReach(p, t)) { Combat.line(c, K.warn, Combat.reachHint(p, t)); return; }
        c.turn.bonus = false; p.kiLeft -= 1;
        Combat.line(c, K.sys, '▶ 震慑拳');
        Combat.attack(c, p, t, {
          bonus: R.attackBonus(p), dice: '1d6', dmgMod: R.damageBonus(p) + (p.mods.monkDmg || 0),
          type: '钝击', verb: '震碎心神的一拳', weapon: { onHitCond: { id: 'stunned', name: '震慑', turns: 1 } },
        });
      }
    },

    useItem(c, action) {
      const p = c.player;
      const it = p.inventory[action.index];
      if (!it) return;
      if (!Combat.castCost(c, 'action')) return;
      c.turn.action = false;
      p.inventory.splice(action.index, 1);
      Combat.line(c, K.sys, `▶ 你使用了「${it.name}」`);
      const eff = it.effect || {};
      if (eff.heal) { const r = D.roll(eff.heal, c.rng); Combat.heal(c, p, r.total, it.name); }
      if (eff.cleanse) { const n = Combat.clearConds(c, p); Combat.line(c, K.sys, `负面状态被清除了（${n} 个）。`); }
      if (eff.buff) {
        const b = Object.assign({}, eff.buff);
        p.buffs.push({ name: b.name || it.name, turns: b.turns || 99, mods: b.mods || {} });
        R.recalc(p);
        Combat.line(c, K.sys, `你获得了「${b.name || it.name}」。`);
      }
      if (eff.tempHp) { p.tempHp += eff.tempHp; Combat.line(c, K.sys, `获得 ${eff.tempHp} 点临时生命。`); }
      if (eff.cast) {
        const sp = R.spellDef(eff.cast);
        if (sp) Combat.castSpell(c, { spellId: sp.id, slot: 0, target: action.target, free: true });
      }
      if (eff.dice) {
        const t = Combat.pickTarget(c, action.target);
        if (t) {
          if (eff.save) Combat.saveDamage(c, t, { dice: eff.dice, type: eff.type, dc: eff.save.dc, attr: eff.save.attr, half: eff.save.half, source: p });
          else Combat.damage(c, t, D.rollDice(eff.dice, c.rng), eff.type, p);
        }
      }
    },

    /* ================= 敌人回合 ================= */
    enemyTurn(c, e) {
      const p = c.player;
      const it = e.intent || Combat.planIntent(c, e);
      e.intent = null;
      if (condOf(e, 'stunned') || condOf(e, 'restrained')) {
        Combat.line(c, K.sys, `${e.name}被定住了，无法行动。`);
        return;
      }
      const usable = it && it.kind === 'ability' ? e.abilities.find((a) => a.id === it.id) : null;
      // 有技能先用技能（怪物的技能不受距离限制），否则近战怪才需要先贴上来
      if (!usable && e.range !== 'ranged' && (e.band || 0) > 0) {
        const from = e.band;
        const charge = from >= 2;   // 冲锋：一轮扑到你面前，但这一轮打不到你
        e.band = Math.max(0, from - (charge ? 2 : 1));
        Combat.line(c, K.sys, `▶ ${e.name}向你${charge ? '冲过来' : '逼近'}（距离 ${BAND_NAMES[from]} → ${BAND_NAMES[e.band]}）${charge ? '——冲锋的势头还没收住，这一轮打不到你。' : '。'}`);
        if (charge || e.band > 0) return;
      }
      if (usable) {
        e.cd[usable.id] = usable.cooldown || 3;
        if (usable.flavor) Combat.line(c, K.flavor, usable.flavor);
        Combat.line(c, K.sys, `▶ ${e.name}使用了「${usable.name}」`);
        const dc = (usable.dc || 13) + (c.tier.hitAdd || 0);
        if (usable.kind === 'save') {
          Combat.saveDamage(c, p, { dice: usable.dice, type: usable.type, dc, attr: usable.save, half: usable.half, cond: usable.cond, source: e, dmgMul: e.dmgMul });
        } else if (usable.kind === 'buff_self') {
          const b = usable.buff || {};
          for (const k of Object.keys(b.mods || {})) e.mods[k] = (e.mods[k] || 0) + b.mods[k];
          if (b.mods && b.mods.ac) e.ac += b.mods.ac;
          e.buffs.push(b);
          Combat.line(c, K.sys, `${e.name}获得了「${b.name}」。`);
        } else if (usable.kind === 'debuff') {
          if (usable.save && usable.dc) {
            const bonus = R.saveBonus(p, usable.save);
            const res = D.check(c.rng, bonus, null);
            const ok = res.total >= usable.dc;
            Combat.line(c, K.save, `你进行${NK.Data.get('rules').attrLabels[usable.save]}豁免：d20(${res.nat})${bonus >= 0 ? '+' + bonus : bonus} = ${res.total} VS DC ${usable.dc} —— ${ok ? '成功' : '失败'}`);
            if (ok) return;
            Combat.addCond(c, p, usable.cond, { attr: usable.save, dc: usable.dc });
          } else {
            Combat.addCond(c, p, usable.cond);
          }
          Combat.line(c, K.warn, `你陷入了「${usable.cond.name}」。`);
        } else if (usable.kind === 'heal_self') {
          const r = D.roll(usable.dice, c.rng);
          Combat.heal(c, e, Math.max(1, Math.round(r.total * e.dmgMul)), usable.name);
        } else if (usable.kind === 'drain') {
          const res = Combat.attack(c, e, p, { bonus: usable.hit || e.atk.bonus, dice: usable.dice, dmgMod: 0, type: usable.type || e.atk.type, verb: usable.name });
          if (res.hit) Combat.heal(c, e, Math.ceil(res.damage / 2), '汲取');
        }
        return;
      }
      const times = 1 + (e.multiattack || 0);
      for (let i = 0; i < times; i++) {
        if (c.over || (p.dying && c.enemies.every((x) => x.hp <= 0))) break;
        if (p.dying) {
          // 攻击濒死的玩家：自动 1 次死亡豁免失败
          Combat.line(c, K.death, `${e.name}朝着倒下的你补了一刀。`);
          p.deathSaves.fail += 1;
          Combat.line(c, K.save, `死亡豁免失败（${p.deathSaves.fail}/3）`);
          if (p.deathSaves.fail >= 3) { c.over = true; c.result = 'defeat'; Combat.line(c, K.death, '你的手从地面上滑了下去。'); }
          break;
        }
        Combat.attack(c, e, p, {
          bonus: e.atk.bonus, dice: e.atk.dice, dmgMod: 0, type: e.atk.type,
          verb: c.rng.pick(e.atk.verbs), critRange: 20,
        });
        if (c.over) break;
      }
      Combat.tickRepeatSaves(c, e);
    },

    /* ================= 敌人意图预告 ================= */

    /** 规划敌人下一步的行动。冷却在回合结束时结算，所以这里算出来的就是它真正会做的。
     *  三级精度由战斗开始时的「意图判定」决定（c.intentTier）：
     *  0 = 只知行为类别（攻击 / 施法或状态 / 状态加强）；1 = 知道具体动作名；2 = 带数据的细致行为。 */
    planIntent(c, e) {
      if (!e || e.hp <= 0) return null;
      if (condOf(e, 'stunned') || condOf(e, 'restrained')) {
        return { kind: 'disabled', name: '无法行动', detail: '被定住了，这一轮它动不了。', tone: 'good' };
      }
      const tier = (c && c.intentTier != null) ? c.intentTier : 2;
      const catOf = (kind) => ({ save: '施法或状态', debuff: '施法或状态', buff_self: '状态加强', heal_self: '状态加强', drain: '攻击', approach: '攻击', attack: '攻击' }[kind] || '攻击');
      const usable = e.abilities.find((a) => (e.cd[a.id] || 0) <= 0);
      let plan;
      if (usable) {
        const dc0 = (usable.dc || 13) + ((c.tier && c.tier.hitAdd) || 0);
        const kind = usable.kind;
        let detail = '';
        let tone = 'bad';
        if (kind === 'save' && usable.dice) {
          const avg = Math.round(D.avg(usable.dice) * e.dmgMul);
          detail = `需过${NK.Data.get('rules').attrLabels[usable.save] || usable.save}豁免 DC ${dc0}，约 ${avg} 点${usable.type ? ' ' + usable.type : ''}${usable.half ? '（成功减半）' : ''}`;
        } else if (kind === 'debuff') {
          detail = usable.save ? `需过豁免 DC ${dc0}，否则「${usable.cond.name}」` : `会让你「${usable.cond.name}」`;
          tone = 'warn';
        } else if (kind === 'heal_self') {
          detail = `回复约 ${Math.round(D.avg(usable.dice) * e.dmgMul)} 点生命`;
          tone = 'warn';
        } else if (kind === 'buff_self') {
          detail = `获得「${(usable.buff || {}).name || '增益'}」`;
          tone = 'warn';
        }         else if (kind === 'drain') {
          detail = `约 ${Math.round(D.avg(usable.dice) * e.dmgMul)} 点${usable.type || ''}伤害，并回复等量一半的生命`;
        }
        // 兜底：任何未覆盖的能力种类都给一句可阅读的意图描述，避免 detail 为空
        if (!detail) detail = usable ? `准备使用「${usable.name}」` : '准备行动';
        plan = { kind: 'ability', id: usable.id, name: usable.name, detail, tone, category: catOf(kind) };
      } else if (e.range !== 'ranged' && (e.band || 0) > 0) {
        const charge = (e.band || 0) >= 2;
        const per = Math.max(1, Math.round(D.avg(e.atk.dice) * e.dmgMul));
        plan = {
          kind: 'approach', name: charge ? '冲锋' : '逼近', tone: charge ? 'warn' : 'bad',
          detail: charge ? `一轮扑到面前，但这一轮打不到你` : `贴上来并攻击（约 ${per} 点）`,
          category: '攻击',
        };
      } else {
        const times = 1 + (e.multiattack || 0);
        const per = Math.max(1, Math.round(D.avg(e.atk.dice) * e.dmgMul));
        plan = {
          kind: 'attack', name: e.atk.name || '攻击', tone: 'bad',
          detail: times > 1 ? `${times} 次攻击，每次约 ${per} 点 ${e.atk.type || ''}` : `约 ${per} 点 ${e.atk.type || ''}伤害`,
          category: '攻击',
        };
      }
      // 三级精度：行为类别 / 具体动作 / 带数据的细节
      if (tier <= 0) {
        const catLabel = { '攻击': '准备发起攻击', '施法或状态': '准备施法或施加状态', '状态加强': '正在强化自身' }[plan.category] || '准备行动';
        return { kind: plan.kind, id: plan.id, category: plan.category, name: catLabel, detail: '', tone: 'warn', vague: true };
      }
      if (tier === 1) {
        // 具体动作名 + 一句描述（不带数值）。detail 仍要非空，保证 UI/测试能读到
        let d = plan.detail || '';
        if (!d) d = plan.kind === 'attack' ? '准备发动攻击' : (plan.name ? `准备使用「${plan.name}」` : (plan.category || '准备行动'));
        return { kind: plan.kind, id: plan.id, category: plan.category, name: plan.name, detail: d, tone: plan.tone, vague: false };
      }
      return plan;
    },

    refreshIntents(c) {
      for (const e of c.enemies) e.intent = Combat.planIntent(c, e);
    },

    /** 期望伤害估算（自动策略用，会考虑目标抗性与免疫） */
    expectedDamage(c, p, entry, targetCount, target) {
      const sp = entry.spell;
      if (!sp.dice) return 0;
      const d = D.parse(sp.dice);
      let avg = d.count * (d.sides + 1) / 2 + d.mod;
      if (sp.level === 0) avg *= R.cantripMul(p);
      if (sp.addMain) avg += R.spellMod(p);
      if (target && sp.dmgType) {
        if ((target.immune || []).includes(sp.dmgType)) return 0;
        if ((target.resist || []).includes(sp.dmgType)) avg = Math.floor(avg / 2);
        if ((target.vuln || []).includes(sp.dmgType)) avg *= 2;
      }
      const n = sp.targets === 'all' ? Math.max(1, targetCount) : 1;
      if (sp.kind === 'save') return avg * n * 0.5;
      if (sp.kind === 'spell_attack') return avg * 0.6;
      if (sp.kind === 'auto') return avg * (sp.darts || 1);
      return 0;
    },

    /* ================= 自动策略（模拟器） ================= */
    autoAction(c) {
      const p = c.player;
      if (p.dying) return { type: 'endTurn' };
      const alive = c.enemies.filter((e) => e.hp > 0);
      // 优先打「够得到 + 血最少」的：近战够不到时先移动，避免瞄准了打不到的目标
      const attackable = alive.filter((e) => Combat.canReach(p, e));
      const pickFrom = attackable.length ? attackable : alive;
      const target = pickFrom.reduce((a, b) => (a && a.hp <= b.hp ? a : b), pickFrom[0]);
      const acts = Combat.availableActions(c);
      const hpPct = p.hp / p.maxHp;
      // 先处理距离：够不到就贴近；靠远程输出被贴身就拉开
      const w = p.items.mainHand;
      if (acts.move) {
        const hasAttackSpell = acts.spells.some((s) => s.ok && s.spell.kind === 'spell_attack');
        const rangedSelf = (w && w.kind === 'ranged') || hasAttackSpell;
        const meleeSelf = !!(w && w.kind !== 'ranged') && !hasAttackSpell;
        if (rangedSelf && !meleeSelf && acts.move.canOut && acts.move.text === '近身') return { type: 'move', dir: 'out' };
        if (!acts.canReachFront && acts.move.canIn) return { type: 'move', dir: 'in' };
      }
      // 开场先上自己的增益（法师护甲 / 镜像 / 无踪步这类，真人玩家都会这么做）
      if (c.turn.action && !p.openedWith) {
        const buff = acts.spells.find((s) => s.ok && s.spell.kind === 'buff' && (s.spell.targets === 'self' || ['mage_armor', 'mirror_image', 'blur'].includes(s.spell.id)));
        p.openedWith = true;
        if (buff) return { type: 'cast', spellId: buff.spell.id, slot: buff.slot };
      }
      // 濒死救援
      if (hpPct < 0.35) {
        const heal = acts.spells.find((s) => s.ok && s.spell.kind === 'heal');
        if (heal && c.turn.action) return { type: 'cast', spellId: heal.spell.id, slot: heal.slot, target: target && target.uid };
        const potion = acts.items.find((x) => x.item.effect && x.item.effect.heal);
        if (potion && c.turn.action) return { type: 'item', index: potion.index };
        const sw = acts.bonus.find((b) => b.id === 'secondWind');
        if (sw && c.turn.bonus) return { type: 'bonus', id: 'secondWind' };
        const loh = acts.bonus.find((b) => b.id === 'layOnHands');
        if (loh && c.turn.bonus) return { type: 'bonus', id: 'layOnHands' };
        const ch = acts.bonus.find((b) => b.id === 'channel');
        if (ch && c.turn.bonus && p.flags.channelHeal) return { type: 'bonus', id: 'channel' };
      }
      if (c.turn.bonus) {
        const b = acts.bonus.find((x) => ['vow', 'sacredWeapon', 'superiority', 'smite1'].includes(x.id));
        if (b && c.round <= 2) return { type: 'bonus', id: b.id, target: target && target.uid };
        const channel = acts.bonus.find((x) => x.id === 'channel');
        if (channel && p.flags.channelBurst && alive.length >= 2) return { type: 'bonus', id: 'channel' };
        // 游荡者：没有优势就想办法拿到（能藏就藏，不能藏就稳定瞄准）
        const hide = acts.bonus.find((x) => x.id === 'hide');
        if (hide && p.mods.sneakAttack && !p.turnFlags.hidden) return { type: 'bonus', id: 'hide' };
        const aim = acts.bonus.find((x) => x.id === 'steadyAim');
        if (aim && p.mods.sneakAttack && !p.turnFlags.hidden) return { type: 'bonus', id: 'steadyAim' };
      }
      if (c.turn.action) {
        // 比较「武器攻击」与「法术」的期望伤害，取更高者
        const w = p.items.mainHand;
        const hitChance = Math.min(0.95, Math.max(0.05, (21 + R.attackBonus(p, w) - (target ? Combat.acOf(c, target) : 12)) / 20));
        const wd = w ? D.parse(R.weaponDice(p, w)) : { count: 1, sides: 2, mod: 0 };
        let weaponEV = (wd.count * (wd.sides + 1) / 2 + wd.mod + R.damageBonus(p, w)) * hitChance;
        if (p.mods.sneakAttack && (p.turnFlags.hidden || c.round === 1)) weaponEV += p.mods.sneakAttack * 3.5 * hitChance;
        const spells = acts.spells.filter((s) => s.ok).map((s) => ({ s, ev: Combat.expectedDamage(c, p, s, alive.length, target) }))
          .sort((a, b) => b.ev - a.ev);
        const best = spells[0];
        if (best && best.ev > weaponEV && best.ev > 0) return { type: 'cast', spellId: best.s.spell.id, slot: best.s.slot, target: target && target.uid };
        // 够不到任何敌人、又已经移动过了：这一回合做不了事，直接结束
        if (!Combat.canReach(p, target)) return { type: 'endTurn' };
        return { type: 'attack', target: target && target.uid };
      }
      return { type: 'endTurn' };
    },

    /** 推进玩家回合直到用尽动作（模拟器用） */
    autoPlayerTurn(c) {
      let guard = 0;
      let stuck = 0;
      while (!c.over && guard++ < 300) {
        const p = c.player;
        if (p.dying) { Combat.autoDeathSaves(c); if (c.over) break; Combat.endPlayerTurn(c); continue; }
        if (!c.turn.action && !c.turn.bonus) { Combat.endPlayerTurn(c); continue; }
        const a = Combat.autoAction(c);
        if (!a || a.type === 'endTurn') { Combat.endPlayerTurn(c); continue; }
        const sig = `${c.turn.action}|${c.turn.bonus}|${c.turn.moved}|${c.log.length}`;
        Combat.playerAction(c, a);
        // 防死循环：动作没被执行（例如目标够不到）时，连续两次就强制结束回合
        if (sig === `${c.turn.action}|${c.turn.bonus}|${c.turn.moved}|${c.log.length}`) {
          stuck += 1;
          if (stuck >= 2) { Combat.endPlayerTurn(c); continue; }
        } else stuck = 0;
      }
      return c;
    },
  };

  function hostileAdvantage(attacker, target) {
    // 隐形 / 玩家闪避
    if ((attacker.conditions || []).some((x) => x.id === 'invisible')) return 'adv';
    if (isPlayer(target) && target.dodging) return 'dis';
    if ((target.conditions || []).some((x) => x.id === 'invisible')) return 'dis';
    return null;
  }

  NK.Combat = Combat;
})(typeof window !== 'undefined' ? window : globalThis);
