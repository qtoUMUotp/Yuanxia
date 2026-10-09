/* 渊下 · 记录与图鉴
 *
 * 这里只做「记录」，不做任何数值成长——死了照样从零开始。
 * 通关记录：每一局的结果快照。
 * 图鉴：见过的东西（怪物 / 法术 / 物品 / 事件），纯查阅。
 */
(function (global) {
  'use strict';
  const NK = (global.NK = global.NK || {});

  const REC_KEY = 'yuanxia_records_v1';
  const CODEX_KEY = 'yuanxia_codex_v1';
  const MAX_RECORDS = 60;
  const KINDS = ['monsters', 'spells', 'items', 'events'];

  function read(key, fallback) {
    try {
      const raw = global.localStorage && global.localStorage.getItem(key);
      const v = raw ? JSON.parse(raw) : null;
      return v || fallback;
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { global.localStorage && global.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn(e); }
  }

  const Codex = {
    /* ---------------- 通关记录 ---------------- */
    records() { return read(REC_KEY, []); },
    addRecord(rec) {
      const list = Codex.records();
      list.unshift(rec);
      write(REC_KEY, list.slice(0, MAX_RECORDS));
      return list;
    },
    clearRecords() { write(REC_KEY, []); },
    /** 总体战绩：用于标题界面一行摘要 */
    recordStats() {
      const list = Codex.records();
      const wins = list.filter((r) => r.result === 'victory');
      const levels = list.map((r) => r.level || 0);
      const turns = wins.map((r) => r.rounds || 0).filter((x) => x > 0);
      return {
        total: list.length,
        wins: wins.length,
        rate: list.length ? Math.round((wins.length / list.length) * 100) : 0,
        bestLevel: levels.length ? Math.max.apply(null, levels) : 0,
        bestKills: list.length ? Math.max.apply(null, list.map((r) => r.kills || 0)) : 0,
        fastest: turns.length ? Math.min.apply(null, turns) : 0,
        byClass: (() => {
          const m = {};
          for (const r of list) {
            const k = r.className || '?';
            m[k] = m[k] || { runs: 0, wins: 0 };
            m[k].runs += 1;
            if (r.result === 'victory') m[k].wins += 1;
          }
          return m;
        })(),
      };
    },

    /* ---------------- 图鉴 ---------------- */
    all() { const c = read(CODEX_KEY, {}); for (const k of KINDS) if (!c[k]) c[k] = []; return c; },
    seen(kind) { return Codex.all()[kind] || []; },
    has(kind, id) { return Codex.seen(kind).includes(id); },
    discover(kind, id) {
      if (!id) return false;
      const c = Codex.all();
      if (!c[kind]) c[kind] = [];
      if (c[kind].includes(id)) return false;
      c[kind].push(id);
      write(CODEX_KEY, c);
      return true;
    },
    discoverMany(kind, ids) { let n = 0; for (const id of ids || []) if (Codex.discover(kind, id)) n += 1; return n; },
    clear() { write(CODEX_KEY, { monsters: [], spells: [], items: [], events: [] }); },

    /** 图鉴进度：已见 / 总数 */
    progress() {
      const c = Codex.all();
      const D = NK.Data;
      const total = {
        monsters: (D.get('monsters').monsters || []).length,
        spells: (D.get('spells').spells || []).length,
        items: (D.get('items').magicItems || []).length + (D.get('items').consumables || []).length,
        events: (D.get('events').events || []).length,
      };
      const out = {};
      for (const k of KINDS) out[k] = { seen: (c[k] || []).length, total: total[k] || 0 };
      return out;
    },

    /* ---------------- 详情（给图鉴界面用） ---------------- */
    entry(kind, id) {
      const D = NK.Data;
      if (kind === 'monsters') {
        const m = (D.get('monsters').monsters || []).find((x) => x.id === id);
        if (!m) return null;
        const traits = (m.traits || []).map((t) => { const d = D.get('monsters').traits[t.effect]; return d ? d.name : t.name; });
        return {
          id, name: m.name, tag: `第 ${m.act} 幕 · ${{ normal: '普通', elite: '精英', boss: '关底' }[m.rank] || m.rank}`,
          lines: [
            `HP ${m.hp}　AC ${m.ac}　攻击 +${m.attack.bonus} ${m.attack.dice} ${m.attack.type}${m.multiattack ? `　连击 ${m.multiattack + 1} 次` : ''}`,
            `属性 力${m.attrs.str} 敏${m.attrs.dex} 体${m.attrs.con} 智${m.attrs.int} 感${m.attrs.wis} 魅${m.attrs.cha}`,
            m.resist.length ? `抗性 ${m.resist.join('、')}` : '', m.immune.length ? `免疫 ${m.immune.join('、')}` : '', m.vuln.length ? `易伤 ${m.vuln.join('、')}` : '',
            traits.length ? `特性 ${traits.join('、')}` : '',
            (m.abilities || []).length ? `技能 ${m.abilities.map((a) => a.name).join('、')}` : '',
          ].filter(Boolean),
          flavor: m.flavor,
        };
      }
      if (kind === 'spells') {
        const s = (D.get('spells').spells || []).find((x) => x.id === id);
        if (!s) return null;
        return {
          id, name: s.name, tag: `${s.level === 0 ? '戏法' : s.level + ' 环'} · ${(s.classes || []).map((c) => ({ wizard: '法师', cleric: '牧师', paladin: '圣武士', ranger: '游侠', rogue: '游荡者', warrior: '战士' })[c] || c).join('/')}`,
          lines: [s.dice ? `伤害/效果 ${s.dice}${s.dmgType ? ' ' + s.dmgType : ''}` : '', s.save ? `豁免 ${s.save}` : '', s.targets === 'all' ? '范围：全体' : '', s.action === '附赠动作' ? '附赠动作' : ''].filter(Boolean),
          flavor: s.desc,
        };
      }
      if (kind === 'items') {
        const it = (D.get('items').magicItems || []).find((x) => x.id === id) || (D.get('items').consumables || []).find((x) => x.id === id);
        if (!it) return null;
        const slot = it.slot ? { weapon: '武器', armor: '护甲', shield: '盾牌', trinket: '饰品' }[it.slot] || it.slot : '消耗品';
        return { id, name: it.name, tag: `${NK.Items.RARITY_NAME[it.rarity] || '消耗品'} · ${slot}`, lines: [it.desc].filter(Boolean), flavor: it.flavor };
      }
      if (kind === 'events') {
        const e = (D.get('events').events || []).find((x) => x.id === id);
        if (!e) return null;
        return { id, name: e.title, tag: `第 ${(e.act || []).join('/')} 幕 · ${(e.options || []).length} 个选项`, lines: [], flavor: e.text };
      }
      return null;
    },

    /** 当前玩家该记录哪些已见内容 */
    syncFromRun(run) {
      if (!run) return;
      const p = run.player;
      Codex.discoverMany('spells', (p.knownSpells || []).concat(p.prepared || [], p.cantrips || []));
      Codex.discoverMany('items', (p.bag || []).concat(p.inventory || []).map((x) => x.magicId || x.baseId).filter(Boolean));
      for (const it of NK.Rules.equippedList(p)) if (it.magicId) Codex.discover('items', it.magicId);
    },
  };

  NK.Codex = Codex;
})(typeof window !== 'undefined' ? window : globalThis);
