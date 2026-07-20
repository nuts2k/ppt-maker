// 自动字形 mask 的纯像素算法（无 sharp / IO 依赖，确定性可单测）。
// sharp 只负责解码/编码/合成；本模块在 RGBA raw buffer 上做：
// 区域限制、颜色/亮度分割、边缘增强、连通域标注、受控膨胀、多边形排除。
// 说明：glyphHints 是定位提示先验，不作为精确字形轮廓；本算法仅用块级 bbox/quad 限制范围。

export interface RgbaImage {
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface BoundingBoxPx {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BlockSegmentationParams {
  readonly bbox: BoundingBoxPx;
  readonly quad: readonly Point[] | null;
  readonly foregroundColors: readonly (readonly [number, number, number])[];
  readonly colorTolerance: number;
  readonly edgeThreshold: number;
  readonly minComponentAreaPx: number;
  readonly dilationRadiusPx: number;
  readonly excludePolygons: readonly (readonly Point[])[];
  // Vision 逐字符/子串定位提示（来自 OCR 产物）。作为软先验收窄搜索范围，
  // 每个 quad 适度外扩以容忍不精确；为空或缺省时不影响分割（降级到 bbox/quad）。
  readonly glyphHintQuads?: readonly (readonly Point[])[];
  readonly glyphHintMarginPx?: number;
}

// glyphHints 是 UI 级提示而非精确字形，默认外扩 6px 容忍定位误差。
// 该常量属于算法语义：改动时必须同步 bump MASK_ALGORITHM_VERSION 以失效下游产物。
export const DEFAULT_GLYPH_HINT_MARGIN_PX = 6;

export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([a-f0-9]{6})$/iu.exec(hex.trim());
  if (match === null) {
    throw new Error(`非法颜色值：${hex}`);
  }
  const value = Number.parseInt(match[1] ?? "0", 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function colorDistanceSq(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number,
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

// 射线法判断点是否落在多边形内（含边界视为内部的近似）。
export function pointInPolygon(
  x: number,
  y: number,
  polygon: readonly Point[],
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) {
      continue;
    }
    const intersect =
      a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}

// 生成允许搜索区域掩码：有 quad 用多边形栅格化，否则用 bbox 矩形。
export function rasterizeRegion(
  width: number,
  height: number,
  bbox: BoundingBoxPx,
  quad: readonly Point[] | null,
): Uint8Array {
  const region = new Uint8Array(width * height);
  const minX = Math.max(0, Math.floor(bbox.x));
  const minY = Math.max(0, Math.floor(bbox.y));
  const maxX = Math.min(width, Math.ceil(bbox.x + bbox.width));
  const maxY = Math.min(height, Math.ceil(bbox.y + bbox.height));
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      if (quad === null || pointInPolygon(x + 0.5, y + 0.5, quad)) {
        region[y * width + x] = 1;
      }
    }
  }
  return region;
}

// 区域内出现最频繁的量化颜色，作为背景色估计（前景颜色缺省时使用）。
export function estimateBackgroundColor(
  image: RgbaImage,
  region: Uint8Array,
): [number, number, number] {
  const histogram = new Map<number, number>();
  const { data, width, height } = image;
  for (let i = 0; i < width * height; i += 1) {
    if (region[i] === 0) {
      continue;
    }
    const offset = i * 4;
    const key =
      (((data[offset] ?? 0) >> 4) << 8) |
      (((data[offset + 1] ?? 0) >> 4) << 4) |
      ((data[offset + 2] ?? 0) >> 4);
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  let bestKey = 0;
  let bestCount = -1;
  for (const [key, count] of histogram) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  const r = ((bestKey >> 8) & 0xf) * 16 + 8;
  const g = ((bestKey >> 4) & 0xf) * 16 + 8;
  const b = (bestKey & 0xf) * 16 + 8;
  return [r, g, b];
}

// 颜色/亮度分割：命中前景颜色候选（容差内）即前景；无候选时以背景色差为前景。
export function buildForegroundMask(
  image: RgbaImage,
  region: Uint8Array,
  foregroundColors: readonly (readonly [number, number, number])[],
  colorTolerance: number,
): Uint8Array {
  const { data, width, height } = image;
  const mask = new Uint8Array(width * height);
  const toleranceSq = colorTolerance * colorTolerance;
  const background =
    foregroundColors.length === 0
      ? estimateBackgroundColor(image, region)
      : null;
  for (let i = 0; i < width * height; i += 1) {
    if (region[i] === 0) {
      continue;
    }
    const offset = i * 4;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    if (background !== null) {
      if (
        colorDistanceSq(r, g, b, background[0], background[1], background[2]) >
        toleranceSq
      ) {
        mask[i] = 1;
      }
      continue;
    }
    for (const [cr, cg, cb] of foregroundColors) {
      if (colorDistanceSq(r, g, b, cr, cg, cb) <= toleranceSq) {
        mask[i] = 1;
        break;
      }
    }
  }
  return mask;
}

function toGrayscale(image: RgbaImage): Float32Array {
  const { data, width, height } = image;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    gray[i] =
      0.299 * (data[offset] ?? 0) +
      0.587 * (data[offset + 1] ?? 0) +
      0.114 * (data[offset + 2] ?? 0);
  }
  return gray;
}

// Sobel 梯度幅值归一化到 [0,1]，>= 阈值视为边缘。
export function sobelEdgeMask(
  image: RgbaImage,
  region: Uint8Array,
  threshold01: number,
): Uint8Array {
  const { width, height } = image;
  const gray = toGrayscale(image);
  const mask = new Uint8Array(width * height);
  const maxMagnitude = 4 * 255 * Math.SQRT2;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      if (region[i] === 0) {
        continue;
      }
      const tl = gray[i - width - 1] ?? 0;
      const tc = gray[i - width] ?? 0;
      const tr = gray[i - width + 1] ?? 0;
      const ml = gray[i - 1] ?? 0;
      const mr = gray[i + 1] ?? 0;
      const bl = gray[i + width - 1] ?? 0;
      const bc = gray[i + width] ?? 0;
      const br = gray[i + width + 1] ?? 0;
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const magnitude = Math.sqrt(gx * gx + gy * gy) / maxMagnitude;
      if (magnitude >= threshold01) {
        mask[i] = 1;
      }
    }
  }
  return mask;
}

interface ConnectedComponents {
  readonly labels: Int32Array;
  readonly sizes: readonly number[];
  readonly count: number;
}

// 8 连通域标注（union-find 两遍法）。
export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): ConnectedComponents {
  const parent = new Int32Array(width * height).fill(-1);
  const find = (node: number): number => {
    let root = node;
    while (parent[root] !== root) {
      root = parent[root] ?? root;
    }
    let current = node;
    while (parent[current] !== root) {
      const next = parent[current] ?? root;
      parent[current] = root;
      current = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
    }
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (mask[i] === 0) {
        continue;
      }
      parent[i] = i;
      for (const [dx, dy] of [
        [-1, 0],
        [-1, -1],
        [0, -1],
        [1, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }
        const ni = ny * width + nx;
        if (mask[ni] === 1) {
          union(i, ni);
        }
      }
    }
  }

  const labels = new Int32Array(width * height).fill(-1);
  const sizeByRoot = new Map<number, number>();
  for (let i = 0; i < width * height; i += 1) {
    if (mask[i] === 0) {
      continue;
    }
    const root = find(i);
    labels[i] = root;
    sizeByRoot.set(root, (sizeByRoot.get(root) ?? 0) + 1);
  }
  return {
    labels,
    sizes: [...sizeByRoot.values()],
    count: sizeByRoot.size,
  };
}

// 剔除面积小于阈值的连通域。
export function filterSmallComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minAreaPx: number,
): Uint8Array {
  if (minAreaPx <= 1) {
    return mask.slice();
  }
  const { labels } = connectedComponents(mask, width, height);
  const sizeByRoot = new Map<number, number>();
  for (let i = 0; i < labels.length; i += 1) {
    const root = labels[i] ?? -1;
    if (root >= 0) {
      sizeByRoot.set(root, (sizeByRoot.get(root) ?? 0) + 1);
    }
  }
  const result = new Uint8Array(width * height);
  for (let i = 0; i < labels.length; i += 1) {
    const root = labels[i] ?? -1;
    if (root >= 0 && (sizeByRoot.get(root) ?? 0) >= minAreaPx) {
      result[i] = 1;
    }
  }
  return result;
}

// 欧氏圆盘结构元的受控膨胀，覆盖描边/阴影/抗锯齿边缘。
export function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) {
    return mask.slice();
  }
  const r = Math.round(radius);
  const offsets: Array<[number, number]> = [];
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy <= radius * radius) {
        offsets.push([dx, dy]);
      }
    }
  }
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] === 0) {
        continue;
      }
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
          result[ny * width + nx] = 1;
        }
      }
    }
  }
  return result;
}

function applyExcludePolygons(
  mask: Uint8Array,
  width: number,
  height: number,
  bbox: BoundingBoxPx,
  excludePolygons: readonly (readonly Point[])[],
): void {
  if (excludePolygons.length === 0) {
    return;
  }
  const minX = Math.max(0, Math.floor(bbox.x));
  const minY = Math.max(0, Math.floor(bbox.y));
  const maxX = Math.min(width, Math.ceil(bbox.x + bbox.width));
  const maxY = Math.min(height, Math.ceil(bbox.y + bbox.height));
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const i = y * width + x;
      if (mask[i] === 0) {
        continue;
      }
      for (const polygon of excludePolygons) {
        if (pointInPolygon(x + 0.5, y + 0.5, polygon)) {
          mask[i] = 0;
          break;
        }
      }
    }
  }
}

// glyphHints 软先验：并集栅格化各提示四边形并外扩容错，作为收窄搜索范围的区域。
export function rasterizeGlyphHintRegion(
  width: number,
  height: number,
  quads: readonly (readonly Point[])[],
  marginPx: number,
): Uint8Array {
  const base = new Uint8Array(width * height);
  for (const quad of quads) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of quad) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const x0 = Math.max(0, Math.floor(minX));
    const y0 = Math.max(0, Math.floor(minY));
    const x1 = Math.min(width, Math.ceil(maxX));
    const y1 = Math.min(height, Math.ceil(maxY));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (pointInPolygon(x + 0.5, y + 0.5, quad)) {
          base[y * width + x] = 1;
        }
      }
    }
  }
  return dilate(base, width, height, marginPx);
}

// 单块字形分割：区域限制(+glyphHints 软先验) → 颜色分割(+边缘增强) → 排除多边形 → 连通域过滤 → 受控膨胀 → 再排除。
export function segmentBlockGlyphs(
  image: RgbaImage,
  params: BlockSegmentationParams,
): Uint8Array {
  const { width, height } = image;
  const region = rasterizeRegion(width, height, params.bbox, params.quad);
  // glyphHints 存在时用其外扩并集与区域求交，收窄到字形附近；为空则区域不变（降级路径）。
  if (params.glyphHintQuads !== undefined && params.glyphHintQuads.length > 0) {
    const hintRegion = rasterizeGlyphHintRegion(
      width,
      height,
      params.glyphHintQuads,
      params.glyphHintMarginPx ?? DEFAULT_GLYPH_HINT_MARGIN_PX,
    );
    for (let i = 0; i < region.length; i += 1) {
      if (hintRegion[i] === 0) {
        region[i] = 0;
      }
    }
  }
  const colorMask = buildForegroundMask(
    image,
    region,
    params.foregroundColors,
    params.colorTolerance,
  );

  // 边缘增强：区域内高梯度且与颜色前景 8 邻接的像素纳入，覆盖抗锯齿边界。
  if (params.edgeThreshold < 1) {
    const edges = sobelEdgeMask(image, region, params.edgeThreshold);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (edges[i] === 0 || colorMask[i] === 1) {
          continue;
        }
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            nx >= 0 &&
            ny >= 0 &&
            nx < width &&
            ny < height &&
            colorMask[ny * width + nx] === 1
          ) {
            colorMask[i] = 1;
            break;
          }
        }
      }
    }
  }

  applyExcludePolygons(
    colorMask,
    width,
    height,
    params.bbox,
    params.excludePolygons,
  );
  const filtered = filterSmallComponents(
    colorMask,
    width,
    height,
    params.minComponentAreaPx,
  );
  const dilated = dilate(filtered, width, height, params.dilationRadiusPx);
  applyExcludePolygons(
    dilated,
    width,
    height,
    params.bbox,
    params.excludePolygons,
  );
  return dilated;
}

export function countMasked(mask: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] === 1) {
      count += 1;
    }
  }
  return count;
}

export function unionInto(target: Uint8Array, source: Uint8Array): void {
  for (let i = 0; i < target.length; i += 1) {
    if (source[i] === 1) {
      target[i] = 1;
    }
  }
}
