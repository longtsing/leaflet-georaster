# leaflet-georaster

在 Leaflet 地图上显示 GeoTIFF 栅格数据

> **GitHub 仓库**: https://github.com/longtsing/leaflet-georaster

## 目录

- [特性](#特性)
- [安装](#安装)
- [快速开始](#快速开始)
- [API 参考](#api-参考)
- [使用示例](#使用示例)
- [图层移除问题修复](#图层移除问题修复)
- [性能优化](#性能优化)
- [故障排除](#故障排除)
- [构建](#构建)
- [License](#license)

---

## 特性

- ✅ 支持 GeoTIFF 和 Cloud Optimized GeoTIFF (COG)
- ✅ 自定义颜色映射函数
- ✅ 修复原库图层移除不彻底的问题
- ✅ 颜色缓存机制，提升渲染性能
- ✅ 使用 Uint32Array 优化像素操作
- ✅ 支持遮罩（mask）功能
- ✅ 支持动态更新数据
- ✅ 事件系统（load, error）
- ✅ 轻量级，无额外依赖

---

## 安装

```bash
npm install leaflet-georaster
```

### 前置依赖

```bash
npm install leaflet georaster
```

### CDN 引用

```html
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://unpkg.com/georaster"></script>
<script src="https://unpkg.com/leaflet-georaster"></script>
```

---

## 快速开始

### Vue 项目

```vue
<script setup>
import { onMounted, ref } from 'vue';
import L from 'leaflet';
import GeoRasterLayer from 'leaflet-georaster';
import parseGeoraster from 'georaster';

const mapEl = ref(null);

onMounted(async () => {
  const map = L.map(mapEl.value).setView([39.9, 116.4], 8);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

  const response = await fetch('your-file.tif');
  const arrayBuffer = await response.arrayBuffer();
  const georaster = await parseGeoraster(arrayBuffer);

  const layer = new GeoRasterLayer({
    georaster,
    opacity: 0.7,
    resolution: 64
  });
  
  layer.addTo(map);
  map.fitBounds(layer.getBounds());
});
</script>

<template>
  <div ref="mapEl" style="height: 500px;"></div>
</template>
```

### 原生 JavaScript

```javascript
const map = L.map('map').setView([0, 0], 5);

fetch('example.tif')
  .then(r => r.arrayBuffer())
  .then(parseGeoraster)
  .then(georaster => {
    new GeoRasterLayer({ georaster }).addTo(map);
  });
```

---

## API 参考

### 构造函数

```javascript
new GeoRasterLayer(options)
```

### 选项

| 选项 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `georaster` | GeoRaster | - | 单个 GeoRaster 对象 |
| `georasters` | GeoRaster[] | - | 多个 GeoRaster 对象数组 |
| `opacity` | number | 1 | 图层透明度（0-1） |
| `resolution` | number | 32 | 采样分辨率（建议 16-256） |
| `pixelValuesToColorFn` | Function | null | 自定义颜色映射函数 |
| `mask` | string\|GeoJSON | null | 遮罩几何体 |
| `mask_strategy` | string | "outside" | 遮罩策略："inside" 或 "outside" |
| `resampleMethod` | string | "nearest" | 重采样方法："nearest" 或 "bilinear" |
| `debugLevel` | number | 0 | 调试级别（0-5） |

### 实例方法

| 方法 | 返回值 | 描述 |
|------|--------|------|
| `addTo(map)` | this | 将图层添加到地图 |
| `remove()` | this | 从地图移除图层 |
| `getBounds()` | LatLngBounds | 获取图层边界 |
| `getMap()` | Map | 获取所属地图实例 |
| `redraw()` | this | 强制重绘图层 |
| `setOpacity(value)` | this | 设置透明度 |
| `setGeorasters(data)` | this | 动态更新栅格数据 |
| `setResolution(value)` | this | 动态更新分辨率 |
| `updateColors(fn)` | this | 更新颜色映射函数 |
| `isLoaded()` | boolean | 检查是否已加载 |
| `isLoading()` | boolean | 检查是否正在加载 |
| `getError()` | Error | 获取错误信息 |
| `forceCleanup()` | void | 强制清理残留 DOM |
| `toImageOverlay(options)` | ImageOverlay | 转换为图片叠加层 |
| `clearCache()` | this | 清除颜色缓存 |

### 事件

```javascript
layer.on('load', () => console.log('图层已加载'));
layer.on('error', (e) => console.error('加载失败:', e.error));
```

---

## 使用示例

### 自定义颜色

```javascript
const layer = new GeoRasterLayer({
  georaster,
  pixelValuesToColorFn: values => {
    const value = values[0];
    if (value < 0) return null; // 透明
    if (value < 10) return '#00ff00';
    if (value < 50) return '#ffff00';
    return '#ff0000';
  }
});
```

### 使用 chroma-js

```javascript
import chroma from 'chroma-js';

const scale = chroma.scale(['blue', 'green', 'yellow', 'red']).domain([0, 100]);

const layer = new GeoRasterLayer({
  georaster,
  pixelValuesToColorFn: values => scale(values[0]).hex()
});
```

### 气象雷达颜色

```javascript
const radarColors = values => {
  const value = values[0];
  if (value < 5) return null;
  if (value < 10) return '#00ff00';
  if (value < 20) return '#00cc00';
  if (value < 30) return '#ffff00';
  if (value < 40) return '#ff9900';
  if (value < 50) return '#ff0000';
  return '#cc00cc';
};

const layer = new GeoRasterLayer({
  georaster,
  pixelValuesToColorFn: radarColors,
  resolution: 128
});
```

### 动态切换数据

```javascript
// 切换产品
async function switchProduct(productUrl) {
  const response = await fetch(productUrl);
  const arrayBuffer = await response.arrayBuffer();
  const georaster = await parseGeoraster(arrayBuffer);
  
  layer.setGeorasters(georaster);
}

// 更新分辨率
layer.setResolution(128);
```

### 使用遮罩

```javascript
const layer = new GeoRasterLayer({
  georaster,
  mask: './china.geojson',
  mask_strategy: 'inside' // 只显示中国境内
});
```

### 转换为图片叠加层

```javascript
const overlay = layer.toImageOverlay({
  opacity: 0.8,
  zIndex: 1000
});
overlay.addTo(map);
```

---

## 图层移除问题修复

原库存在图层移除不彻底的问题。本版本已修复，提供三种方案：

### 方案一：直接移除（推荐）

```javascript
const layer = new GeoRasterLayer({ georaster }).addTo(map);
map.removeLayer(layer); // 会自动清理所有 canvas
```

### 方案二：强制清理

```javascript
layer.forceCleanup();
map.removeLayer(layer);
```

### 方案三：使用 toImageOverlay

```javascript
const overlay = layer.toImageOverlay({ opacity: 0.7 });
overlay.addTo(map);
map.removeLayer(overlay); // 100% 可靠
```

---

## 性能优化

### 1. 调整分辨率

```javascript
// 低分辨率（更快）
const layer = new GeoRasterLayer({ georaster, resolution: 16 });

// 高分辨率（更清晰）
const layer = new GeoRasterLayer({ georaster, resolution: 256 });
```

### 2. 使用颜色缓存

```javascript
// 清除缓存（当颜色函数变化时）
layer.clearCache();
```

### 3. 批量更新

```javascript
// 避免频繁调用 redraw
layer.setResolution(64); // 自动触发一次 redraw
```

---

## 故障排除

### 问题一：图层不显示

**检查清单**：
1. 确认地图已初始化
2. 确认 GeoTIFF 有有效数据
3. 检查边界是否在视图内
4. 检查 opacity 是否大于 0

```javascript
console.log('Bounds:', layer.getBounds());
console.log('Is loaded:', layer.isLoaded());
```

### 问题二：投影不支持

```bash
# 使用 GDAL 转换投影
gdalwarp -t_srs EPSG:4326 input.tif output_4326.tif
```

### 问题三：性能卡顿

```javascript
const layer = new GeoRasterLayer({
  georaster,
  resolution: 16, // 降低分辨率
  updateWhenIdle: true,
  keepBuffer: 0
});
```

### 问题四：颜色显示异常

```javascript
console.log('Min:', Math.min(...georaster.values[0].flat()));
console.log('Max:', Math.max(...georaster.values[0].flat()));
console.log('NoData:', georaster.noDataValue);
```

---

## 构建

```bash
# 安装依赖
npm install

# 构建
npm run build

# 清理
npm run clean
```

### 构建产物

- `dist/leaflet-georaster.esm.js` - ES Module 格式
- `dist/leaflet-georaster.js` - CommonJS 格式
- `dist/leaflet-georaster.min.js` - 浏览器 UMD 格式
- `dist/index.d.ts` - TypeScript 类型定义

---

## 项目结构

```
leaflet-georaster/
├── src/
│   ├── index.ts            # 主源码
│   └── types/
│       └── index.ts        # 类型定义
├── dist/                   # 构建产物
├── build.js                # 构建脚本
├── package.json
├── README.md
└── LICENSE
```

## 开发者

- [longtsing](https://github.com/longtsing)

## 相关链接

- [Leaflet](https://leafletjs.com/)
- [georaster](https://github.com/GeoTIFF/georaster)
- [GeoTIFF 格式说明](https://www.ogc.org/standard/geotiff/)

---

## License

MIT
