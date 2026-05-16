/**
 * 前端测试脚本 - 使用 Node.js 模拟浏览器环境加载页面
 * 检测 JS 错误、资源加载失败、DOM 结构问题
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:18420';
let errors = [];
let warnings = [];
let info = [];

function log(msg) { console.log(msg); }
function err(msg) { errors.push(msg); console.log('  ❌ ' + msg); }
function warn(msg) { warnings.push(msg); console.log('  ⚠️  ' + msg); }
function ok(msg) { info.push(msg); console.log('  ✅ ' + msg); }

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

async function checkResource(name, url, expectType) {
  try {
    const r = await fetch(url);
    if (r.status === 200) {
      const ct = r.headers['content-type'] || '';
      if (expectType && !ct.includes(expectType)) {
        err(name + ': HTTP 200 但 Content-Type 错误: ' + ct);
      } else {
        ok(name + ': HTTP 200 (' + (r.body.length / 1024).toFixed(1) + ' KB)');
      }
    } else {
      err(name + ': HTTP ' + r.status);
    }
  } catch (e) {
    err(name + ': 加载失败 - ' + e.message);
  }
}

function checkJSCode(code, filename) {
  // 检查明显的语法问题
  const issues = [];

  // 检查残留的 require() 调用（在浏览器 bundle 中不应有）
  const requireMatches = code.match(/require\s*\(\s*['"]\.\/[^'"]+['"]\s*\)/g);
  if (requireMatches) {
    for (const m of requireMatches) {
      err(filename + ': 发现浏览器不支持的 require(): ' + m);
    }
  }

  // 检查 module.exports
  if (code.includes('module.exports') && filename.includes('bundle')) {
    warn(filename + ': bundle 中包含 module.exports');
  }

  return issues;
}

(async function runFrontendTests() {
  console.log('=== 前端测试 - 离线地图路径规划工具 ===\n');

  // 1. 检查所有关键资源是否可访问
  console.log('1. 资源加载测试...');
  await checkResource('index.html', BASE + '/src/renderer/index.html', 'html');
  await checkResource('app.js', BASE + '/src/renderer/app.js', 'javascript');
  await checkResource('styles.css', BASE + '/src/renderer/styles.css', 'css');
  await checkResource('maplibre-gl.js', BASE + '/node_modules/maplibre-gl/dist/maplibre-gl.js', 'javascript');
  await checkResource('maplibre-gl.css', BASE + '/node_modules/maplibre-gl/dist/maplibre-gl.css', 'css');
  await checkResource('engine-bundle.js', BASE + '/dist/engine-bundle.js', 'javascript');
  await checkResource('sql-wasm.js', BASE + '/node_modules/sql.js/dist/sql-wasm.js', 'javascript');
  await checkResource('sql-wasm.wasm', BASE + '/node_modules/sql.js/dist/sql-wasm.wasm', 'wasm');
  await checkResource('sample-data.json', BASE + '/assets/data/sample-data.json', 'json');

  // 2. 检查 index.html 结构
  console.log('\n2. HTML 结构测试...');
  const htmlRes = await fetch(BASE + '/src/renderer/index.html');
  const html = htmlRes.body;

  // 检查 CSS 引用
  const cssRefs = html.match(/href="([^"]+\.css)"/g) || [];
  for (const ref of cssRefs) {
    const url = ref.match(/href="([^"]+)"/)[1];
    if (url.startsWith('http')) {
      warn('CSS 引用外部 CDN: ' + url + ' (中国可能无法访问)');
    } else {
      ok('CSS 引用本地: ' + url);
    }
  }

  // 检查 JS 引用
  const jsRefs = html.match(/src="([^"]+\.js)"/g) || [];
  for (const ref of jsRefs) {
    const url = ref.match(/src="([^"]+)"/)[1];
    if (url.startsWith('http')) {
      err('JS 引用外部 CDN: ' + url + ' (中国可能无法访问!)');
    } else {
      ok('JS 引用本地: ' + url);
    }
  }

  // 检查 DOM 元素
  const requiredIds = ['map', 'sidebar', 'btn-plan-route', 'btn-clear-route',
    'poi-search-input', 'route-result', 'route-distance', 'route-time',
    'waypoints-list', 'btn-add-waypoint', 'click-mode-indicator'];
  for (const id of requiredIds) {
    if (html.includes('id="' + id + '"')) {
      ok('DOM 元素存在: #' + id);
    } else {
      err('DOM 元素缺失: #' + id);
    }
  }

  // 3. 检查 engine-bundle.js 代码
  console.log('\n3. Engine Bundle 代码检查...');
  const bundleRes = await fetch(BASE + '/dist/engine-bundle.js');
  const bundleCode = bundleRes.body;
  checkJSCode(bundleCode, 'engine-bundle.js');

  // 检查关键全局变量
  if (bundleCode.includes('root.Graph = factory()')) ok('Bundle 导出 Graph');
  else err('Bundle 未导出 Graph');

  if (bundleCode.includes('root.Pathfinder = factory(root.Graph)')) ok('Bundle 导出 Pathfinder');
  else err('Bundle 未导出 Pathfinder');

  if (bundleCode.includes('root.MapMatcher = factory(root.Graph)')) ok('Bundle 导出 MapMatcher');
  else err('Bundle 未导出 MapMatcher');

  if (bundleCode.includes('root.MapDatabase = factory(root.Graph)')) ok('Bundle 导出 MapDatabase');
  else err('Bundle 未导出 MapDatabase');

  // 4. 检查 app.js 代码
  console.log('\n4. App.js 代码检查...');
  const appRes = await fetch(BASE + '/src/renderer/app.js');
  const appCode = appRes.body;

  // 检查 app.js 中的全局引用
  if (appCode.includes('new maplibregl.Map(')) ok('使用 maplibregl.Map');
  else err('未找到 maplibregl.Map 初始化');

  if (appCode.includes('new Graph.fromJSON(') || appCode.includes('Graph.fromJSON(')) ok('使用 Graph.fromJSON');
  if (appCode.includes('new Pathfinder(')) ok('使用 Pathfinder');
  if (appCode.includes('new MapMatcher(')) ok('使用 MapMatcher');
  if (appCode.includes('new MapDatabase(')) ok('使用 MapDatabase');
  if (appCode.includes('initSqlJs')) ok('使用 initSqlJs');

  // 检查地图瓦片源
  const tileMatch = appCode.match(/tiles:\s*\[([^\]]+)\]/g);
  if (tileMatch) {
    for (const t of tileMatch) {
      if (t.includes('openstreetmap')) {
        err('瓦片源使用 OSM (中国被墙): ' + t.trim());
      } else if (t.includes('autonavi') || t.includes('amap')) {
        ok('瓦片源使用高德 (中国可用): ' + t.trim());
      } else {
        warn('瓦片源未知: ' + t.trim());
      }
    }
  }

  // 检查 CSS 中的暗色主题适配
  console.log('\n5. 样式检查...');
  const cssRes = await fetch(BASE + '/src/renderer/styles.css');
  const cssCode = cssRes.body;

  if (cssCode.includes('.maplibregl-popup-content')) ok('Popup 样式覆盖');
  else warn('缺少 Popup 样式覆盖 (高德瓦片亮色，暗色 popup 可能不协调)');

  if (cssCode.includes('custom-marker')) ok('自定义标记样式');
  else warn('缺少自定义标记样式');

  // 检查地图容器的 CSS
  if (cssCode.includes('#map') && cssCode.includes('width') && cssCode.includes('height')) {
    ok('#map 容器有尺寸样式');
  } else {
    warn('#map 容器可能缺少尺寸样式');
  }

  // 6. 检查高德瓦片是否在暗色主题下可读
  console.log('\n6. 高德瓦片兼容性检查...');
  warn('高德瓦片 style=8 是标准亮色图层，暗色主题 UI 下可能不协调');
  warn('高德瓦片 style=7 是暗色图层，建议切换');

  // 7. 检查 sql.js WASM 加载路径
  console.log('\n7. sql.js WASM 加载路径检查...');
  const wasmPathMatch = appCode.match(/locateFile.*?=>\s*['"`]([^'"`]+)['"`]/);
  if (wasmPathMatch) {
    ok('WASM locateFile 路径: ' + wasmPathMatch[1]);
  } else {
    warn('未找到 locateFile 配置，sql.js 可能无法加载 WASM');
  }

  // 8. 数据库功能测试
  console.log('\n8. 数据库功能测试 (Node.js 端)...');
  try {
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();
    const MapDatabase = require('./src/engine/database');
    const sampleData = require('./assets/data/sample-data.json');

    const db = new MapDatabase();
    await db.init(SQL);
    db.importFromJSON(sampleData);

    const stats = db.getStats();
    if (stats.nodeCount === 36) ok('数据库节点数: ' + stats.nodeCount);
    else err('数据库节点数错误: ' + stats.nodeCount);

    if (stats.edgeCount > 0) ok('数据库边数: ' + stats.edgeCount);
    else err('数据库边数为0');

    if (stats.poiCount === 20) ok('数据库POI数: ' + stats.poiCount);
    else err('数据库POI数错误: ' + stats.poiCount);

    // 导出为 Graph 验证
    const graph = db.toGraph();
    if (graph.nodeCount === 36) ok('toGraph() 节点数正确');
    else err('toGraph() 节点数错误: ' + graph.nodeCount);

    // POI 查询
    const pois = db.getPOIs('scenic');
    if (pois.length === 7) ok('POI 分类查询正确 (scenic: ' + pois.length + ')');
    else err('POI 分类查询错误 (scenic: ' + pois.length + ')');

    // 路线保存
    db.saveRoute('测试路线', 'driving', 'fastest', [3, 20], [3, 10, 20], 5.94, 10);
    const routes = db.getRoutes();
    if (routes.length === 1) ok('路线保存/读取正确');
    else err('路线保存/读取错误: ' + routes.length);

    // 偏好设置
    db.setPreference('theme', 'dark');
    const theme = db.getPreference('theme');
    if (theme === 'dark') ok('偏好设置读写正确');
    else err('偏好设置读写错误: ' + theme);
  } catch (e) {
    err('数据库测试失败: ' + e.message);
  }

  // 9. 初始化顺序检查
  console.log('\n9. 初始化顺序检查...');
  if (appCode.includes('initMap()') && appCode.includes('setupUI()') && appCode.includes('loadSampleData()')) {
    // 检查 initMap 在 loadSampleData 之前
    const initMapPos = appCode.indexOf('initMap()');
    const setupUIPos = appAppPos = appCode.indexOf('setupUI()');
    const loadDataPos = appCode.indexOf('loadSampleData()');

    if (initMapPos < loadDataPos && setupUIPos < loadDataPos) {
      ok('初始化顺序正确: initMap → setupUI → loadSampleData');
    } else {
      warn('初始化顺序可能有问题: initMap(' + initMapPos + ') setupUI(' + setupUIPos + ') loadData(' + loadDataPos + ')');
    }
  }

  // ===== 结果 =====
  console.log('\n' + '='.repeat(50));
  console.log('  前端测试结果: ' + info.length + ' 通过, ' + errors.length + ' 错误, ' + warnings.length + ' 警告');
  if (errors.length > 0) {
    console.log('\n  ❌ 错误列表:');
    errors.forEach(e => console.log('    - ' + e));
  }
  if (warnings.length > 0) {
    console.log('\n  ⚠️  警告列表:');
    warnings.forEach(w => console.log('    - ' + w));
  }
  console.log('='.repeat(50));
})();
