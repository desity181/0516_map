/**
 * 构建浏览器端引擎 bundle
 * 将 Node.js 模块转换为 UMD 格式并合并为一个文件
 */
const fs = require('fs');
const path = require('path');

const ENGINE_DIR = path.join(__dirname, '..', 'src', 'engine');
const DIST_DIR = path.join(__dirname, '..', 'dist');
const OUTPUT_FILE = path.join(DIST_DIR, 'engine-bundle.js');

// 确保输出目录存在
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

/**
 * 将 Node.js 模块转换为 UMD 格式
 */
function toUMD(filePath, className, dependencies = {}) {
  let code = fs.readFileSync(filePath, 'utf-8');

  // 移除 require 语句
  for (const [dep, globalVar] of Object.entries(dependencies)) {
    code = code.replace(new RegExp(`const\\s+\\w+\\s*=\\s*require\\('${dep}'\\)`, 'g'), '');
  }

  // 移除 module.exports
  code = code.replace(/module\.exports\s*=\s*\w+;?\s*$/m, '');

  // 包装在 UMD 中
  const depArgs = Object.values(dependencies).join(', ');
  const depNames = Object.keys(dependencies).map(d => JSON.stringify(d)).join(', ');

  return `
// === ${path.basename(filePath)} (UMD) ===
(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(${Object.values(dependencies).map(v => `require(${Object.keys(dependencies)[Object.values(dependencies).indexOf(v)]})`).join(', ')});
  } else {
    root.${className} = factory(${Object.values(dependencies).map(v => `root.${v}`).join(', ')});
  }
})(typeof self !== 'undefined' ? self : this, function(${depArgs}) {
  'use strict';
${code}
  return ${className};
});
`;
}

// 构建各模块
const graphUMD = toUMD(
  path.join(ENGINE_DIR, 'graph.js'),
  'Graph'
);

const pathfinderUMD = toUMD(
  path.join(ENGINE_DIR, 'pathfinder.js'),
  'Pathfinder',
  { './graph': 'Graph' }
);

const mapMatcherUMD = toUMD(
  path.join(ENGINE_DIR, 'map-matcher.js'),
  'MapMatcher',
  { './graph': 'Graph' }
);

const databaseUMD = toUMD(
  path.join(ENGINE_DIR, 'database.js'),
  'MapDatabase',
  { './graph': 'Graph' }
);

// 合并输出
const bundle = `/* engine-bundle.js - 自动生成，请勿手动编辑 */
/* 生成时间: ${new Date().toISOString()} */
${graphUMD}
${pathfinderUMD}
${mapMatcherUMD}
${databaseUMD}
`;

fs.writeFileSync(OUTPUT_FILE, bundle, 'utf-8');
console.log(`✅ 引擎 bundle 已生成: ${OUTPUT_FILE}`);
console.log(`   大小: ${(Buffer.byteLength(bundle) / 1024).toFixed(1)} KB`);
