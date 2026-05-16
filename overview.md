# 离线地图路径规划工具 - 修复总结

## 本次修复：地图瓦片不加载 + 中文标签渲染

### 问题
用户反馈地图图层不显示，页面右侧地图区域为空白；中文标签显示为方块。

### 根本原因
1. **MapLibre GL JS 不支持 `{1-4}` 子域名范围语法**。代码中瓦片 URL 写为 `https://wprd0{1-4}.is.autonavi.com/...`，MapLibre 原样发送，DNS 无法解析导致所有瓦片请求失败。
2. **外部 PBF 字体服务（demotiles.maplibre.org）在中国不可用**，返回 404，中文标签无法渲染。

### 修复内容

1. **展开瓦片子域名** (`src/renderer/app.js`)
   - 将单条 `{1-4}` URL 展开为 4 条独立子域名 URL (wprd01 ~ wprd04)

2. **移除外部字体依赖** (`src/renderer/app.js`)
   - 移除 `glyphs` 属性
   - 添加 `localIdeographFontFamily: 'Microsoft YaHei, PingFang SC, sans-serif'`

3. **重写 README.md**
   - 新增 4 张运行截图（主界面、驾驶路径、步行路径、瓦片诊断）
   - 新增"中国网络环境适配"章节
   - 新增"已知问题与踩坑记录"章节（6 个问题表格）

4. **更新 MEMORY.md**
   - 已知问题整理为表格
   - 新增"关键踩坑记录"章节

### 验证结果
- Headless Chrome 截图确认地图正常显示北京区域
- 后端 26 项测试全部通过
- 浏览器 VM 16 项测试全部通过
- 前端 49 项诊断测试全部通过

### GitHub 推送
- 提交 15 个文件，1081 行新增
- 推送至 `github.com:desity181/0516_map.git`
