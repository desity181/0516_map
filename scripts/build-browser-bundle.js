/**
 * 构建浏览器端引擎 bundle
 * 将 Node.js 模块转换为浏览器兼容的 UMD 格式并合并
 * v2: 彻底清除所有 require/module.exports，确保浏览器端零报错
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
 * 将 Node.js 模块转换为浏览器端 UMD 格式
 * - 彻底移除所有 require() 调用
 * - 彻底移除所有 module.exports
 * - 使用全局变量注入依赖
 */
function toBrowserModule(filePath, className, deps = {}) {
  let code = fs.readFileSync(filePath, 'utf-8');

  // 1. 移除所有 require() 调用（各种格式）
  //    const Graph = require('./graph')
  //    const Graph = require("./graph")
  //    var X = require('...')
  //    let X = require('...')
  code = code.replace(/(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*['"][^'"]+['"]\s*\)\s*;?/g, '');

  // 2. 移除所有 module.exports
  code = code.replace(/module\.exports\s*=\s*\w+\s*;?/g, '');

  // 3. 清理多余空行
  code = code.replace(/\n{3,}/g, '\n\n');

  // 4. 构建 UMD wrapper — 只保留浏览器端代码路径
  const depArgs = Object.values(deps).join(', ');

  return `
// === ${path.basename(filePath)} (Browser UMD) ===
(function(root, factory) {
  // 浏览器端：直接挂载到全局
  root.${className} = factory(${Object.values(deps).map(v => `root.${v}`).join(', ')});
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this, function(${depArgs}) {
  'use strict';
${code}

  return ${className};
});

`;
}

// 构建各模块（按依赖顺序）
const modules = [
  { file: 'graph.js', className: 'Graph', deps: {} },
  { file: 'pathfinder.js', className: 'Pathfinder', deps: { Graph: 'Graph' } },
  { file: 'map-matcher.js', className: 'MapMatcher', deps: { Graph: 'Graph' } },
  { file: 'database.js', className: 'MapDatabase', deps: { Graph: 'Graph' } },
];

let bundleContent = `/* engine-bundle.js - 自动生成，请勿手动编辑 */
/* 生成时间: ${new Date().toISOString()} */
/* 浏览器端专用 - 已移除所有 require/module.exports */
`;

for (const mod of modules) {
  const filePath = path.join(ENGINE_DIR, mod.file);
  bundleContent += toBrowserModule(filePath, mod.className, mod.deps);
}

fs.writeFileSync(OUTPUT_FILE, bundleContent, 'utf-8');

// 验证 bundle
const issues = [];
if (bundleContent.includes('require(')) issues.push('包含 require()');
if (bundleContent.includes('module.exports')) issues.push('包含 module.exports');

if (issues.length > 0) {
  console.log('⚠️  警告: ' + issues.join(', '));
} else {
  console.log('✅ Bundle 验证通过: 无 require/module.exports 残留');
}

console.log('✅ 引擎 bundle 已生成: ' + OUTPUT_FILE);
console.log('   大小: ' + (Buffer.byteLength(bundleContent) / 1024).toFixed(1) + ' KB');
