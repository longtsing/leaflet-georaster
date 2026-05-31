var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/georaster-layer-for-leaflet.ts
var georaster_layer_for_leaflet_exports = {};
__export(georaster_layer_for_leaflet_exports, {
  default: () => georaster_layer_for_leaflet_default
});
module.exports = __toCommonJS(georaster_layer_for_leaflet_exports);
var L = __toESM(require("leaflet"));
var debug = (level, ...args) => {
  if (level > 0)
    console.log("georaster-layer-for-leaflet", ...args);
};
var clamp = (val, min, max) => Math.max(min, Math.min(max, val));
var getMaskBounds = async (mask, mask_srs) => {
  if (mask === "auto")
    return null;
  if (typeof mask === "string") {
    const response = await fetch(mask);
    return await response.json();
  }
  return mask;
};
var DEFAULT_RESOLUTION = 32;
var DEFAULT_DEBUG_LEVEL = 0;
var COLOR_CACHE_SIZE = 1e3;
var ColorCache = class {
  cache = {};
  keys = [];
  maxSize;
  constructor(maxSize = COLOR_CACHE_SIZE) {
    this.maxSize = maxSize;
  }
  get(color) {
    return this.cache[color];
  }
  set(color, parsed) {
    if (this.keys.length >= this.maxSize) {
      const firstKey = this.keys.shift();
      if (firstKey !== void 0) {
        delete this.cache[firstKey];
      }
    }
    this.cache[color] = parsed;
    this.keys.push(color);
  }
  clear() {
    this.cache = {};
    this.keys = [];
  }
};
var colorCache = new ColorCache();
var parseColor = (color) => {
  if (!color)
    return null;
  const cached = colorCache.get(color);
  if (cached)
    return cached;
  let result = null;
  const hexMatch = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i);
  if (hexMatch) {
    result = {
      r: parseInt(hexMatch[1], 16),
      g: parseInt(hexMatch[2], 16),
      b: parseInt(hexMatch[3], 16),
      a: hexMatch[4] ? parseInt(hexMatch[4], 16) : 255
    };
  }
  if (!result) {
    const rgbMatch = color.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
    if (rgbMatch) {
      result = {
        r: parseInt(rgbMatch[1]),
        g: parseInt(rgbMatch[2]),
        b: parseInt(rgbMatch[3]),
        a: rgbMatch[4] ? Math.floor(parseFloat(rgbMatch[4]) * 255) : 255
      };
    }
  }
  if (!result) {
    result = { r: 0, g: 0, b: 0, a: 255 };
  }
  colorCache.set(color, result);
  return result;
};
var defaultColor = (value) => {
  if (value === 0)
    return null;
  const normalized = clamp(Math.abs(value) / 100, 0, 1);
  const r = Math.floor(normalized * 255);
  const g = Math.floor((1 - normalized) * 255);
  return `rgb(${r},${g},0)`;
};
var GeoRasterLayer = class extends L.GridLayer {
  georasters;
  debugLevel;
  pixelValuesToColorFn;
  resolution;
  mask;
  mask_srs;
  mask_strategy;
  resampleMethod;
  turbo;
  caching;
  _maskGeometry;
  _tileWidth;
  _tileHeight;
  _loaded = false;
  _loading = false;
  _error;
  _boundOnMapMove;
  constructor(options) {
    const georasters = options.georasters || (options.georaster ? [options.georaster] : []);
    const resolution = options.resolution ?? DEFAULT_RESOLUTION;
    const debugLevel = options.debugLevel ?? DEFAULT_DEBUG_LEVEL;
    if (!georasters || georasters.length === 0) {
      throw new Error("georaster-layer-for-leaflet: You must provide a georaster or georasters option.");
    }
    georasters.forEach((georaster, i) => {
      if (!georaster) {
        throw new Error(`georaster-layer-for-leaflet: Invalid georaster at index ${i}`);
      }
    });
    const gridLayerOptions = { ...options };
    delete gridLayerOptions.georaster;
    delete gridLayerOptions.georasters;
    delete gridLayerOptions.debugLevel;
    delete gridLayerOptions.pixelValuesToColorFn;
    delete gridLayerOptions.resolution;
    delete gridLayerOptions.mask;
    delete gridLayerOptions.mask_srs;
    delete gridLayerOptions.mask_strategy;
    delete gridLayerOptions.resampleMethod;
    delete gridLayerOptions.turbo;
    delete gridLayerOptions.caching;
    super(gridLayerOptions);
    this.georasters = georasters;
    this.debugLevel = debugLevel;
    this.pixelValuesToColorFn = options.pixelValuesToColorFn;
    this.resolution = resolution;
    this.mask = options.mask;
    this.mask_srs = options.mask_srs;
    this.mask_strategy = options.mask_strategy;
    this.resampleMethod = options.resampleMethod;
    this.turbo = options.turbo;
    this.caching = options.caching;
    this._boundOnMapMove = this._onMapMove.bind(this);
    debug(debugLevel, "constructor called with", georasters.length, "georasters");
  }
  onAdd(map) {
    this._loaded = true;
    this._loading = false;
    super.onAdd(map);
    if (this.mask) {
      this._loading = true;
      getMaskBounds(this.mask, this.mask_srs).then((geometry) => {
        this._maskGeometry = geometry;
        this._loading = false;
        this.redraw();
        this.fire("load");
      }).catch((error) => {
        this._loading = false;
        this._error = error;
        this.fire("error", { error });
      });
    } else {
      this.fire("load");
    }
    return this;
  }
  onRemove(map) {
    const container = this.getContainer();
    if (container) {
      const panes = map._panes;
      if (panes) {
        const tilePane = panes.tilePane || panes.overlayPane;
        if (tilePane) {
          const canvasElements = tilePane.querySelectorAll("canvas");
          canvasElements.forEach((canvas) => {
            if (canvas.parentElement === container || container.contains(canvas)) {
              canvas.width = 0;
              canvas.height = 0;
              canvas.getContext("2d")?.clearRect(0, 0, 0, 0);
            }
          });
        }
      }
      container.innerHTML = "";
    }
    const internalTiles = this._tiles;
    if (internalTiles) {
      Object.keys(internalTiles).forEach((key) => {
        const tile = internalTiles[key];
        if (tile && tile.el) {
          if (tile.el instanceof HTMLCanvasElement) {
            tile.el.width = 0;
            tile.el.height = 0;
            tile.el.getContext("2d")?.clearRect(0, 0, 0, 0);
          }
          if (tile.el.parentNode) {
            tile.el.parentNode.removeChild(tile.el);
          }
        }
        delete internalTiles[key];
      });
    }
    this._maskGeometry = void 0;
    this._loaded = false;
    super.onRemove(map);
    return this;
  }
  _onMapMove() {
    debug(this.debugLevel, "map moved");
  }
  createTile(coords, done) {
    const tile = document.createElement("canvas");
    const tileSize = this.getTileSize();
    tile.width = tileSize.x;
    tile.height = tileSize.y;
    tile.style.width = tileSize.x + "px";
    tile.style.height = tileSize.y + "px";
    const ctx = tile.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      done(new Error("Failed to get 2d context"));
      return tile;
    }
    this._renderTile(tile, ctx, coords, done);
    return tile;
  }
  _renderTile(tile, ctx, coords, done) {
    try {
      const map = this._map;
      if (!map) {
        done(void 0);
        return;
      }
      const georaster = this.georasters[0];
      if (!georaster || !georaster.values) {
        done(void 0);
        return;
      }
      const { width, height, values } = georaster;
      const band = values[0];
      const resolution = typeof this.resolution === "number" ? this.resolution : DEFAULT_RESOLUTION;
      const tileSize = this.getTileSize();
      const nwPoint = new L.Point(coords.x * tileSize.x, coords.y * tileSize.y);
      const sePoint = new L.Point(nwPoint.x + tileSize.x, nwPoint.y + tileSize.y);
      const crs = map.options.crs || L.CRS.EPSG3857;
      const nw = crs.pointToLatLng(nwPoint, coords.z);
      const se = crs.pointToLatLng(sePoint, coords.z);
      if (!nw || !se) {
        done(void 0);
        return;
      }
      const georasterBounds = L.latLngBounds(
        [georaster.ymin, georaster.xmin],
        [georaster.ymax, georaster.xmax]
      );
      const tileBounds = L.latLngBounds([se.lat, nw.lng], [nw.lat, se.lng]);
      if (!georasterBounds.intersects(tileBounds)) {
        done(void 0);
        return;
      }
      const samplesAcross = resolution;
      const samplesDown = resolution;
      const imgData = ctx.createImageData(tileSize.x, tileSize.y);
      const pixels = new Uint32Array(imgData.data.buffer);
      const lngStep = (se.lng - nw.lng) / samplesAcross;
      const latStep = (nw.lat - se.lat) / samplesDown;
      const xScale = width / (georaster.xmax - georaster.xmin);
      const yScale = height / (georaster.ymax - georaster.ymin);
      const screenStepX = tileSize.x / samplesAcross;
      const screenStepY = tileSize.y / samplesDown;
      for (let row = 0; row < samplesDown; row++) {
        const lat = nw.lat - row * latStep;
        const rasterY = Math.floor((georaster.ymax - lat) * yScale);
        if (rasterY < 0 || rasterY >= height)
          continue;
        const screenY = Math.floor(row * screenStepY);
        const blockH = Math.min(Math.ceil(screenStepY), tileSize.y - screenY);
        for (let col = 0; col < samplesAcross; col++) {
          const lng = nw.lng + col * lngStep;
          const rasterX = Math.floor((lng - georaster.xmin) * xScale);
          if (rasterX < 0 || rasterX >= width)
            continue;
          const value = band[rasterY][rasterX];
          if (!Number.isFinite(value) || value === georaster.noDataValue)
            continue;
          const color = this.pixelValuesToColorFn ? this.pixelValuesToColorFn([value]) : defaultColor(value);
          if (!color)
            continue;
          const parsed = parseColor(color);
          if (!parsed)
            continue;
          const abgr = parsed.a << 24 | parsed.b << 16 | parsed.g << 8 | parsed.r;
          const screenX = Math.floor(col * screenStepX);
          const blockW = Math.min(Math.ceil(screenStepX), tileSize.x - screenX);
          for (let dy = 0; dy < blockH; dy++) {
            const py = screenY + dy;
            const rowOffset = py * tileSize.x;
            for (let dx = 0; dx < blockW; dx++) {
              pixels[rowOffset + screenX + dx] = abgr;
            }
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
      done(void 0);
    } catch (error) {
      done(error);
    }
  }
  getBounds() {
    const georaster = this.georasters[0];
    if (!georaster) {
      throw new Error("No georasters available");
    }
    return L.latLngBounds([georaster.ymin, georaster.xmin], [georaster.ymax, georaster.xmax]);
  }
  getMap() {
    return this._map;
  }
  getProjectionString(projection) {
    return `EPSG:${projection}`;
  }
  isSupportedProjection() {
    const georaster = this.georasters[0];
    if (!georaster)
      return false;
    const supported = [4326, 3857, 4269, 32633];
    return supported.includes(georaster.projection);
  }
  updateColors(pixelValuesToColorFn, options) {
    this.pixelValuesToColorFn = pixelValuesToColorFn;
    const level = options?.debugLevel ?? this.debugLevel;
    debug(level, "updateColors called");
    this.redraw();
    return this;
  }
  getTiles() {
    const internalTiles = this._tiles;
    if (!internalTiles)
      return [];
    return Object.values(internalTiles);
  }
  getActiveTiles() {
    return this.getTiles().filter((tile) => tile.active !== false && tile.current);
  }
  getColor(values) {
    if (this.pixelValuesToColorFn) {
      const color = this.pixelValuesToColorFn(values);
      return color ?? void 0;
    }
    return defaultColor(values[0]) ?? void 0;
  }
  forceCleanup() {
    const container = this.getContainer();
    if (container) {
      const canvases = container.querySelectorAll("canvas");
      canvases.forEach((canvas) => {
        canvas.width = 0;
        canvas.height = 0;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      });
      container.innerHTML = "";
    }
    const tiles = this._tiles;
    if (tiles) {
      Object.keys(tiles).forEach((key) => {
        const tile = tiles[key];
        if (tile?.el) {
          if (tile.el instanceof HTMLCanvasElement) {
            tile.el.width = 0;
            tile.el.height = 0;
          }
          if (tile.el.parentNode) {
            tile.el.parentNode.removeChild(tile.el);
          }
        }
        delete tiles[key];
      });
    }
  }
  toImageOverlay(options) {
    const georaster = this.georasters[0];
    if (!georaster || !georaster.values) {
      throw new Error("No georaster data available");
    }
    const { width, height, values } = georaster;
    const band = values[0];
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Failed to create canvas context");
    }
    const imgData = ctx.createImageData(width, height);
    const pixels = new Uint32Array(imgData.data.buffer);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const value = band[row][col];
        if (Number.isFinite(value) && value !== georaster.noDataValue) {
          const color = this.pixelValuesToColorFn ? this.pixelValuesToColorFn([value]) : defaultColor(value);
          if (color) {
            const parsed = parseColor(color);
            if (parsed) {
              pixels[row * width + col] = parsed.a << 24 | parsed.b << 16 | parsed.g << 8 | parsed.r;
            }
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
    const dataUrl = canvas.toDataURL();
    const bounds = [
      [georaster.ymin, georaster.xmin],
      [georaster.ymax, georaster.xmax]
    ];
    const overlayOptions = {
      opacity: options?.opacity ?? 1,
      zIndex: options?.zIndex ?? 1e3
    };
    if (options?.className) {
      overlayOptions.className = options.className;
    }
    return L.imageOverlay(dataUrl, bounds, overlayOptions);
  }
  setGeorasters(georasters) {
    this.georasters = Array.isArray(georasters) ? georasters : [georasters];
    this.redraw();
    return this;
  }
  setResolution(resolution) {
    this.resolution = resolution;
    this.redraw();
    return this;
  }
  isLoaded() {
    return this._loaded;
  }
  isLoading() {
    return this._loading;
  }
  getError() {
    return this._error;
  }
  clearCache() {
    colorCache.clear();
    return this;
  }
};
var georaster_layer_for_leaflet_default = GeoRasterLayer;
if (typeof window !== "undefined") {
  window.GeoRasterLayer = GeoRasterLayer;
}
//# sourceMappingURL=leaflet-georaster.js.map
