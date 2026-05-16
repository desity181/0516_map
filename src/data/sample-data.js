/**
 * Sample Data Generator - 生成北京市区示例路网数据
 * 修复：确保道路交叉点共享同一节点
 */

function generateSampleData() {
  const graph = { nodes: [], edges: [] };
  const coordToId = new Map();
  let nodeId = 0;

  // 定义关键交叉点坐标（所有道路共享这些节点）
  const intersections = {
    // 长安街 x 各南北向道路
    'CA_XE': [39.9075, 116.355],  // 长安街x西二环
    'CA_XD': [39.9075, 116.370],  // 长安街x西单大街
    'CA_TM': [39.9075, 116.385], // 长安街x天安门广场路
    'CA_WF': [39.9075, 116.400], // 长安街x王府井大街
    'CA_DD': [39.9075, 116.415], // 长安街x东单大街
    'CA_DE': [39.9075, 116.430], // 长安街x东二环
    'CA_JG': [39.9075, 116.445], // 长安街x建国门大街

    // 前门大街 x 各道路
    'QM_XE': [39.9000, 116.355],
    'QM_XD': [39.9000, 116.370],

    // 景山前街 x 各南北向道路
    'JS_XD': [39.9200, 116.370],
    'JS_TM': [39.9200, 116.385],
    'JS_WF': [39.9200, 116.400],
    'JS_DD': [39.9200, 116.415],

    // 平安大街 x 各南北向道路
    'PA_XE': [39.9300, 116.355],
    'PA_XD': [39.9300, 116.370],
    'PA_TM': [39.9300, 116.385],
    'PA_WF': [39.9300, 116.400],
    'PA_DD': [39.9300, 116.415],
    'PA_DE': [39.9300, 116.430],

    // 鼓楼东大街 x 各道路
    'GL_XD': [39.9420, 116.370],
    'GL_TM': [39.9420, 116.385],
    'GL_WF': [39.9420, 116.400],
    'GL_DD': [39.9420, 116.415],

    // 北三环 x 各道路
    'BS_XE': [39.9550, 116.355],
    'BS_XD': [39.9550, 116.370],
    'BS_TM': [39.9550, 116.385],
    'BS_WF': [39.9550, 116.400],
    'BS_DD': [39.9550, 116.415],
    'BS_DE': [39.9550, 116.430],
    'BS_JG': [39.9550, 116.445],

    // 安定门大街 (南北)
    'AD_JS': [39.9480, 116.385],
    'AD_PA': [39.9480, 116.400],
    'AD_DD': [39.9480, 116.415],
    'AD_DE': [39.9480, 116.430],

    // 德胜门大街 (东西)
    'DS_XD': [39.9550, 116.370],

    // 中间补充点
    'NCZ_1': [39.9130, 116.390],  // 南池子大街中间
    'NCZ_2': [39.9200, 116.393],  // 南池子大街北端
  };

  function getOrCreateNode(lat, lng) {
    const key = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
    if (coordToId.has(key)) return coordToId.get(key);
    const id = nodeId++;
    coordToId.set(key, id);
    graph.nodes.push([id, lat, lng]);
    return id;
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

  function addEdge(fromId, toId, lat1, lng1, lat2, lng2, speed, mode, name) {
    const dist = Math.round(haversine(lat1, lng1, lat2, lng2) * 1000) / 1000;
    graph.edges.push([fromId, toId, dist, speed, mode, name]);
    graph.edges.push([toId, fromId, dist, speed, mode, name]);
  }

  // 预先注册所有交叉点
  for (const [key, [lat, lng]] of Object.entries(intersections)) {
    getOrCreateNode(lat, lng);
  }

  // 定义道路（通过交叉点 key 引用，保证交汇点共享节点）
  const roads = [
    // === 东西向主干道 ===
    // 长安街
    { name: '长安街', speed: 60, mode: 'primary', points: ['CA_XE','CA_XD','CA_TM','CA_WF','CA_DD','CA_DE','CA_JG'] },
    // 平安大街
    { name: '平安大街', speed: 50, mode: 'primary', points: ['PA_XE','PA_XD','PA_TM','PA_WF','PA_DD','PA_DE'] },
    // 北三环
    { name: '北三环', speed: 80, mode: 'trunk', points: ['BS_XE','BS_XD','BS_TM','BS_WF','BS_DD','BS_DE','BS_JG'] },

    // === 南北向主干道 ===
    // 西二环
    { name: '西二环', speed: 80, mode: 'trunk', points: ['QM_XE','CA_XE','PA_XE','BS_XE'] },
    // 西单大街
    { name: '西单大街', speed: 40, mode: 'primary', points: ['QM_XD','CA_XD','JS_XD','PA_XD','GL_XD','BS_XD'] },
    // 天安门广场路 / 南池子大街
    { name: '南池子大街', speed: 30, mode: 'secondary', points: ['CA_TM','NCZ_1','NCZ_2','JS_TM'] },
    // 天安门广场路北段
    { name: '天安门广场路', speed: 40, mode: 'primary', points: ['JS_TM','PA_TM','GL_TM','BS_TM'] },
    // 王府井大街
    { name: '王府井大街', speed: 40, mode: 'primary', points: ['CA_WF','JS_WF','PA_WF','GL_WF','BS_WF'] },
    // 东单大街
    { name: '东单大街', speed: 40, mode: 'primary', points: ['CA_DD','JS_DD','PA_DD','GL_DD','BS_DD'] },
    // 东二环
    { name: '东二环', speed: 80, mode: 'trunk', points: ['CA_DE','PA_DE','AD_DE','BS_DE'] },
    // 建国门大街
    { name: '建国门大街', speed: 50, mode: 'primary', points: ['CA_JG','BS_JG'] },

    // === 连接道路 ===
    // 景山前街
    { name: '景山前街', speed: 30, mode: 'secondary', points: ['JS_XD','JS_TM','JS_WF','JS_DD'] },
    // 鼓楼东大街
    { name: '鼓楼东大街', speed: 30, mode: 'secondary', points: ['GL_XD','GL_TM','AD_JS','GL_WF','AD_PA','GL_DD'] },
    // 前门大街
    { name: '前门大街', speed: 30, mode: 'secondary', points: ['QM_XE','QM_XD'] },

    // === 安定门大街（南北）===
    { name: '安定门大街', speed: 35, mode: 'secondary', points: ['AD_JS','AD_PA','AD_DD','AD_DE'] },
  ];

  // 步行专用道
  const walkingRoads = [
    { name: '故宫步道', speed: 5, mode: 'footway', points: ['CA_TM','JS_TM'] },
    { name: '景山步道', speed: 5, mode: 'footway', points: ['JS_TM','JS_WF'] },
  ];

  // 构建边
  const allRoads = [...roads, ...walkingRoads];
  for (const road of allRoads) {
    for (let i = 0; i < road.points.length - 1; i++) {
      const key1 = road.points[i];
      const key2 = road.points[i + 1];
      const [lat1, lng1] = intersections[key1];
      const [lat2, lng2] = intersections[key2];
      const id1 = coordToId.get(`${lat1.toFixed(4)}_${lng1.toFixed(4)}`);
      const id2 = coordToId.get(`${lat2.toFixed(4)}_${lng2.toFixed(4)}`);

      if (id1 !== undefined && id2 !== undefined) {
        addEdge(id1, id2, lat1, lng1, lat2, lng2, road.speed, road.mode, road.name);
      }
    }
  }

  // Generate POI data
  const pois = [
    { name: '天安门', category: 'scenic', lat: 39.9087, lng: 116.3975, address: '东城区天安门' },
    { name: '故宫博物院', category: 'scenic', lat: 39.9163, lng: 116.3972, address: '东城区景山前街4号' },
    { name: '天坛公园', category: 'scenic', lat: 39.8822, lng: 116.4066, address: '东城区天坛内东里7号' },
    { name: '景山公园', category: 'scenic', lat: 39.9215, lng: 116.3965, address: '西城区景山西街44号' },
    { name: '北海公园', category: 'scenic', lat: 39.9260, lng: 116.3880, address: '西城区文津街1号' },
    { name: '王府井商业街', category: 'shop', lat: 39.9140, lng: 116.4100, address: '东城区王府井大街' },
    { name: '西单商圈', category: 'shop', lat: 39.9120, lng: 116.3730, address: '西城区西单北大街' },
    { name: '前门大街', category: 'shop', lat: 39.8990, lng: 116.3950, address: '东城区前门大街' },
    { name: '南锣鼓巷', category: 'shop', lat: 39.9370, lng: 116.4030, address: '东城区南锣鼓巷' },
    { name: '北京饭店', category: 'hotel', lat: 39.9090, lng: 116.4050, address: '东城区东长安街33号' },
    { name: '建国饭店', category: 'hotel', lat: 39.9090, lng: 116.4450, address: '朝阳区建国门外大街5号' },
    { name: '全聚德烤鸭店', category: 'food', lat: 39.8990, lng: 116.3960, address: '东城区前门大街30号' },
    { name: '东来顺饭庄', category: 'food', lat: 39.9190, lng: 116.4100, address: '东城区王府井大街198号' },
    { name: '护国寺小吃', category: 'food', lat: 39.9340, lng: 116.3730, address: '西城区护国寺大街' },
    { name: '北京站', category: 'transport', lat: 39.9020, lng: 116.4270, address: '东城区北京站西街' },
    { name: '北京西站', category: 'transport', lat: 39.8940, lng: 116.3220, address: '丰台区莲花池东路' },
    { name: '鼓楼', category: 'scenic', lat: 39.9410, lng: 116.3900, address: '东城区钟楼湾胡同' },
    { name: '什刹海', category: 'scenic', lat: 39.9390, lng: 116.3850, address: '西城区什刹海' },
    { name: '协和医院', category: 'medical', lat: 39.9120, lng: 116.4150, address: '东城区帅府园1号' },
    { name: '同仁医院', category: 'medical', lat: 39.8990, lng: 116.4100, address: '东城区东交民巷1号' },
  ];

  return { graph, pois };
}

// Run and output
const data = generateSampleData();
console.log(JSON.stringify(data));
