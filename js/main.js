/* 启动 */
(function (global) {
  const NK = global.NK;
  async function boot() {
    const root = document.getElementById('app');
    try {
      await NK.Data.load();
    } catch (e) {
      root.innerHTML = `<div class="panel"><h2>数据加载失败</h2><p>${e.message}</p>
        <p class="small dim">如果直接用 file:// 打开，请先在项目目录执行 <span class="mono">node tools/build-data.mjs</span> 生成内嵌数据。</p></div>`;
      return;
    }
    NK.UI.init();
    console.log(`[渊下] 数据源=${NK.Data.source}　法术 ${NK.Data.get('spells').spells.length}　怪物 ${NK.Data.get('monsters').monsters.length}　事件 ${NK.Data.get('events').events.length}`);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
