/* 事件：技能检定、条件判定、效果结算 */
(function (global) {
  const NK = (global.NK = global.NK || {});
  const R = NK.Rules;
  const U = NK.Util;

  const Events = {
    all() { return NK.Data.get('events').events; },

    pick(run, rng) {
      const actId = run.actIndex + 1;
      const seen = run.seenEvents || {};
      let pool = Events.all().filter((e) => (!e.acts || e.acts.includes(actId)) && !seen[e.id]);
      if (!pool.length) pool = Events.all().filter((e) => !e.acts || e.acts.includes(actId));
      if (!pool.length) pool = Events.all();
      const ev = rng.pick(pool);
      run.seenEvents = run.seenEvents || {};
      run.seenEvents[ev.id] = true;
      if (NK.Codex) NK.Codex.discover('events', ev.id);
      return ev;
    },

    checkRequire(run, opt) {
      const p = run.player;
      const r = opt.require;
      if (!r) return { ok: true };
      if (r.gold && run.gold < r.gold) return { ok: false, msg: `需要 ${r.gold} 金币` };
      if (r.hpPct && p.hp / p.maxHp < r.hpPct) return { ok: false, msg: `需要 ${Math.round(r.hpPct * 100)}% 以上生命` };
      if (r.potion && (p.inventory || []).filter((i) => i.kind === 'potion').length < r.potion) return { ok: false, msg: '没有可用的药剂' };
      if (r.level && p.level < r.level) return { ok: false, msg: `需要等级 ${r.level}` };
      if (r.weapon && !p.items.mainHand) return { ok: false, msg: '需要一件武器' };
      if (r.spellSlots && !p.slots.some((n) => n > 0)) return { ok: false, msg: '需要剩余法术位' };
      return { ok: true };
    },

    /** 掷出这次选项的结果 */
    resolve(run, opt, rng) {
      if (opt.check) {
        const p = run.player;
        let bonus, label;
        if (opt.check.skill) {
          bonus = R.skillBonus(p, opt.check.skill);
          label = R.skillDef(opt.check.skill).name;
        } else {
          bonus = R.mod(p.attrs[opt.check.attr]);
          if ((p.proficiencies.saves || []).includes(opt.check.attr)) bonus += p.prof;
          label = NK.Data.get('rules').attrLabels[opt.check.attr];
        }
        // 未熟练护甲会让力量/敏捷检定劣势，隐匿劣势的护甲会让隐匿检定劣势
        const mode = R.checkMode(p, opt.check.skill, opt.check.attr);
        const res = NK.Dice.check(rng, bonus, mode);
        const ok = res.nat !== 1 && res.total >= opt.check.dc;
        const branch = ok ? opt.success : opt.failure;
        return {
          effect: (branch && branch.effect) || {}, text: (branch && branch.text) || '',
          roll: { label, bonus, total: res.total, dc: opt.check.dc, ok, nat: res.nat, mode },
        };
      }
      if (opt.outcomes) {
        let r = rng.next();
        for (const o of opt.outcomes) { r -= o.p; if (r <= 0) return { effect: o.effect || {}, text: o.text || '' }; }
        const last = opt.outcomes[opt.outcomes.length - 1];
        return { effect: last.effect || {}, text: last.text || '' };
      }
      return { effect: opt.effect || {}, text: opt.text || '' };
    },

    applyEffect(run, effect, rng) {
      const lines = [];
      const p = run.player;
      if (!effect) return lines;

      if (effect.hp) {
        if (effect.hp > 0) { p.hp = Math.min(p.maxHp, p.hp + effect.hp); lines.push(`生命 +${effect.hp}（${p.hp}/${p.maxHp}）`); }
        else { p.hp = Math.max(0, p.hp + effect.hp); lines.push(`生命 ${effect.hp}（${p.hp}/${p.maxHp}）`); if (p.hp <= 0) run.forceDown = true; }
      }
      if (effect.hpPct) {
        const d = Math.round(p.maxHp * effect.hpPct);
        p.hp = Math.max(0, Math.min(p.maxHp, p.hp + d));
        lines.push(`生命 ${d > 0 ? '+' : ''}${d}（${p.hp}/${p.maxHp}）`);
        if (p.hp <= 0) run.forceDown = true;
      }
      if (effect.heal) {
        const amt = typeof effect.heal === 'string' ? NK.Dice.rollDice(effect.heal, rng) : effect.heal;
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + amt);
        lines.push(`回复 ${p.hp - before} 点生命（${p.hp}/${p.maxHp}）`);
      }
      if (effect.healPct) {
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * effect.healPct));
        lines.push(`回复 ${p.hp - before} 点生命（${p.hp}/${p.maxHp}）`);
      }
      if (effect.tempHp) { p.tempHp += effect.tempHp; lines.push(`获得 ${effect.tempHp} 点临时生命`); }
      if (effect.gold) { run.gold = Math.max(0, run.gold + effect.gold); lines.push(`金币 ${effect.gold > 0 ? '+' : ''}${effect.gold}（${run.gold}）`); }
      if (effect.food) { run.food += effect.food; lines.push(`食物 ${effect.food > 0 ? '+' : ''}${effect.food}（共 ${run.food} 份）`); }
      if (effect.ringSlot) {
        p.buffs.push({ kind: 'buff', turns: null, name: '戒指容量', desc: `戒指上限 +${effect.ringSlot}`, mods: { ringSlots: effect.ringSlot } });
        R.recalc(p);
        lines.push(`你的手指适应了更多戒指的共振——戒指上限提升到 ${R.ringCap(p)} 枚（能量干涉也更容易累积）。`);
      }
      if (effect.xp) {
        const ups = R.gainXp(p, effect.xp);
        lines.push(`经验 +${effect.xp}`);
        for (const u of ups) lines.push(`⬆ 升级！Lv.${u.level}${u.feature ? `　新特性「${u.feature}」：${u.featureDesc || ''}` : ''}`);
      }
      if (effect.item) {
        const it = NK.Items.loot(rng, effect.item === 'boss' ? 'boss' : effect.item === 'elite' ? 'elite' : 'normal');
        NK.Run.grantItem(run, it);
        lines.push(`获得：${it.name}${it.magic ? '（魔法物品）' : ''}`);
      }
      if (effect.potion) for (let i = 0; i < effect.potion; i++) { const c = NK.Items.randomConsumable(rng); NK.Run.grantConsumable(run, c); lines.push(`获得药剂/卷轴：${c.name}`); };
      if (effect.scroll) for (let i = 0; i < effect.scroll; i++) { const c = NK.Items.randomConsumable(rng); NK.Run.grantConsumable(run, c); lines.push(`获得：${c.name}`); }
      if (effect.buff) { Events.pushBuff(run, effect.buff, 'buff'); lines.push(`获得「${effect.buff.name}」：${effect.buff.desc || ''}`); }
      if (effect.curse) { Events.pushBuff(run, effect.curse, 'curse'); lines.push(`受到诅咒「${effect.curse.name}」：${effect.curse.desc || ''}`); }
      if (effect.reveal) { run.revealAll = true; lines.push('整幕地图在你脑中展开了。'); }
      if (effect.rest_free) {
        const die = p.hitDice.die;
        const heal = Math.max(1, Math.floor(die / 2) + 1 + R.mod(p.attrs.con));
        p.hp = Math.min(p.maxHp, p.hp + heal);
        p.slots = p.slotsMax.slice();
        lines.push(`你喘息了一会儿：回复 ${heal} 点生命，法术位全部恢复。`);
      }
      if (effect.slot_restore) {
        let left = effect.slot_restore;
        for (let i = 0; i < 5 && left > 0; i++) {
          if (p.slots[i] < p.slotsMax[i]) { p.slots[i] += 1; left -= 1; }
        }
        lines.push('法术位得到了恢复。');
      }
      R.recalc(p);
      return lines;
    },

    pushBuff(run, buff, kind) {
      const b = U.clone(buff);
      b.kind = kind;
      b.turns = b.turns === undefined ? null : b.turns;
      run.player.buffs.push(b);
      R.recalc(run.player);
    },
  };

  NK.Events = Events;
})(typeof window !== 'undefined' ? window : globalThis);
