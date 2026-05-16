/**
 * 离线地图路径规划工具 v1.0 - 前端主逻辑
 * 纯 Web 版本，无需 Electron，直接浏览器运行
 */

// ===== State =====
const state = {
  map: null,
  graph: null,
  pathfinder: null,
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
  networkLayerAdded: false
};

// ===== Init =====
async function initApp() {
  // Load sample data first
  await loadSampleData();

  // Init map
  initMap();

  // Setup UI
  setupUI();
}

// ===== Map =====
function initMap() {
  state.map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      name: 'Offline Dark',
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors'
        }
      },
      layers: [{
        id: 'osm-layer',
        type: 'raster',
        source: 'osm-tiles',
        minzoom: 0,
        maxzoom: 19
      }],
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
    },
    center: [116.397, 39.920],
    zoom: 13.5,
    minZoom: 10,
    maxZoom: 18,
    attributionControl: false
  });

  state.map.addControl(new maplibregl.NavigationControl(), 'top-right');
  state.map.addControl(new maplibregl.ScaleControl({ maxWidth: 150, unit: 'metric' }), 'bottom-right');

  state.map.on('load', onMapLoaded);
  state.map.on('click', onMapClick);
  state.map.on('contextmenu', onMapRightClick);
  state.map.on('mousemove', onMapMouseMove);
}

function onMapLoaded() {
  console.log('Map loaded');

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

  // Render POIs and road network
  renderPOIs();
  renderRoadNetwork();

  // Update data info
  updateDataInfo();
}

// ===== Map Events =====
function onMapClick(e) {
  const { lat, lng } = e.lngLat;

  if (state.clickMode) {
    setWaypointFromMap(lat, lng, state.clickMode);
    cancelClickMode();
    return;
  }
}

function onMapRightClick(e) {
  e.preventDefault();
  const { lat, lng } = e.lngLat;
  reverseGeocode(lat, lng);
}

function onMapMouseMove(e) {
  const { lat, lng } = e.lngLat;
  const overlay = document.getElementById('overlay-coords');
  if (overlay) {
    overlay.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  }
  document.getElementById('map-overlay-info').classList.remove('hidden');
}

// ===== Data Loading =====
async function loadSampleData() {
  try {
    const resp = await fetch('/assets/data/sample-data.json');
    const data = await resp.json();
    state.poiData = data.pois || [];
    state.graph = buildGraph(data.graph);
    state.pathfinder = new Pathfinder(state.graph);
    console.log(`Loaded: ${state.graph.nodeCount} nodes, ${state.graph.edgeCount} edges, ${state.poiData.length} POIs`);
  } catch (err) {
    console.error('Failed to load sample data:', err);
    loadEmbeddedData();
  }
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
  state.graph = buildGraph(data);
  state.pathfinder = new Pathfinder(state.graph);
  state.poiData = [
    { name: '天安门', category: 'scenic', lat: 39.9087, lng: 116.3975, address: '东城区天安门' },
    { name: '故宫', category: 'scenic', lat: 39.9163, lng: 116.3972, address: '景山前街4号' },
  ];
}

// ===== Graph Builder =====
function buildGraph(data) {
  const nodes = new Map();
  const edges = new Map();

  for (const [id, lat, lng] of data.nodes) {
    nodes.set(id, { id, lat, lng });
    edges.set(id, []);
  }

  for (const [from, to, distance, speed, mode, name] of data.edges) {
    if (edges.has(from)) {
      edges.get(from).push({ to, distance, speed, mode, name });
    }
  }

  const spatialIndex = [];
  for (const [id, node] of nodes) {
    spatialIndex.push({ id, lat: node.lat, lng: node.lng });
  }
  spatialIndex.sort((a, b) => a.lat - b.lat);

  return {
    nodes, edges, spatialIndex,
    get nodeCount() { return nodes.size; },
    get edgeCount() { let c = 0; for (const e of edges.values()) c += e.length; return c; },
    getNode(id) { return nodes.get(id); },
    getNeighbors(id) { return edges.get(id) || []; },
    findNearestNode(lat, lng) {
      let minDist = Infinity, nearestId = null;
      for (const entry of spatialIndex) {
        const dist = haversine(lat, lng, entry.lat, entry.lng);
        if (dist < minDist) { minDist = dist; nearestId = entry.id; }
      }
      return nearestId;
    }
  };
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ===== Pathfinder =====
class Pathfinder {
  constructor(graph) { this.graph = graph; }

  findPath(startId, endId, mode = 'driving', optimize = 'fastest') {
    if (startId === endId) return { path: [startId], distance: 0, time: 0, steps: [] };

    const endNode = this.graph.getNode(endId);
    const openSet = new Set();
    const closedSet = new Set();
    const gScore = new Map();
    const fScore = new Map();
    const cameFrom = new Map();
    const h = this._heuristic.bind(this, endNode);

    gScore.set(startId, 0);
    fScore.set(startId, h(startId));
    openSet.add(startId);
    cameFrom.set(startId, { parent: null, edge: null });

    let iterations = 0;
    const maxIter = 100000;

    while (openSet.size > 0 && iterations++ < maxIter) {
      let currentId = null, currentF = Infinity;
      for (const id of openSet) {
        const f = fScore.get(id) || Infinity;
        if (f < currentF) { currentF = f; currentId = id; }
      }

      if (currentId === endId) return this._reconstructPath(cameFrom, currentId);

      openSet.delete(currentId);
      closedSet.add(currentId);

      for (const edge of this.graph.getNeighbors(currentId)) {
        if (closedSet.has(edge.to)) continue;
        if (!this._edgeCompatible(edge, mode)) continue;

        const edgeWeight = this._calcWeight(edge, mode, optimize);
        const tentativeG = (gScore.get(currentId) || 0) + edgeWeight;

        const existingG = gScore.get(edge.to);
        if (existingG === undefined || tentativeG < existingG) {
          cameFrom.set(edge.to, { parent: currentId, edge });
          gScore.set(edge.to, tentativeG);
          fScore.set(edge.to, tentativeG + h(edge.to));
          openSet.add(edge.to);
        }
      }
    }
    return null;
  }

  findPathMultiWaypoint(waypointIds, mode = 'driving', optimize = 'fastest') {
    if (waypointIds.length < 2) return null;

    let totalDistance = 0, totalTime = 0, fullPath = [], allSteps = [];

    for (let i = 0; i < waypointIds.length - 1; i++) {
      const result = this.findPath(waypointIds[i], waypointIds[i + 1], mode, optimize);
      if (!result) return null;

      totalDistance += result.distance;
      totalTime += result.time;
      fullPath = i === 0 ? [...result.path] : [...fullPath, ...result.path.slice(1)];
      allSteps.push(...result.steps);
    }

    return { path: fullPath, distance: totalDistance, time: totalTime, steps: allSteps };
  }

  _heuristic(endNode, nodeId) {
    const node = this.graph.getNode(nodeId);
    if (!node || !endNode) return 0;
    return haversine(node.lat, node.lng, endNode.lat, endNode.lng);
  }

  _calcWeight(edge, mode, optimize) {
    if (optimize === 'shortest') return edge.distance;
    const speed = this._getSpeed(edge, mode);
    return speed > 0 ? edge.distance / speed : edge.distance;
  }

  _getSpeed(edge, mode) {
    return { walking: 5, cycling: 15, driving: edge.speed || 50 }[mode] || 50;
  }

  _edgeCompatible(edge, mode) {
    if (!edge.mode) return true;
    const m = {
      driving: ['driving','motorway','trunk','primary','secondary','tertiary','residential'],
      walking: ['walking','footway','pedestrian','path','driving','residential','secondary','primary','trunk','tertiary'],
      cycling: ['cycling','cycleway','driving','residential','secondary','tertiary','primary','trunk']
    };
    return (m[mode] || []).includes(edge.mode);
  }

  _reconstructPath(cameFrom, endId) {
    const path = [], steps = [];
    let totalDist = 0, totalTime = 0, currentId = endId;

    while (currentId !== null) {
      const record = cameFrom.get(currentId);
      if (!record && currentId !== endId) break;

      path.unshift(currentId);

      if (record && record.edge) {
        totalDist += record.edge.distance;
        totalTime += record.edge.distance / (record.edge.speed || 50);
        steps.unshift({
          from: record.parent, to: currentId,
          distance: record.edge.distance, name: record.edge.name || '未命名道路',
          speed: record.edge.speed || 50
        });
      }

      currentId = record ? record.parent : null;
    }

    return {
      path,
      distance: Math.round(totalDist * 100) / 100,
      time: Math.round(totalTime * 60 * 10) / 10,
      steps
    };
  }
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

// ===== Waypoints =====
function setWaypointFromMap(lat, lng, type) {
  let idx;
  if (type === 'start') idx = 0;
  else if (type === 'end') idx = state.waypoints.length - 1;
  else {
    idx = state.waypoints.findIndex(w => w.lat === null);
    if (idx === -1) idx = state.waypoints.length - 1;
  }

  state.waypoints[idx].lat = lat;
  state.waypoints[idx].lng = lng;

  const nearestPOI = findNearestPOI(lat, lng);
  const name = nearestPOI
    ? `${nearestPOI.name}附近`
    : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  state.waypoints[idx].name = name;

  const inputs = document.querySelectorAll('.waypoint-input');
  if (inputs[idx]) inputs[idx].value = name;

  // Add marker immediately
  const markerType = idx === 0 ? 'start' : idx === state.waypoints.length - 1 ? 'end' : 'via';
  const label = idx === 0 ? 'A' : idx === state.waypoints.length - 1 ? 'B' : String(idx + 1);
  addMarker(lat, lng, markerType, label);
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

// ===== Route Planning =====
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

  const nodeIds = validWaypoints.map(w => state.graph.findNearestNode(w.lat, w.lng));

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

  clearMarkers();
  state.waypoints.forEach(w => { w.lat = null; w.lng = null; w.name = ''; });

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

  const filtered = state.poiData.filter(p => {
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
    const dist = haversine(lat, lng, poi.lat, poi.lng);
    if (dist < minDist) { minDist = dist; nearest = poi; }
  }
  return minDist < 0.5 ? nearest : null;
}

// ===== Reverse Geocoding =====
function reverseGeocode(lat, lng) {
  const resultDiv = document.getElementById('geocode-result');
  resultDiv.classList.remove('hidden');

  const nearby = state.poiData
    .map(p => ({ ...p, dist: haversine(lat, lng, p.lat, p.lng) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);

  if (nearby.length > 0 && nearby[0].dist < 1) {
    const poi = nearby[0];
    resultDiv.innerHTML = `
      <strong>📍 ${poi.name}</strong><br>
      <span style="color:var(--text-muted)">${poi.address || ''}</span><br>
      <span style="color:var(--text-muted);font-size:11px">距此 ${Math.round(poi.dist * 1000)}m</span>
      ${nearby.length > 1 ? '<br><span style="color:var(--text-muted);font-size:11px">附近: ' +
        nearby.slice(1, 4).map(n => n.name).join('、') + '</span>' : ''}
    `;
  } else {
    resultDiv.innerHTML = `
      <strong>📍 坐标位置</strong><br>
      <span style="color:var(--text-muted)">纬度: ${lat.toFixed(6)}</span><br>
      <span style="color:var(--text-muted)">经度: ${lng.toFixed(6)}</span>
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
