/**
 * Graph - 路网图数据结构
 * 使用邻接表存储，支持空间索引快速查找
 */
class Graph {
  constructor() {
    this.nodes = new Map();   // id -> { id, lat, lng }
    this.edges = new Map();   // id -> [{ to, distance, speed, mode, name }]
    this.spatialIndex = null; // R-tree 空间索引
    this._virtualIdCounter = -1; // 虚拟节点 ID 计数器（负数避免碰撞）
  }

  addNode(id, lat, lng) {
    this.nodes.set(id, { id, lat, lng });
    if (!this.edges.has(id)) {
      this.edges.set(id, []);
    }
  }

  addEdge(from, to, distance, speed, mode, name, bidirectional = true) {
    if (!this.edges.has(from)) this.edges.set(from, []);
    this.edges.get(from).push({ to, distance, speed, mode, name });

    if (bidirectional) {
      if (!this.edges.has(to)) this.edges.set(to, []);
      this.edges.get(to).push({ to: from, distance, speed, mode, name });
    }
  }

  getNode(id) {
    return this.nodes.get(id);
  }

  getNeighbors(id) {
    return this.edges.get(id) || [];
  }

  get nodeCount() {
    return this.nodes.size;
  }

  get edgeCount() {
    let count = 0;
    for (const edges of this.edges.values()) count += edges.length;
    return count;
  }

  /**
   * 构建空间索引 - 基于 GeoHash 的简化 R-tree
   */
  buildSpatialIndex() {
    this.spatialIndex = [];
    for (const [id, node] of this.nodes) {
      this.spatialIndex.push({ id, lat: node.lat, lng: node.lng });
    }
    // Sort by lat for binary search
    this.spatialIndex.sort((a, b) => a.lat - b.lat);
  }

  /**
   * 查找最近节点 - O(n) 对于简化索引，O(log n) 可升级
   */
  findNearestNode(lat, lng) {
    if (!this.spatialIndex) this.buildSpatialIndex();

    let minDist = Infinity;
    let nearestId = null;

    // Optimization: narrow search to nearby lat range first
    const latRange = 0.01; // ~1km
    const startIdx = this._binarySearchLat(lat - latRange);
    const endIdx = this._binarySearchLat(lat + latRange);

    for (let i = startIdx; i <= endIdx && i < this.spatialIndex.length; i++) {
      const entry = this.spatialIndex[i];
      const dist = this._haversine(lat, lng, entry.lat, entry.lng);
      if (dist < minDist) {
        minDist = dist;
        nearestId = entry.id;
      }
    }

    // Fallback to full scan if nothing found nearby
    if (nearestId === null) {
      for (const entry of this.spatialIndex) {
        const dist = this._haversine(lat, lng, entry.lat, entry.lng);
        if (dist < minDist) {
          minDist = dist;
          nearestId = entry.id;
        }
      }
    }

    return nearestId;
  }

  _binarySearchLat(targetLat) {
    let lo = 0, hi = this.spatialIndex.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.spatialIndex[mid].lat < targetLat) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Haversine 距离计算 (km)
   */
  _haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * 查找半径范围内的节点 - 基于空间索引
   */
  findNodesInRadius(lat, lng, radiusKm) {
    if (!this.spatialIndex) this.buildSpatialIndex();

    const latRange = radiusKm / 111.0; // 1度纬度 ≈ 111km
    const lngRange = radiusKm / (111.0 * Math.cos(lat * Math.PI / 180));

    const startIdx = this._binarySearchLat(lat - latRange);
    const endIdx = this._binarySearchLat(lat + latRange);

    const results = [];
    for (let i = startIdx; i <= endIdx && i < this.spatialIndex.length; i++) {
      const entry = this.spatialIndex[i];
      const dist = this._haversine(lat, lng, entry.lat, entry.lng);
      if (dist <= radiusKm) {
        results.push({ id: entry.id, lat: entry.lat, lng: entry.lng, distance: dist });
      }
    }

    return results;
  }

  /**
   * 插入虚拟节点（地图匹配时在边中点插入）
   */
  insertVirtualNode(fromId, edge, projection) {
    const virtualId = this._virtualIdCounter--;
    this.addNode(virtualId, projection.lat, projection.lng);

    const dist1 = edge.distance * projection.fraction;
    const dist2 = edge.distance * (1 - projection.fraction);

    this.addEdge(fromId, virtualId, dist1, edge.speed, edge.mode, edge.name, false);
    this.addEdge(virtualId, edge.to, dist2, edge.speed, edge.mode, edge.name, false);

    // 删除原始正向边
    this._removeEdge(fromId, edge.to);
    // 删除原始反向边（如果存在）
    this._removeEdge(edge.to, fromId);
    // 添加新的反向边
    this.addEdge(virtualId, fromId, dist1, edge.speed, edge.mode, edge.name, false);
    this.addEdge(edge.to, virtualId, dist2, edge.speed, edge.mode, edge.name, false);

    // 重建空间索引
    this.buildSpatialIndex();

    return { id: virtualId, lat: projection.lat, lng: projection.lng };
  }

  /**
   * 删除指定边
   */
  _removeEdge(fromId, toId) {
    const neighbors = this.edges.get(fromId);
    if (!neighbors) return;
    const idx = neighbors.findIndex(e => e.to === toId);
    if (idx !== -1) neighbors.splice(idx, 1);
  }

  /**
   * 静态 Haversine 方法
   */
  static haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * 导出为紧凑 JSON 格式
   */
  toJSON() {
    const nodesArr = [];
    const edgesArr = [];
    for (const [id, node] of this.nodes) {
      nodesArr.push([id, node.lat, node.lng]);
    }
    for (const [fromId, neighbors] of this.edges) {
      for (const e of neighbors) {
        edgesArr.push([fromId, e.to, e.distance, e.speed, e.mode, e.name || '']);
      }
    }
    return { nodes: nodesArr, edges: edgesArr };
  }

  /**
   * 从 JSON 格式导入
   */
  static fromJSON(data) {
    const g = new Graph();
    for (const [id, lat, lng] of data.nodes) {
      g.addNode(id, lat, lng);
    }
    for (const [from, to, distance, speed, mode, name] of data.edges) {
      g.addEdge(from, to, distance, speed, mode, name, false);
    }
    g.buildSpatialIndex();
    return g;
  }
}

module.exports = Graph;
