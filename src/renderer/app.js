/**
 * 离线地图路径规划工具 v2.0 - 前端主逻辑
 * 重构版：使用引擎 bundle（Graph/Pathfinder/MapMatcher/MapDatabase）
 * 支持模式差异化地图匹配 + sql.js 本地数据库持久化
 */

// ===== WGS-84 to GCJ-02 (火星坐标系) 坐标转换 =====
// 高德地图瓦片使用GCJ-02，数据使用WGS-84，必须转换才能对齐
const COORD_PI = 3.14159265358979324;
const COORD_A = 6378245.0;
const COORD_EE = 0.00669342162296594323;

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(lng, lat) {
  let ret = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
  ret += (20.0 * Math.sin(6.0 * lng * COORD_PI) + 20.0 * Math.sin(2.0 * lng * COORD_PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(lat * COORD_PI) + 40.0 * Math.sin(lat / 3.0 * COORD_PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(lat / 12.0 * COORD_PI) + 320 * Math.sin(lat * COORD_PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(lng, lat) {
  let ret = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
  ret += (20.0 * Math.sin(6.0 * lng * COORD_PI) + 20.0 * Math.sin(2.0 * lng * COORD_PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(lng * COORD_PI) + 40.0 * Math.sin(lng / 3.0 * COORD_PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(lng / 12.0 * COORD_PI) + 300.0 * Math.sin(lng / 30.0 * COORD_PI)) * 2.0 / 3.0;
  return ret;
}

function wgs84ToGcj02(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * COORD_PI;
  let magic = Math.sin(radLat);
  magic = 1 - COORD_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((COORD_A * (1 - COORD_EE)) / (magic * sqrtMagic) * COORD_PI);
  dLng = (dLng * 180.0) / (COORD_A / sqrtMagic * Math.cos(radLat) * COORD_PI);
  return [lng + dLng, lat + dLat];
}

// 转换节点坐标（创建新的节点对象，不修改原始数据）
function convertNodeToGcj02(node) {
  if (!node) return null;
  const [gcjLng, gcjLat] = wgs84ToGcj02(node.lng, node.lat);
  return { ...node, lat: gcjLat, lng: gcjLng };
}

// ===== State =====
const state = {
  map: null,
  graph: null,
  pathfinder: null,
  mapMatcher: null,
  db: null,
  poiData: [],
  waypoints: [
    { id: 0, lat: null, lng: null, name: '' },
    { id: 1, lat: null, lng: null, name: '' }
  ],
  currentMode: 'driving',
  optimize: 'fastest',
  clickMode: null,
  routeResult: null,
  markers: [],
  networkLayerAdded: false,
  matchResults: [] // 地图匹配结果，用于虚拟节点清理
};

// ===== Init =====
async function initApp() {
  // Init map first (so UI is interactive even if data loading fails)
  initMap();

  // Setup UI
  setupUI();

  // Load sample data (with database persistence) - non-blocking
  try {
    await loadSampleData();
  } catch (err) {
    console.error('Failed to load sample data:', err);
    loadEmbeddedData();
  }
}

// ===== Map =====
function initMap() {
  state.map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      name: 'Offline Map',
      sources: {
        'gaode-tiles': {
          type: 'raster',
          tiles: [
            'https://wprd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}',
            'https://wprd02.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}',
            'https://wprd03.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}',
            'https://wprd04.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}'
          ],
          tileSize: 256,
          attribution: '&copy; AutoNavi'
        }
      },
      layers: [{
        id: 'gaode-layer',
        type: 'raster',
        source: 'gaode-tiles',
        minzoom: 0,
        maxzoom: 18
      }],
      // glyphs 不设置，使用 localIdeographFontFamily 渲染中文
    },
    center: [116.403, 39.909], // GCJ-02 坐标（高德底图对齐）
    zoom: 13.5,
    minZoom: 10,
    maxZoom: 18,
    attributionControl: false,
    localIdeographFontFamily: 'Microsoft YaHei, PingFang SC, sans-serif'
  });

  state.map.addControl(new maplibregl.NavigationControl(), 'top-right');
  state.map.addControl(new maplibregl.ScaleControl({ maxWidth: 150, unit: 'metric' }), 'bottom-right');

  state.map.on('load', onMapLoaded);
  state.map.on('click', onMapClick);
  state.map.on('contextmenu', onMapRightClick);
  state.map.on('mousemove', onMapMouseMove);

  // 确保 canvas 尺寸与容器同步（flex 布局可能延迟计算）
  requestAnimationFrame(() => {
    if (state.map) state.map.resize();
  });
}

function onMapLoaded() {
  console.log('Map loaded');
  // 再次 resize 确保瓦片正确加载
  state.map.resize();

  // Route source
  state.map.addSource('route', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  // Route outline glow
  state.map.addLayer({
    id: 'route-glow',
    type: 'line',
    source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#1d4ed8',
      'line-width': 14,
      'line-opacity': 0.25,
      'line-blur': 8
    }
  });

  // Route line
  state.map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#3b82f6',
      'line-width': 5,
      'line-opacity': 0.95
    }
  });

  // Route dashes (direction indicators)
  state.map.addLayer({
    id: 'route-casing',
    type: 'line',
    source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#93c5fd',
      'line-width': 2,
      'line-opacity': 0.7
    }
  });

  // Match snap indicator source
  state.map.addSource('snap-indicator', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });
  state.map.addLayer({
    id: 'snap-indicator-layer',
    type: 'circle',
    source: 'snap-indicator',
    paint: {
      'circle-radius': 6,
      'circle-color': '#22c55e',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#0f172a',
      'circle-opacity': 0.8
    }
  });

  // Road network source
  state.map.addSource('road-network', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] }
  });

  state.map.addLayer({
    id: 'road-network-lines',
    type: 'line',
    source: 'road-network',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': 'rgba(100, 116, 139, 0.3)',
      'line-width': 2
    }
  });

  // POI source
  state.map.addSource('pois', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 40
  });

  // Clustered POI circles
  state.map.addLayer({
    id: 'poi-clusters',
    type: 'circle',
    source: 'pois',
    filter: ['has', 'point_count'],
    paint: {
      'circle-radius': ['step', ['get', 'point_count'], 15, 5, 20, 10, 25],
      'circle-color': 'rgba(245, 158, 11, 0.7)',
      'circle-stroke-width': 2,
      'circle-stroke-color': 'rgba(245, 158, 11, 0.3)'
    }
  });

  state.map.addLayer({
    id: 'poi-cluster-count',
    type: 'symbol',
    source: 'pois',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': '{point_count_abbreviated}',
      'text-size': 12
    },
    paint: { 'text-color': '#fff' }
  });

  // Individual POI markers
  state.map.addLayer({
    id: 'poi-markers',
    type: 'circle',
    source: 'pois',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': 7,
      'circle-color': [
        'match', ['get', 'category'],
        'scenic', '#f59e0b',
        'food', '#ef4444',
        'shop', '#8b5cf6',
        'hotel', '#06b6d4',
        'transport', '#22c55e',
        'medical', '#ec4899',
        '#64748b'
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#0f172a'
    }
  });

  state.map.addLayer({
    id: 'poi-labels',
    type: 'symbol',
    source: 'pois',
    filter: ['!', ['has', 'point_count']],
    layout: {
      'text-field': ['get', 'name'],
      'text-offset': [0, 1.6],
      'text-size': 11,
      'text-anchor': 'top',
      'text-max-width': 8
    },
    paint: {
      'text-color': '#f1f5f9',
      'text-halo-color': '#0f172a',
      'text-halo-width': 1.5
    }
  });

  // POI click popup
  state.map.on('click', 'poi-markers', (e) => {
    const props = e.features[0].properties;
    new maplibregl.Popup({ offset: 10 })
      .setLngLat(e.lngLat)
      .setHTML(`<strong>${props.name}</strong><br><span style="color:#94a3b8">${props.address || ''}</span>`)
      .addTo(state.map);
  });

  // Render POIs and road network (only if data is already loaded)
  if (state.poiData.length > 0) {
    renderPOIs();
    renderRoadNetwork();
    updateDataInfo();
  }
}

// ===== Map Events =====
function onMapClick(e) {
  if (!e.lngLat) return;
  // MapLibre 返回 WGS-84，转换为 GCJ-02 与数据对齐
  const [gcjLng, gcjLat] = wgs84ToGcj02(e.lngLat.lng, e.lngLat.lat);

  if (state.clickMode) {
    setWaypointFromMap(gcjLat, gcjLng, state.clickMode);
    cancelClickMode();
    return;
  }
}

function onMapRightClick(e) {
  e.preventDefault();
  if (!e.lngLat) return;
  const [gcjLng, gcjLat] = wgs84ToGcj02(e.lngLat.lng, e.lngLat.lat);
  reverseGeocode(gcjLat, gcjLng);
}

function onMapMouseMove(e) {
  if (!e.lngLat) return;
  const lat = e.lngLat.lat;
  const lng = e.lngLat.lng;
  const overlay = document.getElementById('overlay-coords');
  if (overlay) {
    overlay.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
  const info = document.getElementById('map-overlay-info');
  if (info) info.classList.remove('hidden');
}

// ===== Data Loading (with Database) =====
async function loadSampleData() {
  try {
    // 尝试使用 sql.js 数据库
    if (typeof initSqlJs === 'function') {
      let SQL;
      try {
        SQL = await initSqlJs({
          locateFile: f => `/node_modules/sql.js/dist/${f}`
        });
      } catch (sqlErr) {
        console.warn('sql.js WASM load failed, skipping database:', sqlErr.message);
        throw new Error('sql.js WASM unavailable');
      }

      state.db = new MapDatabase();

      // 始终从 JSON 重新加载（避免 GCJ-02 坐标重复偏移）
      try {
        const resp = await fetch('/assets/data/sample-data.json');
        const data = await resp.json();
        await state.db.init(SQL);
        state.db.importFromJSON(data);
        state.graph = state.db.toGraph();
        state.poiData = data.pois || [];
        console.log('Imported from JSON');
      } catch (dbErr) {
        console.warn('Database operation failed, falling back:', dbErr.message);
        throw dbErr;
      }
    } else {
      throw new Error('sql.js not available');
    }
  } catch (err) {
    // sql.js 不可用或数据库失败，直接用 JSON
    console.warn('Using JSON fallback:', err.message);
    try {
      const resp = await fetch('/assets/data/sample-data.json');
      const data = await resp.json();
      state.poiData = data.pois || [];
      state.graph = Graph.fromJSON(data.graph);
    } catch (e2) {
      console.error('Failed to load sample data:', e2);
      loadEmbeddedData();
      return;
    }
  }

  // ===== 坐标系转换：WGS-84 -> GCJ-02（与高德底图对齐）=====
  convertDataToGcj02();

  state.pathfinder = new Pathfinder(state.graph);
  state.mapMatcher = new MapMatcher(state.graph);
  console.log('Loaded: ' + state.graph.nodeCount + ' nodes, ' + state.graph.edgeCount + ' edges, ' + state.poiData.length + ' POIs');

  // 如果地图已加载，渲染数据
  if (state.map && state.map.getSource('pois')) {
    renderPOIs();
    renderRoadNetwork();
    updateDataInfo();
  }
}

let _dataConverted = false;

function convertDataToGcj02() {
  if (_dataConverted || !state.graph) return;
  _dataConverted = true;

  // 转换 graph 节点
  for (const [id, node] of state.graph.nodes) {
    const [gcjLng, gcjLat] = wgs84ToGcj02(node.lng, node.lat);
    node.lng = gcjLng;
    node.lat = gcjLat;
  }
  state.graph.buildSpatialIndex();

  // 转换 POI
  if (state.poiData) {
    state.poiData = state.poiData.map(poi => {
      const [gcjLng, gcjLat] = wgs84ToGcj02(poi.lng, poi.lat);
      return { ...poi, lat: gcjLat, lng: gcjLng };
    });
  }

  console.log('Coordinates converted to GCJ-02');
}

function loadEmbeddedData() {
  // Minimal fallback
  const data = {
    nodes: [
      [0, 39.9075, 116.385], [1, 39.9075, 116.400], [2, 39.9075, 116.415],
      [3, 39.9200, 116.385], [4, 39.9200, 116.400], [5, 39.9200, 116.415],
      [6, 39.9300, 116.385], [7, 39.9300, 116.400], [8, 39.9300, 116.415]
    ],
    edges: [
      [0,1,1.3,40,'primary','长安街'],[1,0,1.3,40,'primary','长安街'],
      [1,2,1.2,40,'primary','长安街'],[2,1,1.2,40,'primary','长安街'],
      [3,4,1.2,30,'secondary','景山前街'],[4,3,1.2,30,'secondary','景山前街'],
      [4,5,1.2,30,'secondary','景山前街'],[5,4,1.2,30,'secondary','景山前街'],
      [6,7,1.2,40,'primary','平安大街'],[7,6,1.2,40,'primary','平安大街'],
      [7,8,1.2,40,'primary','平安大街'],[8,7,1.2,40,'primary','平安大街'],
      [0,3,1.4,30,'secondary','南池子大街'],[3,0,1.4,30,'secondary','南池子大街'],
      [3,6,1.3,40,'primary','广场路'],[6,3,1.3,40,'primary','广场路'],
      [1,4,1.4,40,'primary','王府井大街'],[4,1,1.4,40,'primary','王府井大街'],
      [4,7,1.3,40,'primary','王府井大街'],[7,4,1.3,40,'primary','王府井大街'],
      [2,5,1.4,40,'primary','东单大街'],[5,2,1.4,40,'primary','东单大街'],
      [5,8,1.3,40,'primary','东单大街'],[8,5,1.3,40,'primary','东单大街'],
    ]
  };
  state.graph = Graph.fromJSON(data);
  state.poiData = [
    { name: '天安门', category: 'scenic', lat: 39.9087, lng: 116.3975, address: '东城区天安门' },
    { name: '故宫', category: 'scenic', lat: 39.9163, lng: 116.3972, address: '景山前街4号' },
  ];
  // 转换坐标
  convertDataToGcj02();
  state.pathfinder = new Pathfinder(state.graph);
  state.mapMatcher = new MapMatcher(state.graph);
}

// ===== Renderers =====
function renderPOIs() {
  if (!state.map || !state.map.getSource('pois')) return;

  const features = state.poiData.map(poi => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [poi.lng, poi.lat] },
    properties: { name: poi.name, category: poi.category, address: poi.address }
  }));

  state.map.getSource('pois').setData({ type: 'FeatureCollection', features });
}

function renderRoadNetwork() {
  if (!state.map || !state.map.getSource('road-network') || !state.graph) return;

  const features = [];
  const seenEdges = new Set();

  for (const [fromId, neighbors] of state.graph.edges) {
    for (const edge of neighbors) {
      const key = [Math.min(fromId, edge.to), Math.max(fromId, edge.to)].join('-');
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);

      const fromNode = state.graph.getNode(fromId);
      const toNode = state.graph.getNode(edge.to);
      if (!fromNode || !toNode) continue;

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[fromNode.lng, fromNode.lat], [toNode.lng, toNode.lat]]
        },
        properties: { name: edge.name, mode: edge.mode }
      });
    }
  }

  state.map.getSource('road-network').setData({ type: 'FeatureCollection', features });
}

function renderRoute(result) {
  const coordinates = result.path.map(id => {
    const node = state.graph.getNode(id);
    return node ? [node.lng, node.lat] : null;
  }).filter(Boolean);

  // Smooth the path with intermediate points for curves
  const smoothCoords = [];
  for (let i = 0; i < coordinates.length - 1; i++) {
    smoothCoords.push(coordinates[i]);
    // Add a slight midpoint for visual smoothing
    const mid = [
      (coordinates[i][0] + coordinates[i + 1][0]) / 2,
      (coordinates[i][1] + coordinates[i + 1][1]) / 2
    ];
    smoothCoords.push(mid);
  }
  smoothCoords.push(coordinates[coordinates.length - 1]);

  const geojson = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: smoothCoords },
      properties: {}
    }]
  };

  state.map.getSource('route').setData(geojson);

  // Clear and re-add markers
  clearMarkers();
  state.waypoints.forEach((w, i) => {
    if (w.lat && w.lng) {
      const type = i === 0 ? 'start' : i === state.waypoints.length - 1 ? 'end' : 'via';
      addMarker(w.lat, w.lng, type, i === 0 ? 'A' : i === state.waypoints.length - 1 ? 'B' : String(i + 1));
    }
  });

  // Fit bounds
  if (coordinates.length > 0) {
    const bounds = coordinates.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
    );
    state.map.fitBounds(bounds, { padding: 100, duration: 1000 });
  }
}

function showRouteResult(result) {
  const el = document.getElementById('route-result');
  el.classList.remove('hidden');

  const distStr = result.distance >= 1
    ? `${result.distance.toFixed(1)} km`
    : `${Math.round(result.distance * 1000)} m`;
  document.getElementById('route-distance').textContent = distStr;

  const timeStr = result.time >= 60
    ? `${(result.time / 60).toFixed(1)} 小时`
    : `${Math.round(result.time)} 分钟`;
  document.getElementById('route-time').textContent = timeStr;

  const stepsDiv = document.getElementById('route-steps');
  stepsDiv.innerHTML = '';
  const seenRoads = new Set();
  for (const step of result.steps) {
    if (seenRoads.has(step.name)) continue;
    seenRoads.add(step.name);

    const div = document.createElement('div');
    div.className = 'route-step';
    const stepDist = step.distance >= 1
      ? `${step.distance.toFixed(1)} km`
      : `${Math.round(step.distance * 1000)} m`;
    div.innerHTML = `
      <span class="route-step-icon">→</span>
      <span><strong>${step.name}</strong> — ${stepDist}</span>
    `;
    stepsDiv.appendChild(div);
  }
}

function updateDataInfo() {
  if (state.graph) {
    document.getElementById('info-nodes').textContent = state.graph.nodeCount;
    document.getElementById('info-edges').textContent = state.graph.edgeCount;
  }
  document.getElementById('info-pois').textContent = state.poiData.length;
}

// ===== Waypoints (with Map Matching) =====
function setWaypointFromMap(lat, lng, type) {
  let idx;
  if (type === 'start') idx = 0;
  else if (type === 'end') idx = state.waypoints.length - 1;
  else {
    idx = state.waypoints.findIndex(w => w.lat === null);
    if (idx === -1) idx = state.waypoints.length - 1;
  }

  // 使用模式差异化地图匹配
  let matchResult = null;
  if (state.mapMatcher) {
    matchResult = state.mapMatcher.matchPoint(lat, lng, state.currentMode);
  } else {
    // 回退到最近节点
    const nodeId = state.graph.findNearestNode(lat, lng);
    const node = state.graph.getNode(nodeId);
    matchResult = {
      nodeId,
      projection: { lat: node?.lat || lat, lng: node?.lng || lng },
      virtualNode: null
    };
  }

  // 使用匹配后的坐标（可能在边上投影点）
  const snapLat = matchResult.projection.lat;
  const snapLng = matchResult.projection.lng;

  state.waypoints[idx].lat = snapLat;
  state.waypoints[idx].lng = snapLng;
  state.waypoints[idx].matchNodeId = matchResult.nodeId;

  const nearestPOI = findNearestPOI(snapLat, snapLng);
  const name = nearestPOI
    ? `${nearestPOI.name}附近`
    : `${snapLat.toFixed(4)}, ${snapLng.toFixed(4)}`;
  state.waypoints[idx].name = name;

  const inputs = document.querySelectorAll('.waypoint-input');
  if (inputs[idx]) inputs[idx].value = name;

  // 显示匹配吸附指示器
  if (state.map?.getSource('snap-indicator')) {
    const src = state.map.getSource('snap-indicator');
    const currentData = src._data || { type: 'FeatureCollection', features: [] };
    currentData.features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [snapLng, snapLat] },
      properties: { original: false }
    });
    src.setData(currentData);
  }

  // Add marker immediately (at snap point, not raw click)
  const markerType = idx === 0 ? 'start' : idx === state.waypoints.length - 1 ? 'end' : 'via';
  const label = idx === 0 ? 'A' : idx === state.waypoints.length - 1 ? 'B' : String(idx + 1);
  addMarker(snapLat, snapLng, markerType, label);
}

function addWaypoint() {
  const idx = state.waypoints.length;
  state.waypoints.push({ id: idx, lat: null, lng: null, name: '' });

  const list = document.getElementById('waypoints-list');
  const div = document.createElement('div');
  div.className = 'waypoint-item';
  div.dataset.index = idx;
  div.innerHTML = `
    <span class="waypoint-marker via">${idx + 1}</span>
    <input type="text" class="waypoint-input" placeholder="途经点（点击地图设置）" data-index="${idx}" readonly>
    <button class="icon-btn btn-set-waypoint" title="在地图上选点" data-index="${idx}">📍</button>
    <button class="icon-btn btn-clear-waypoint" title="清除" data-index="${idx}">✕</button>
  `;
  list.appendChild(div);
  bindWaypointButtons(div, idx);
}

function removeWaypoint(idx) {
  if (idx === 0 || idx === state.waypoints.length - 1) {
    // Don't remove start/end, just clear
    clearWaypoint(idx);
    return;
  }
  state.waypoints.splice(idx, 1);
  refreshWaypointUI();
}

function clearWaypoint(idx) {
  state.waypoints[idx] = { id: idx, lat: null, lng: null, name: '' };
  const inputs = document.querySelectorAll('.waypoint-input');
  if (inputs[idx]) inputs[idx].value = '';
  refreshMarkers();
}

function refreshWaypointUI() {
  const list = document.getElementById('waypoints-list');
  list.innerHTML = '';

  state.waypoints.forEach((w, i) => {
    const div = document.createElement('div');
    div.className = 'waypoint-item';
    div.dataset.index = i;
    const isStart = i === 0;
    const isEnd = i === state.waypoints.length - 1;
    const markerClass = isStart ? 'start' : isEnd ? 'end' : 'via';
    const label = isStart ? 'A' : isEnd ? 'B' : String(i + 1);
    const placeholder = isStart ? '起点（点击地图设置）' : isEnd ? '终点（点击地图设置）' : '途经点（点击地图设置）';

    div.innerHTML = `
      <span class="waypoint-marker ${markerClass}">${label}</span>
      <input type="text" class="waypoint-input" placeholder="${placeholder}" data-index="${i}" readonly value="${w.name || ''}">
      <button class="icon-btn btn-set-waypoint" title="在地图上选点" data-index="${i}">📍</button>
      <button class="icon-btn btn-clear-waypoint" title="清除" data-index="${i}">✕</button>
    `;
    list.appendChild(div);
    bindWaypointButtons(div, i);
  });
}

function bindWaypointButtons(container, idx) {
  container.querySelector('.btn-set-waypoint')?.addEventListener('click', () => {
    const isStart = idx === 0;
    const isEnd = idx === state.waypoints.length - 1;
    state.clickMode = isStart ? 'start' : isEnd ? 'end' : 'waypoint';
    document.getElementById('click-mode-indicator').classList.remove('hidden');
    document.getElementById('click-mode-label').textContent =
      isStart ? '起点' : isEnd ? '终点' : `途经点 ${idx}`;
  });

  container.querySelector('.btn-clear-waypoint')?.addEventListener('click', () => {
    if (idx > 0 && idx < state.waypoints.length - 1) {
      removeWaypoint(idx);
    } else {
      clearWaypoint(idx);
    }
  });
}

function refreshMarkers() {
  clearMarkers();
  state.waypoints.forEach((w, i) => {
    if (w.lat && w.lng) {
      const type = i === 0 ? 'start' : i === state.waypoints.length - 1 ? 'end' : 'via';
      const label = i === 0 ? 'A' : i === state.waypoints.length - 1 ? 'B' : String(i + 1);
      addMarker(w.lat, w.lng, type, label);
    }
  });
}

function cancelClickMode() {
  state.clickMode = null;
  document.getElementById('click-mode-indicator').classList.add('hidden');
}

// ===== Markers =====
function addMarker(lat, lng, type, label) {
  const el = document.createElement('div');
  el.className = `custom-marker ${type}`;
  el.innerHTML = `<span>${label}</span>`;

  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
    .setLngLat([lng, lat])
    .addTo(state.map);

  state.markers.push(marker);
}

function clearMarkers() {
  for (const m of state.markers) m.remove();
  state.markers = [];
}

// ===== Route Planning (with Map Matching) =====
function planRoute() {
  if (!state.pathfinder || !state.graph) {
    alert('路网数据尚未加载完成');
    return;
  }

  const validWaypoints = state.waypoints.filter(w => w.lat !== null && w.lng !== null);
  if (validWaypoints.length < 2) {
    alert('请至少设置起点和终点（点击 📍 按钮在地图上选点）');
    return;
  }

  // 使用地图匹配获取节点 ID
  const nodeIds = validWaypoints.map(w => {
    // 如果已经有匹配结果，直接用
    if (w.matchNodeId) return w.matchNodeId;
    // 否则重新匹配
    if (state.mapMatcher) {
      const result = state.mapMatcher.matchPoint(w.lat, w.lng, state.currentMode);
      return result.nodeId;
    }
    return state.graph.findNearestNode(w.lat, w.lng);
  });

  if (nodeIds.some(id => id === null || id === undefined)) {
    alert('无法找到附近的道路节点');
    return;
  }

  const result = nodeIds.length === 2
    ? state.pathfinder.findPath(nodeIds[0], nodeIds[1], state.currentMode, state.optimize)
    : state.pathfinder.findPathMultiWaypoint(nodeIds, state.currentMode, state.optimize);

  if (!result) {
    alert('未找到可行路径，请检查起终点位置');
    return;
  }

  state.routeResult = result;
  renderRoute(result);
  showRouteResult(result);
}

function clearRoute() {
  state.routeResult = null;
  document.getElementById('route-result').classList.add('hidden');

  if (state.map?.getSource('route')) {
    state.map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
  }
  if (state.map?.getSource('snap-indicator')) {
    state.map.getSource('snap-indicator').setData({ type: 'FeatureCollection', features: [] });
  }

  clearMarkers();
  state.waypoints.forEach(w => { w.lat = null; w.lng = null; w.name = ''; w.matchNodeId = undefined; });

  // Reset to 2 waypoints
  if (state.waypoints.length > 2) {
    state.waypoints = [
      { id: 0, lat: null, lng: null, name: '' },
      { id: 1, lat: null, lng: null, name: '' }
    ];
  }
  refreshWaypointUI();
}

// ===== POI =====
function searchPOI() {
  const keyword = document.getElementById('poi-search-input').value.trim().toLowerCase();
  const activeCat = document.querySelector('.cat-btn.active')?.dataset.cat || 'all';

  const categoryIcons = {
    scenic: '🏛️', shop: '🛍️', hotel: '🏨', food: '🍜',
    transport: '🚉', medical: '🏥'
  };

  const container = document.getElementById('poi-results');
  container.innerHTML = '';

  let poiList = state.poiData;

  // 如果有数据库，优先从数据库查询
  if (state.db) {
    try {
      const dbPois = state.db.getPOIs(activeCat !== 'all' ? activeCat : null);
      if (dbPois.length > 0) poiList = dbPois;
    } catch (e) { /* fallback */ }
  }

  const filtered = poiList.filter(p => {
    const matchName = !keyword || p.name.toLowerCase().includes(keyword) || (p.address || '').toLowerCase().includes(keyword);
    const matchCat = activeCat === 'all' || p.category === activeCat;
    return matchName && matchCat;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:12px;font-size:13px">无匹配结果</p>';
    return;
  }

  for (const poi of filtered) {
    const div = document.createElement('div');
    div.className = 'poi-item';
    div.innerHTML = `
      <span class="poi-icon">${categoryIcons[poi.category] || '📍'}</span>
      <div class="poi-info">
        <div class="poi-name">${poi.name}</div>
        <div class="poi-address">${poi.address || ''}</div>
      </div>
    `;
    div.addEventListener('click', () => {
      state.map.flyTo({ center: [poi.lng, poi.lat], zoom: 15, duration: 1000 });
      new maplibregl.Popup({ offset: 15 })
        .setLngLat([poi.lng, poi.lat])
        .setHTML(`<strong>${poi.name}</strong><br><span style="color:#94a3b8;font-size:12px">${poi.address || ''}</span>`)
        .addTo(state.map);
    });
    container.appendChild(div);
  }
}

function findNearestPOI(lat, lng) {
  let nearest = null, minDist = Infinity;
  for (const poi of state.poiData) {
    const dist = Graph.haversine(lat, lng, poi.lat, poi.lng);
    if (dist < minDist) { minDist = dist; nearest = poi; }
  }
  return minDist < 0.5 ? nearest : null;
}

// ===== Reverse Geocoding =====
function reverseGeocode(lat, lng) {
  const resultDiv = document.getElementById('geocode-result');
  resultDiv.classList.remove('hidden');

  const nearby = state.poiData
    .map(p => ({ ...p, dist: Graph.haversine(lat, lng, p.lat, p.lng) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);

  // 显示地图匹配信息
  let matchInfo = '';
  if (state.mapMatcher) {
    const match = state.mapMatcher.matchPoint(lat, lng, state.currentMode);
    const modeNames = { driving: '驾车', walking: '步行', cycling: '骑行' };
    matchInfo = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(148,163,184,0.2)">
      <span style="color:#22c55e;font-size:11px">📍 ${modeNames[state.currentMode]}匹配</span><br>
      <span style="color:var(--text-muted);font-size:11px">吸附距离: ${Math.round(match.projection.distance * 1000)}m</span>
      ${match.virtualNode ? '<br><span style="color:var(--text-muted);font-size:11px">边中点吸附(虚拟节点)</span>' : ''}
    </div>`;
  }

  if (nearby.length > 0 && nearby[0].dist < 1) {
    const poi = nearby[0];
    resultDiv.innerHTML = `
      <strong>📍 ${poi.name}</strong><br>
      <span style="color:var(--text-muted)">${poi.address || ''}</span><br>
      <span style="color:var(--text-muted);font-size:11px">距此 ${Math.round(poi.dist * 1000)}m</span>
      ${nearby.length > 1 ? '<br><span style="color:var(--text-muted);font-size:11px">附近: ' +
        nearby.slice(1, 4).map(n => n.name).join('、') + '</span>' : ''}
      ${matchInfo}
    `;
  } else {
    resultDiv.innerHTML = `
      <strong>📍 坐标位置</strong><br>
      <span style="color:var(--text-muted)">纬度: ${lat.toFixed(6)}</span><br>
      <span style="color:var(--text-muted)">经度: ${lng.toFixed(6)}</span>
      ${matchInfo}
    `;
  }

  document.getElementById('input-lat').value = lat.toFixed(6);
  document.getElementById('input-lng').value = lng.toFixed(6);
}

// ===== UI Setup =====
function setupUI() {
  // Mode selector
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentMode = btn.dataset.mode;
    });
  });

  // Optimize radio
  document.querySelectorAll('input[name="optimize"]').forEach(radio => {
    radio.addEventListener('change', () => {
      state.optimize = radio.value;
    });
  });

  // Plan / Clear
  document.getElementById('btn-plan-route').addEventListener('click', planRoute);
  document.getElementById('btn-clear-route').addEventListener('click', clearRoute);

  // Add waypoint
  document.getElementById('btn-add-waypoint').addEventListener('click', addWaypoint);

  // Sidebar toggle
  document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('collapsed');
  });

  document.getElementById('btn-expand-sidebar').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('collapsed');
  });

  // Cancel click mode
  document.getElementById('btn-cancel-click-mode').addEventListener('click', cancelClickMode);

  // POI search
  document.getElementById('btn-poi-search').addEventListener('click', searchPOI);
  document.getElementById('poi-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchPOI();
  });

  // Category filters
  document.querySelectorAll('.cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      searchPOI();
    });
  });

  // Reverse geocode
  document.getElementById('btn-reverse-geocode').addEventListener('click', () => {
    const lat = parseFloat(document.getElementById('input-lat').value);
    const lng = parseFloat(document.getElementById('input-lng').value);
    if (!isNaN(lat) && !isNaN(lng)) reverseGeocode(lat, lng);
  });

  // Bind initial waypoint buttons
  document.querySelectorAll('.waypoint-item').forEach(item => {
    const idx = parseInt(item.dataset.index);
    bindWaypointButtons(item, idx);
  });

  // Render initial POI list
  searchPOI();
}

// ===== Start =====
document.addEventListener('DOMContentLoaded', initApp);
