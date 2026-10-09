/* 《渊下》内核 —— 随机数、骰子、通用工具 */
(function (global) {
  const NK = (global.NK = global.NK || {});

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    const s = (seed === undefined || seed === null) ? (Date.now() ^ (Math.random() * 0xffffffff)) : seed;
    const fn = mulberry32(s >>> 0);
    const rng = {
      seed: s,
      next() { return fn(); },
      int(min, max) { return min + Math.floor(fn() * (max - min + 1)); },
      float(min, max) { return min + fn() * (max - min); },
      chance(p) { return fn() < p; },
      pick(arr) { return arr[Math.floor(fn() * arr.length)]; },
      weighted(entries) {
        let total = 0;
        for (const e of entries) total += e[1];
        let r = fn() * total;
        for (const e of entries) { r -= e[1]; if (r <= 0) return e[0]; }
        return entries[entries.length - 1][0];
      },
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(fn() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      },
      sample(arr, n) { return rng.shuffle(arr).slice(0, n); },
    };
    return rng;
  }

  const DICE_RE = /^\s*(\d*)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i;

  function parse(spec) {
    const m = DICE_RE.exec(String(spec));
    if (!m) throw new Error('无法解析骰子表达式: ' + spec);
    return {
      count: m[1] ? parseInt(m[1], 10) : 1,
      sides: parseInt(m[2], 10),
      mod: m[4] ? (m[3] === '-' ? -parseInt(m[4], 10) : parseInt(m[4], 10)) : 0,
    };
  }

  /** 期望值（用于意图预告与 AI 估算） */
  function avg(spec, diceMul) {
    const p = typeof spec === 'string' ? parse(spec) : { count: spec.count || 1, sides: spec.sides, mod: spec.mod || 0 };
    return p.count * (diceMul || 1) * (p.sides + 1) / 2 + p.mod;
  }

  /** 投骰。diceMul 会乘骰子数量；flatMul 会乘调整值 */
  function roll(spec, rng, diceMul) {
    const p = typeof spec === 'string' ? parse(spec) : { count: spec.count || 1, sides: spec.sides, mod: spec.mod || 0 };
    const count = Math.max(1, Math.round(p.count * (diceMul || 1)));
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push(rng.int(1, p.sides));
    const sum = rolls.reduce((a, b) => a + b, 0);
    return { spec: String(spec), rolls, mod: p.mod, count, sides: p.sides, total: sum + p.mod, sum };
  }

  function rollDice(spec, rng, diceMul) {
    const r = roll(spec, rng, diceMul);
    return r.total - r.mod;
  }

  /** d20 检定。mode = 'adv' | 'dis' | null */
  function check(rng, bonus, mode) {
    const a = rng.int(1, 20);
    const b = rng.int(1, 20);
    let kept = a, rolls = [a];
    if (mode === 'adv') { kept = Math.max(a, b); rolls = [a, b]; }
    else if (mode === 'dis') { kept = Math.min(a, b); rolls = [a, b]; }
    return { nat: kept, rolls, bonus, total: kept + bonus, mode: mode || null };
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let _uid = 0;
  const uid = (p) => `${p || 'u'}${++_uid}`;

  function diceText(r) {
    const parts = r.rolls.join('+');
    let t = `${r.count}d${r.sides}(${parts})`;
    if (r.mod) t += (r.mod > 0 ? `+${r.mod}` : `${r.mod}`);
    return t;
  }

  NK.RNG = { make: makeRng, global: makeRng(null) };
  NK.Dice = { parse, avg, roll, rollDice, check, diceText };
  NK.Util = { clamp, clone, uid };
})(typeof window !== 'undefined' ? window : globalThis);
