const esbuild = require('esbuild');
const fs = require('fs');

async function build() {
  // Clean dist
  if (fs.existsSync('./dist')) {
    fs.rmSync('./dist', { recursive: true });
  }
  fs.mkdirSync('./dist', { recursive: true });

  // Build ESM
  await esbuild.build({
    entryPoints: ['./src/georaster-layer-for-leaflet.ts'],
    bundle: true,
    format: 'esm',
    outfile: './dist/leaflet-georaster.esm.js',
    external: ['leaflet', 'georaster'],
    sourcemap: true,
    minify: false,
  });

  // Build CJS
  await esbuild.build({
    entryPoints: ['./src/georaster-layer-for-leaflet.ts'],
    bundle: true,
    format: 'cjs',
    outfile: './dist/leaflet-georaster.js',
    external: ['leaflet', 'georaster'],
    sourcemap: true,
    minify: false,
  });

  // Build UMD (for browser)
  await esbuild.build({
    entryPoints: ['./src/georaster-layer-for-leaflet.ts'],
    bundle: true,
    format: 'iife',
    outfile: './dist/leaflet-georaster.min.js',
    globalName: 'L.Georaster',
    external: ['leaflet'],
    sourcemap: true,
    minify: true,
  });

  // Generate types
  generateTypes();

  console.log('Build complete!');
  console.log('Generated:');
  console.log('  - dist/leaflet-georaster.esm.js (ES Module)');
  console.log('  - dist/leaflet-georaster.js (CommonJS)');
  console.log('  - dist/leaflet-georaster.min.js (Browser UMD)');
  console.log('  - dist/index.d.ts (TypeScript types)');
}

function generateTypes() {
  const typeContent = `export interface GeoRaster {
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
`;

  fs.writeFileSync('./dist/index.d.ts', typeContent);
  console.log('  - dist/index.d.ts (Types generated)');
}

build().catch(console.error);
