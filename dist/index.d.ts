export interface GeoRaster {
  getValues: (options?: any) => number[][][];
  height: number;
  width: number;
  noDataValue: number | null | undefined;
  numberOfRasters: number;
  pixelHeight: number;
  pixelWidth: number;
  projection: number;
  values: number[][][] | undefined;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

export interface GeoRasterLayerOptions {
  georaster?: GeoRaster;
  georasters?: GeoRaster[];
  resolution?: number;
  opacity?: number;
  debugLevel?: number;
  pixelValuesToColorFn?: (values: number[]) => string | null;
  bounds?: any;
  mask?: any;
  mask_strategy?: 'inside' | 'outside';
  resampleMethod?: 'nearest' | 'bilinear';
}

export declare class GeoRasterLayer {
  constructor(options: GeoRasterLayerOptions);
  addTo(map: any): this;
  remove(): this;
  getBounds(): any;
  getMap(): any;
  redraw(): this;
  setOpacity(opacity: number): this;
  setGeorasters(georasters: GeoRaster | GeoRaster[]): this;
  setResolution(resolution: number): this;
  updateColors(pixelValuesToColorFn: (values: number[]) => string | null): this;
  getTiles(): any[];
  getActiveTiles(): any[];
  isLoaded(): boolean;
  isLoading(): boolean;
  getError(): Error | undefined;
  forceCleanup(): void;
  toImageOverlay(options?: { opacity?: number; zIndex?: number }): any;
  clearCache(): this;
}

export default GeoRasterLayer;
