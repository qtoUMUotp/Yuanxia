// 把 /data/*.json 内联成 js/data.embedded.js（供 file:// 打开时使用）
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data');
const files = readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort();
const bundle = {};
for (const f of files) bundle[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dataDir, f), 'utf8'));
const out = `// 由 tools/build-data.mjs 自动生成，请勿手改。源文件在 /data/*.json
// 生成时间: ${new Date().toISOString()}
(function (global) {
  global.NK_EMBEDDED = ${JSON.stringify(bundle)};
})(typeof window !== 'undefined' ? window : globalThis);
`;
writeFileSync(join(root, 'js', 'data.embedded.js'), out, 'utf8');
console.log(`[build-data] 已内联 ${files.length} 个数据表: ${files.join(', ')}`);
