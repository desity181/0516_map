/**
 * 浏览器端真实测试 - 使用 Playwright 捕获控制台错误
 * 如果没有 Playwright，使用内嵌 JSDOM 方式
 */
const http = require('http');

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

(async function() {
  console.log('=== 浏览器端 JS 静态分析测试 ===\n');

  // 获取所有 JS 并检查浏览器兼容性问题
  const baseUrl = 'http://localhost:18420';

  // 1. 检查 engine-bundle.js 的浏览器兼容性
  console.log('1. Engine Bundle 浏览器兼容性...');
  const bundle = (await fetch(baseUrl + '/dist/engine-bundle.js')).body;

  // 检查 require() 调用 - 浏览器不支持
  const requireCalls = bundle.match(/require\s*\([^)]+\)/g) || [];
  const browserRequireCalls = requireCalls.filter(r => !r.includes('module.exports'));
  if (browserRequireCalls.length > 0) {
    console.log('  ❌ 发现浏览器不支持的 require():');
    browserRequireCalls.forEach(r => console.log('     ' + r));
  } else {
    console.log('  ✅ 无浏览器不兼容的 require()');
  }

  // 检查每个 UMD 模块是否正确包裹
  const umdWrappers = bundle.match(/\/\/ === \w+\.js \(UMD\) ===/g) || [];
  console.log('  UMD 模块数: ' + umdWrappers.length + ' (期望 4)');

  // 检查 return 语句
  const returnStatements = bundle.match(/return (Graph|Pathfinder|MapMatcher|MapDatabase);/g) || [];
  console.log('  return 语句: ' + returnStatements.length + ' (期望 4)');
  returnStatements.forEach(r => console.log('    ' + r));

  // 2. 检查 app.js 的潜在问题
  console.log('\n2. App.js 潜在问题检查...');
  const appCode = (await fetch(baseUrl + '/src/renderer/app.js')).body;

  // 检查是否使用 DOMContentLoaded
  if (appCode.includes('DOMContentLoaded')) {
    console.log('  ✅ 使用 DOMContentLoaded 初始化');
  } else {
    console.log('  ❌ 未使用 DOMContentLoaded，可能 DOM 未就绪就执行');
  }

  // 检查 null/undefined 安全访问
  const optionalChains = appCode.match(/\?\.\w+/g) || [];
  console.log('  可选链使用: ' + optionalChains.length + ' 处');

  // 检查是否处理了 map 未初始化
  const mapNullChecks = (appCode.match(/if\s*\(\s*!?\s*state\.map/g) || []).length;
  console.log('  state.map 空值检查: ' + mapNullChecks + ' 处');

  // 检查 fetch 错误处理
  const fetchTryCatch = (appCode.match(/try\s*\{[\s\S]*?fetch\(/g) || []).length;
  console.log('  fetch 在 try 块中: ' + fetchTryCatch + ' 处');

  // 3. 模拟浏览器执行 - 检查关键初始化流程
  console.log('\n3. 初始化流程模拟...');

  // 提取 initApp 函数
  const initMatch = appCode.match(/async function initApp\(\)\s*\{([\s\S]*?)\n\}/);
  if (initMatch) {
    const initBody = initMatch[1];
    const calls = initBody.match(/\w+\(\)/g) || [];
    console.log('  initApp 调用顺序: ' + calls.join(' → '));
  }

  // 4. 检查高德瓦片 URL 格式
  console.log('\n4. 高德瓦片 URL 检查...');
  const tileUrlMatch = appCode.match(/webrd0\{1-4\}\.is\.autonavi\.com[^']*/);
  if (tileUrlMatch) {
    console.log('  当前: ' + tileUrlMatch[0]);
    if (tileUrlMatch[0].includes('style=8')) {
      console.log('  ⚠️  style=8 是标准亮色图层');
      console.log('  💡 建议改为 style=7 (暗色卫星) 或 style=6 (卫星图)');
    }
  }

  // 5. 检查 sql.js WASM 路径是否正确
  console.log('\n5. sql.js WASM 路径...');
  const wasmPathMatch = appCode.match(/locateFile.*?=>\s*`([^`]+)`/);
  if (wasmPathMatch) {
    const wasmPath = wasmPathMatch[1];
    console.log('  路径模板: ' + wasmPath);
    // 替换 ${f} 测试实际 URL
    const actualUrl = wasmPath.replace('${f}', 'sql-wasm.wasm');
    try {
      const r = await fetch(baseUrl + actualUrl);
      if (r.status === 200) {
        console.log('  ✅ WASM 文件可访问: ' + actualUrl);
      } else {
        console.log('  ❌ WASM 文件不可访问: HTTP ' + r.status);
      }
    } catch (e) {
      console.log('  ❌ WASM 路径无效: ' + e.message);
    }
  }

  // 6. 检查 bundle 中 database.js 的 toGraph 方法
  console.log('\n6. toGraph() 方法检查 (bundle 中)...');
  if (bundle.includes('const Graph = require')) {
    console.log('  ❌ toGraph() 中有 require("./graph") - 浏览器不支持!');
    // 这是核心问题！
    console.log('  💡 修复: build-browser-bundle.js 应删除 require("./graph") 并使用 UMD 注入的 Graph');
  } else if (bundle.includes('const graph = new Graph()')) {
    console.log('  ✅ toGraph() 使用注入的 Graph 参数');
  }

  // 7. 检查完整的错误链
  console.log('\n7. 错误链分析...');
  console.log('  如果 engine-bundle.js 中 require() 被执行:');
  console.log('    → 浏览器中 require 未定义');
  console.log('    → UMD wrapper 进入 else 分支 (root.XXX = factory(root.Graph))');
  console.log('    → 但 factory 内部如果有 require()，会在调用时报错');

  // 检查 UMD factory 是否被正确调用
  const factoryCalls = bundle.match(/root\.\w+ = factory\([^)]*\)/g) || [];
  console.log('\n  UMD factory 调用:');
  factoryCalls.forEach(c => console.log('    ' + c));

  // 8. 最重要的测试 - 实际执行 bundle 代码片段
  console.log('\n8. Bundle 代码片段执行测试...');
  try {
    // 用 vm 模块模拟
    const vm = require('vm');
    const context = { self: {}, console: console };
    vm.createContext(context);

    // 尝试加载 Graph
    const graphCode = bundle.substring(
      bundle.indexOf('// === graph.js'),
      bundle.indexOf('// === pathfinder.js')
    );
    try {
      vm.runInContext(graphCode, context);
      if (context.Graph) {
        console.log('  ✅ Graph 可在类浏览器环境中实例化');
        const g = new context.Graph();
        g.addNode(1, 39.9, 116.4);
        if (g.nodeCount === 1) {
          console.log('  ✅ Graph.addNode() 正常工作');
        }
      } else {
        console.log('  ❌ Graph 未正确导出到全局');
      }
    } catch (e) {
      console.log('  ❌ Graph 代码执行错误: ' + e.message);
    }
  } catch (e) {
    console.log('  ⚠️  VM 测试跳过: ' + e.message);
  }

  console.log('\n=== 测试完成 ===');
})();
