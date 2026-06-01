import type {
  GeoRasterLayerOptions,
  GeoRaster,
  Tile,
  DebugLevel,
  Mask,
  MaskStrategy
} from "./types/index";

import * as L from "leaflet";
import type { LatLngBounds } from "leaflet";

type Coords = { x: number; y: number; z: number };
type DoneCallback = (error?: Error | null, tile?: HTMLElement) => void;
type ParsedColor = { r: number; g: number; b: number; a: number };

const debug = (level: DebugLevel, ...args: unknown[]) => {
  if (level > 0) console.log("georaster-layer-for-leaflet", ...args);
};

const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

const getMaskBounds = async (mask: Mask, mask_srs?: string | number) => {
  if (mask === "auto") return null;
  if (typeof mask === "string") {
    const response = await fetch(mask);
    return await response.json();
  }
  return mask;
};

const DEFAULT_RESOLUTION = 32;
const DEFAULT_DEBUG_LEVEL = 0;

const COLOR_CACHE_SIZE = 1000;

class ColorCache {
  private cache: Record<string, ParsedColor> = {};
  private keys: string[] = [];
  private maxSize: number;

  constructor(maxSize = COLOR_CACHE_SIZE) {
    this.maxSize = maxSize;
  }

  get(color: string): ParsedColor | undefined {
    return this.cache[color];
  }

  set(color: string, parsed: ParsedColor): void {
    if (this.keys.length >= this.maxSize) {
      const firstKey = this.keys.shift();
      if (firstKey !== undefined) {
        delete this.cache[firstKey];
      }
    }
    this.cache[color] = parsed;
    this.keys.push(color);
  }

  clear(): void {
    this.cache = {};
    this.keys = [];
  }
}

const colorCache = new ColorCache();

const parseColor = (color: string): ParsedColor | null => {
  if (!color) return null;

  const cached = colorCache.get(color);
  if (cached) return cached;

  let result: ParsedColor | null = null;

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

const defaultColor = (value: number): string | null => {
  if (value === 0) return null;
  const normalized = clamp(Math.abs(value) / 100, 0, 1);
  const r = Math.floor(normalized * 255);
  const g = Math.floor((1 - normalized) * 255);
  return `rgb(${r},${g},0)`;
};

class GeoRasterLayer extends L.GridLayer {
  georasters: GeoRaster[];
  debugLevel: DebugLevel;
  pixelValuesToColorFn?: (values: number[]) => string | null;
  resolution: number | { [key: number]: number };
  mask?: Mask;
  mask_srs?: string | number;
  mask_strategy?: MaskStrategy;
  resampleMethod?: "bilinear" | "nearest";
  turbo?: boolean;
  caching?: boolean;
  _maskGeometry?: any;
  _tileWidth?: number;
  _tileHeight?: number;
  _loaded: boolean = false;
  _loading: boolean = false;
  _error?: Error;

  private _boundOnMapMove: () => void;

  constructor(options: GeoRasterLayerOptions) {
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

    const gridLayerOptions: any = { ...options };
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

  onAdd(map: L.Map): this {
    this._loaded = true;
    this._loading = false;

    super.onAdd(map);

    if (this.mask) {
      this._loading = true;
      getMaskBounds(this.mask, this.mask_srs)
        .then(geometry => {
          this._maskGeometry = geometry;
          this._loading = false;
          this.redraw();
          this.fire("load");
        })
        .catch(error => {
          this._loading = false;
          this._error = error;
          this.fire("error", { error });
        });
    } else {
      this.fire("load");
    }

    return this;
  }

  onRemove(map: L.Map): this {
    const container = this.getContainer();
    if (container) {
      const panes = (map as any)._panes;
      if (panes) {
        const tilePane = panes.tilePane || panes.overlayPane;
        if (tilePane) {
          const canvasElements = tilePane.querySelectorAll("canvas");
          canvasElements.forEach((canvas: HTMLCanvasElement) => {
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

    const internalTiles = (this as any)._tiles;
    if (internalTiles) {
      Object.keys(internalTiles).forEach(key => {
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

    this._maskGeometry = undefined;
    this._loaded = false;

    super.onRemove(map);
    return this;
  }

  private _onMapMove() {
    debug(this.debugLevel, "map moved");
  }

  createTile(coords: Coords, done: DoneCallback): HTMLElement {
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

  private _renderTile(tile: HTMLCanvasElement, ctx: CanvasRenderingContext2D, coords: Coords, done: DoneCallback) {
    try {
      const map = this._map as L.Map | undefined;
      if (!map) {
        done(undefined);
        return;
      }

      const georaster = this.georasters[0];
      if (!georaster || !georaster.values) {
        done(undefined);
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
        done(undefined);
        return;
      }

      const georasterBounds: LatLngBounds = L.latLngBounds(
        [georaster.ymin, georaster.xmin],
        [georaster.ymax, georaster.xmax]
      );

      const tileBounds = L.latLngBounds([se.lat, nw.lng], [nw.lat, se.lng]);

      if (!georasterBounds.intersects(tileBounds)) {
        done(undefined);
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

        if (rasterY < 0 || rasterY >= height) continue;

        const screenY = Math.floor(row * screenStepY);
        const blockH = Math.min(Math.ceil(screenStepY), tileSize.y - screenY);

        for (let col = 0; col < samplesAcross; col++) {
          const lng = nw.lng + col * lngStep;
          const rasterX = Math.floor((lng - georaster.xmin) * xScale);

          if (rasterX < 0 || rasterX >= width) continue;

          const value = band[rasterY][rasterX];

          if (!Number.isFinite(value) || value === georaster.noDataValue) continue;

          const color = this.pixelValuesToColorFn
            ? this.pixelValuesToColorFn([value])
            : defaultColor(value);

          if (!color) continue;

          const parsed = parseColor(color);
          if (!parsed) continue;

          const abgr = (parsed.a << 24) | (parsed.b << 16) | (parsed.g << 8) | parsed.r;

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
      done(undefined);
    } catch (error) {
      done(error as Error);
    }
  }

  getBounds(): LatLngBounds {
    const georaster = this.georasters[0];
    if (!georaster) {
      throw new Error("No georasters available");
    }
    return L.latLngBounds([georaster.ymin, georaster.xmin], [georaster.ymax, georaster.xmax]);
  }

  getMap(): L.Map | undefined {
    return this._map as L.Map | undefined;
  }

  getProjectionString(projection: number): string {
    return `EPSG:${projection}`;
  }

  isSupportedProjection(): boolean {
    const georaster = this.georasters[0];
    if (!georaster) return false;
    const supported = [4326, 3857, 4269, 32633];
    return supported.includes(georaster.projection);
  }

  updateColors(pixelValuesToColorFn: (values: number[]) => string | null, options?: { debugLevel?: number }): this {
    this.pixelValuesToColorFn = pixelValuesToColorFn;
    const level = (options?.debugLevel ?? this.debugLevel) as DebugLevel;
    debug(level, "updateColors called");
    this.redraw();
    return this;
  }

  getTiles(): Tile[] {
    const internalTiles = (this as any)._tiles;
    if (!internalTiles) return [];
    return Object.values(internalTiles) as Tile[];
  }

  getActiveTiles(): Tile[] {
    return this.getTiles().filter(tile => tile.active !== false && tile.current);
  }

  getColor(values: number[]): string | undefined {
    if (this.pixelValuesToColorFn) {
      const color = this.pixelValuesToColorFn(values);
      return color ?? undefined;
    }
    return defaultColor(values[0]) ?? undefined;
  }

  forceCleanup() {
    const container = this.getContainer();
    if (container) {
      const canvases = container.querySelectorAll("canvas");
      canvases.forEach((canvas: HTMLCanvasElement) => {
        canvas.width = 0;
        canvas.height = 0;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      });
      container.innerHTML = "";
    }

    const tiles = (this as any)._tiles;
    if (tiles) {
      Object.keys(tiles).forEach(key => {
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

  toImageOverlay(options?: { opacity?: number; zIndex?: number; className?: string }): L.ImageOverlay {
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
          const color = this.pixelValuesToColorFn
            ? this.pixelValuesToColorFn([value])
            : defaultColor(value);

          if (color) {
            const parsed = parseColor(color);
            if (parsed) {
              pixels[row * width + col] = (parsed.a << 24) | (parsed.b << 16) | (parsed.g << 8) | parsed.r;
            }
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    const dataUrl = canvas.toDataURL();

    const bounds: [[number, number], [number, number]] = [
      [georaster.ymin, georaster.xmin],
      [georaster.ymax, georaster.xmax]
    ];

    const overlayOptions: any = {
      opacity: options?.opacity ?? 1,
      zIndex: options?.zIndex ?? 1000
    };
    if (options?.className) {
      overlayOptions.className = options.className;
    }

    return L.imageOverlay(dataUrl, bounds, overlayOptions);
  }

  setGeorasters(georasters: GeoRaster | GeoRaster[]): this {
    this.georasters = Array.isArray(georasters) ? georasters : [georasters];
    this.redraw();
    return this;
  }

  setResolution(resolution: number): this {
    this.resolution = resolution;
    this.redraw();
    return this;
  }

  isLoaded(): boolean {
    return this._loaded;
  }

  isLoading(): boolean {
    return this._loading;
  }

  getError(): Error | undefined {
    return this._error;
  }

  clearCache(): this {
    colorCache.clear();
    return this;
  }
}

export default GeoRasterLayer;

if (typeof window !== "undefined") {
  (window as any).GeoRasterLayer = GeoRasterLayer;
}
