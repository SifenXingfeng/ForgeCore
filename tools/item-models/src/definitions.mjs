import {
  MeshBuilder,
  addBox,
  addCylinder,
  addFrustum,
  addSphere,
  addTorus,
  addAnnularCylinder,
  addExtrudedRing,
  addTubePath,
  addRevolved,
  addIrregularRock,
} from './geometry.mjs';

const TAU = Math.PI * 2;

/**
 * The official low-poly material presets.  Values are glTF/PBR-ready and the
 * stable keys are also used as primitive material-slot identifiers.
 */
export const MATERIAL_LIBRARY = Object.freeze({
  neutral: material('neutral', '中性灰', 'Neutral Gray', [0.46, 0.49, 0.52, 1], 0.15, 0.64),
  steel: material('steel', '工业钢', 'Industrial Steel', [0.42, 0.46, 0.49, 1], 0.86, 0.32),
  dark_steel: material('dark_steel', '深色钢', 'Dark Steel', [0.17, 0.19, 0.21, 1], 0.82, 0.38),
  aluminum: material('aluminum', '铝合金', 'Aluminum', [0.72, 0.75, 0.78, 1], 0.78, 0.28),
  copper: material('copper', '铜', 'Copper', [0.64, 0.30, 0.12, 1], 0.88, 0.31),
  rubber: material('rubber', '橡胶', 'Rubber', [0.055, 0.062, 0.068, 1], 0.02, 0.86),
  wood: material('wood', '木材', 'Wood', [0.48, 0.28, 0.12, 1], 0.0, 0.76),
  cardboard: material('cardboard', '瓦楞纸板', 'Cardboard', [0.58, 0.41, 0.22, 1], 0.0, 0.82),
  fabric: material('fabric', '编织布', 'Woven Fabric', [0.67, 0.58, 0.40, 1], 0.0, 0.92),
  plastic_blue: material('plastic_blue', '工业蓝塑料', 'Industrial Blue Plastic', [0.055, 0.24, 0.46, 1], 0.04, 0.48),
  plastic_gray: material('plastic_gray', '工业灰塑料', 'Industrial Gray Plastic', [0.30, 0.34, 0.38, 1], 0.03, 0.52),
  plastic_red: material('plastic_red', '警示红塑料', 'Safety Red Plastic', [0.62, 0.055, 0.035, 1], 0.03, 0.48),
  safety_yellow: material('safety_yellow', '安全黄', 'Safety Yellow', [0.92, 0.58, 0.025, 1], 0.08, 0.42),
  pcb_green: material('pcb_green', 'PCB 阻焊绿', 'PCB Green', [0.018, 0.24, 0.10, 1], 0.08, 0.44),
  component_black: material('component_black', '元件黑', 'Component Black', [0.018, 0.022, 0.026, 1], 0.18, 0.42),
  glass: Object.freeze({
    ...material('glass', '玻璃', 'Glass', [0.60, 0.82, 0.88, 0.34], 0.02, 0.12),
    alphaMode: 'BLEND',
    doubleSided: true,
  }),
});

function material(id, nameZh, nameEn, baseColorFactor, metallicFactor, roughnessFactor) {
  return Object.freeze({
    id,
    name: nameZh,
    nameZh,
    nameEn,
    baseColorFactor,
    metallicFactor,
    roughnessFactor,
  });
}

function parameter(type, defaultValue, config = {}) {
  return Object.freeze({
    type,
    default: defaultValue,
    min: config.min ?? null,
    max: config.max ?? null,
    step: config.step ?? null,
    unit: config.unit ?? null,
    options: config.options ?? null,
    affects: Object.freeze([...(config.affects ?? ['geometry'])]),
    activeWhen: config.activeWhen ? Object.freeze({ ...config.activeWhen }) : null,
  });
}

const dimension = (value, min, max, step = 0.01) =>
  parameter('number', value, { min, max, step, unit: 'm', affects: ['geometry', 'bounds'] });
const ratio = (value, min = 0, max = 1, step = 0.01, affects = ['geometry']) =>
  parameter('number', value, { min, max, step, unit: 'ratio', affects });
const count = (value, min, max, step = 1) =>
  parameter('integer', value, { min, max, step, unit: 'count', affects: ['geometry', 'topology'] });
const choice = (value, options, affects = ['geometry', 'topology']) =>
  parameter('enum', value, { options, affects });
const toggle = (value, affects = ['geometry', 'topology']) =>
  parameter('boolean', value, { affects });

const materialIds = Object.freeze(['auto', ...Object.keys(MATERIAL_LIBRARY)]);

/** Parameters shared by all 36 definitions. Mass and stack size deliberately
 * live in Item/business data and therefore do not appear here. */
export const COMMON_PARAMETERS = Object.freeze({
  materialPreset: choice('auto', materialIds, ['material']),
  color: parameter('color', '#808080', { affects: ['material'] }),
  metalness: ratio(0.5, 0, 1, 0.01, ['material']),
  roughness: ratio(0.5, 0, 1, 0.01, ['material']),
  opacity: ratio(1, 0, 1, 0.01, ['material', 'rendering']),
  emission: parameter('color', '#000000', { affects: ['material', 'rendering'] }),
  texture: parameter('string', '', { affects: ['material', 'uv'] }),
});

function define({
  id,
  nameZh,
  nameEn,
  category,
  file,
  level,
  description,
  parameters,
  materials,
  build,
}) {
  const defaultMaterials = Object.freeze({ ...materials });
  return Object.freeze({
    id,
    nameZh,
    nameEn,
    category,
    relativePath: `${category}/${file}.glb`,
    parameterizationLevel: level,
    description,
    parameters: Object.freeze({ ...COMMON_PARAMETERS, ...parameters }),
    materials: defaultMaterials,
    defaultMaterials,
    build,
  });
}

function selectedMaterial(params, fallback) {
  return params.materialPreset && params.materialPreset !== 'auto'
    ? params.materialPreset
    : fallback;
}

function seededRandom(seed) {
  let state = (Math.trunc(seed) || 1) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function polar(radius, angle, y = 0) {
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
}

function addHorizontalCylinder(builder, options) {
  addCylinder(builder, { ...options, rotation: [0, 0, Math.PI / 2] });
}

function addHorizontalAnnulus(builder, options) {
  addAnnularCylinder(builder, { ...options, rotation: [0, 0, Math.PI / 2] });
}

const basicDefinitions = [
  define({
    id: 'BASIC_BOX', nameZh: '方体', nameEn: 'Box', category: 'basic', file: 'box', level: 2,
    description: '通用长方体占位模型，可表示块料、模块、箱体与未知产品。',
    parameters: {
      length: dimension(1.0, 0.05, 5), width: dimension(0.65, 0.05, 5), height: dimension(0.5, 0.05, 5),
      cornerRadius: dimension(0.035, 0, 0.25, 0.005),
    },
    materials: { body: 'neutral' },
    build(builder, p) {
      addBox(builder, { size: [p.length, p.height, p.width], cornerRadius: p.cornerRadius, material: selectedMaterial(p, 'neutral') });
    },
  }),
  define({
    id: 'BASIC_CYLINDER', nameZh: '圆柱体', nameEn: 'Cylinder', category: 'basic', file: 'cylinder', level: 2,
    description: '通用圆柱体，支持分段数和空心结构。',
    parameters: {
      diameter: dimension(0.6, 0.04, 4), height: dimension(0.8, 0.04, 5), sides: count(16, 6, 32),
      hollow: toggle(false),
      wallThickness: parameter('number', 0.05, {
        min: 0.005, max: 0.5, step: 0.005, unit: 'm', affects: ['geometry', 'bounds'], activeWhen: { hollow: true },
      }),
    },
    materials: { body: 'neutral' },
    build(builder, p) {
      const outerRadius = p.diameter / 2;
      if (p.hollow) {
        addAnnularCylinder(builder, {
          outerRadius, innerRadius: Math.max(outerRadius - p.wallThickness, outerRadius * 0.08),
          height: p.height, segments: p.sides, material: selectedMaterial(p, 'neutral'),
        });
      } else {
        addCylinder(builder, { radius: outerRadius, height: p.height, segments: p.sides, material: selectedMaterial(p, 'neutral') });
      }
    },
  }),
  define({
    id: 'BASIC_SPHERE', nameZh: '球体', nameEn: 'Sphere', category: 'basic', file: 'sphere', level: 2,
    description: '通用球体与椭球体，适用于滚珠、颗粒和球形零件。',
    parameters: {
      diameter: dimension(0.6, 0.03, 4), scaleX: ratio(1, 0.2, 3, 0.05), scaleY: ratio(1, 0.2, 3, 0.05),
      scaleZ: ratio(1, 0.2, 3, 0.05), subdivisions: count(2, 1, 3),
    },
    materials: { body: 'neutral' },
    build(builder, p) {
      const segments = 8 + p.subdivisions * 4;
      addSphere(builder, {
        radius: p.diameter / 2, scale: [p.scaleX, p.scaleY, p.scaleZ], segments, rings: Math.max(6, segments / 2),
        material: selectedMaterial(p, 'neutral'),
      });
    },
  }),
  define({
    id: 'BASIC_DISC', nameZh: '圆盘', nameEn: 'Disc', category: 'basic', file: 'disc', level: 2,
    description: '低高度圆盘，可选中心孔，用于垫片毛坯、刹车盘与机械圆片。',
    parameters: {
      diameter: dimension(0.7, 0.05, 4), thickness: dimension(0.08, 0.01, 1), centerHoleDiameter: dimension(0, 0, 3, 0.01),
      sides: count(20, 8, 32),
    },
    materials: { body: 'steel' },
    build(builder, p) {
      const outerRadius = p.diameter / 2;
      if (p.centerHoleDiameter > 0.005) {
        addAnnularCylinder(builder, {
          outerRadius, innerRadius: Math.min(p.centerHoleDiameter / 2, outerRadius * 0.9), height: p.thickness,
          segments: p.sides, material: selectedMaterial(p, 'steel'),
        });
      } else {
        addCylinder(builder, { radius: outerRadius, height: p.thickness, segments: p.sides, material: selectedMaterial(p, 'steel') });
      }
    },
  }),
  define({
    id: 'BASIC_CONE', nameZh: '锥体', nameEn: 'Cone / Frustum', category: 'basic', file: 'cone', level: 2,
    description: '圆锥或截锥占位模型，顶部直径不为零时生成截锥体。',
    parameters: {
      bottomDiameter: dimension(0.8, 0.05, 4), topDiameter: dimension(0, 0, 4), height: dimension(1, 0.05, 5),
      sides: count(18, 6, 32),
    },
    materials: { body: 'neutral' },
    build(builder, p) {
      addFrustum(builder, {
        bottomRadius: p.bottomDiameter / 2, topRadius: Math.min(p.topDiameter, p.bottomDiameter * 1.8) / 2,
        height: p.height, segments: p.sides, material: selectedMaterial(p, 'neutral'),
      });
    },
  }),
  define({
    id: 'BASIC_RING', nameZh: '环形体', nameEn: 'Ring', category: 'basic', file: 'ring', level: 2,
    description: '通用平环形体，可表示密封圈、大型垫圈与环形机械件。',
    parameters: {
      outerDiameter: dimension(0.8, 0.06, 5), innerDiameter: dimension(0.42, 0.01, 4.8), thickness: dimension(0.08, 0.01, 1),
      sides: count(24, 8, 40),
    },
    materials: { body: 'rubber' },
    build(builder, p) {
      addAnnularCylinder(builder, {
        outerRadius: p.outerDiameter / 2, innerRadius: Math.min(p.innerDiameter / 2, p.outerDiameter * 0.47),
        height: p.thickness, segments: p.sides, material: selectedMaterial(p, 'rubber'),
      });
    },
  }),
];

const materialDefinitions = [
  define({
    id: 'RAW_CHUNK', nameZh: '不规则块状原料', nameEn: 'Raw Chunk', category: 'material', file: 'chunk', level: 3,
    description: '确定性生成的低多边形不规则块，用于矿石、煤炭、岩石和工业固体原料。',
    parameters: {
      size: dimension(0.65, 0.05, 3), irregularity: ratio(0.42, 0.05, 0.9, 0.05),
      elongation: ratio(1.15, 0.5, 2.5, 0.05), seed: count(1403, 1, 999999),
    },
    materials: { body: 'dark_steel' },
    build(builder, p) {
      addIrregularRock(builder, {
        radius: p.size / 2, scale: [p.elongation, 0.82 + p.irregularity * 0.25, 1], irregularity: p.irregularity,
        seed: p.seed, segments: 10, rings: 6, material: selectedMaterial(p, 'dark_steel'),
      });
    },
  }),
  define({
    id: 'RAW_GRANULE', nameZh: '颗粒原料', nameEn: 'Raw Granules', category: 'material', file: 'granule', level: 3,
    description: '由 5–15 个代表性低模颗粒组成的小团，避免生成数百颗粒。',
    parameters: {
      granuleSize: dimension(0.11, 0.02, 0.35, 0.01), particleCount: count(9, 5, 15),
      granuleShape: choice('angular', ['angular', 'round', 'flake']), spread: dimension(0.48, 0.1, 1.5), seed: count(3617, 1, 999999),
    },
    materials: { granules: 'plastic_gray' },
    build(builder, p) {
      const random = seededRandom(p.seed);
      const mat = selectedMaterial(p, 'plastic_gray');
      const placed = [];
      for (let i = 0; i < p.particleCount; i += 1) {
        const size = p.granuleSize * (0.72 + random() * 0.55);
        let selected = null;
        let bestClearance = Number.NEGATIVE_INFINITY;
        for (let attempt = 0; attempt < 24; attempt += 1) {
          const angle = random() * TAU;
          const radius = Math.sqrt(random()) * Math.max(p.spread / 2 - size * 0.3, p.spread * 0.18);
          const candidate = [Math.cos(angle) * radius, size * (0.36 + random() * 0.35), Math.sin(angle) * radius];
          const clearance = placed.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...placed.map((entry) =>
            Math.hypot(candidate[0] - entry.center[0], candidate[2] - entry.center[2]) - (size + entry.size) * 0.46));
          if (clearance > bestClearance) {
            bestClearance = clearance;
            selected = candidate;
          }
          if (clearance >= 0) break;
        }
        const center = selected;
        placed.push({ center, size });
        if (p.granuleShape === 'round') {
          addSphere(builder, { radius: size / 2, center, segments: 8, rings: 5, material: mat });
        } else if (p.granuleShape === 'flake') {
          addBox(builder, {
            size: [size, size * 0.18, size * (0.65 + random() * 0.4)], center,
            rotation: [random() * 0.4, angle, random() * 0.4], material: mat,
          });
        } else {
          addIrregularRock(builder, {
            radius: size / 2, center, scale: [1, 0.78, 0.92], irregularity: 0.36,
            seed: p.seed + i * 97, segments: 6, rings: 4, material: mat,
          });
        }
      }
    },
  }),
  define({
    id: 'RAW_INGOT', nameZh: '金属锭', nameEn: 'Metal Ingot', category: 'material', file: 'ingot', level: 3,
    description: '梯形金属锭毛坯，侧壁斜度会真实改变顶部和底部尺寸。',
    parameters: {
      length: dimension(1.0, 0.12, 4), width: dimension(0.48, 0.08, 2), height: dimension(0.32, 0.05, 1.5),
      sideSlope: ratio(0.17, 0, 0.38, 0.01), cornerRadius: dimension(0.025, 0, 0.12, 0.005),
    },
    materials: { body: 'steel' },
    build(builder, p) {
      const inset = Math.min(p.sideSlope, 0.45);
      addFrustum(builder, {
        bottomSize: [p.length, p.width], topSize: [p.length * (1 - inset), p.width * (1 - inset)],
        bottomRadius: Math.max(p.length, p.width) / 2, topRadius: Math.max(p.length, p.width) * (1 - inset) / 2,
        height: p.height, segments: 4, cornerRadius: p.cornerRadius, material: selectedMaterial(p, 'steel'),
      });
    },
  }),
  define({
    id: 'RAW_LOG', nameZh: '原木', nameEn: 'Raw Log', category: 'material', file: 'log', level: 2,
    description: '横置低模原木，表面规则度改变轮廓分段和端部结构。',
    parameters: {
      length: dimension(1.8, 0.2, 6), diameter: dimension(0.46, 0.06, 1.5), regularity: ratio(0.55, 0, 1, 0.05),
      endRingCount: count(3, 0, 6),
    },
    materials: { bark: 'wood', cutEnds: 'cardboard' },
    build(builder, p) {
      const segments = Math.round(7 + p.regularity * 13);
      addHorizontalCylinder(builder, { radius: p.diameter / 2, height: p.length, segments, material: selectedMaterial(p, 'wood') });
      for (let i = 0; i < p.endRingCount; i += 1) {
        const ringRadius = p.diameter * (0.08 + i * 0.055);
        if (ringRadius < p.diameter * 0.46) {
          for (const x of [-p.length / 2 - 0.001, p.length / 2 + 0.001]) {
            addTorus(builder, {
              majorRadius: ringRadius, tubeRadius: Math.max(p.diameter * 0.006, 0.0015),
              radialSegments: 6, tubularSegments: segments, center: [x, 0, 0], rotation: [0, 0, Math.PI / 2], material: 'dark_steel',
            });
          }
        }
      }
    },
  }),
  define({
    id: 'MATERIAL_PLATE', nameZh: '板材', nameEn: 'Plate', category: 'material', file: 'plate', level: 2,
    description: '高频通用薄板，用材质与颜色表示金属板、木板、塑料板、玻璃板等。',
    parameters: {
      length: dimension(1.2, 0.08, 6), width: dimension(0.7, 0.05, 4), thickness: dimension(0.04, 0.005, 0.5, 0.005),
      cornerRadius: dimension(0.015, 0, 0.2, 0.005),
    },
    materials: { body: 'steel' },
    build(builder, p) {
      addBox(builder, {
        size: [p.length, p.thickness, p.width], cornerRadius: p.cornerRadius, material: selectedMaterial(p, 'steel'),
      });
    },
  }),
  define({
    id: 'MATERIAL_ROD', nameZh: '棒材', nameEn: 'Rod', category: 'material', file: 'rod', level: 3,
    description: '支持圆形、方形与六边形截面的横置棒材。',
    parameters: {
      length: dimension(1.5, 0.08, 8), diameter: dimension(0.18, 0.015, 1.5),
      crossSection: choice('round', ['round', 'square', 'hexagonal']),
    },
    materials: { body: 'steel' },
    build(builder, p) {
      const mat = selectedMaterial(p, 'steel');
      if (p.crossSection === 'square') {
        addBox(builder, { size: [p.length, p.diameter, p.diameter], material: mat });
      } else {
        addHorizontalCylinder(builder, { radius: p.diameter / 2, height: p.length, segments: p.crossSection === 'hexagonal' ? 6 : 18, material: mat });
      }
    },
  }),
  define({
    id: 'MATERIAL_BEAM', nameZh: '型材', nameEn: 'Structural Beam', category: 'material', file: 'beam', level: 3,
    description: '通用结构型材，截面可在矩形、H/I、U 和 L 形之间切换。',
    parameters: {
      length: dimension(2.2, 0.2, 10), width: dimension(0.36, 0.06, 1.5), height: dimension(0.5, 0.06, 2),
      wallThickness: dimension(0.07, 0.01, 0.4, 0.01), crossSection: choice('i', ['rectangular', 'i', 'h', 'u', 'l']),
    },
    materials: { body: 'steel' },
    build(builder, p) {
      const mat = selectedMaterial(p, 'steel');
      const t = Math.min(p.wallThickness, p.width * 0.45, p.height * 0.45);
      if (p.crossSection === 'rectangular') {
        addBox(builder, { size: [p.length, p.height, p.width], material: mat });
      } else if (p.crossSection === 'i' || p.crossSection === 'h') {
        addBox(builder, { size: [p.length, t, p.width], center: [0, (p.height - t) / 2, 0], material: mat });
        addBox(builder, { size: [p.length, t, p.width], center: [0, -(p.height - t) / 2, 0], material: mat });
        addBox(builder, { size: [p.length, p.height - 2 * t, t], material: mat });
      } else if (p.crossSection === 'u') {
        addBox(builder, { size: [p.length, t, p.width], center: [0, -(p.height - t) / 2, 0], material: mat });
        addBox(builder, { size: [p.length, p.height - t, t], center: [0, t / 2, (p.width - t) / 2], material: mat });
        addBox(builder, { size: [p.length, p.height - t, t], center: [0, t / 2, -(p.width - t) / 2], material: mat });
      } else {
        addBox(builder, { size: [p.length, t, p.width], center: [0, -(p.height - t) / 2, 0], material: mat });
        addBox(builder, { size: [p.length, p.height - t, t], center: [0, t / 2, -(p.width - t) / 2], material: mat });
      }
    },
  }),
  define({
    id: 'MATERIAL_PIPE', nameZh: '管材', nameEn: 'Pipe', category: 'material', file: 'pipe', level: 3,
    description: '支持圆形和方形截面的空心管材，内外径会改变实际管壁。',
    parameters: {
      length: dimension(1.8, 0.1, 8), outerDiameter: dimension(0.34, 0.04, 2), innerDiameter: dimension(0.25, 0.005, 1.9),
      crossSection: choice('round', ['round', 'square']), sides: count(20, 8, 32),
    },
    materials: { body: 'steel' },
    build(builder, p) {
      const mat = selectedMaterial(p, 'steel');
      const outer = p.outerDiameter;
      const inner = Math.min(p.innerDiameter, outer * 0.9);
      if (p.crossSection === 'round') {
        addHorizontalAnnulus(builder, { outerRadius: outer / 2, innerRadius: inner / 2, height: p.length, segments: p.sides, material: mat });
      } else {
        const wall = Math.max((outer - inner) / 2, outer * 0.04);
        addBox(builder, { size: [p.length, wall, outer], center: [0, (outer - wall) / 2, 0], material: mat });
        addBox(builder, { size: [p.length, wall, outer], center: [0, -(outer - wall) / 2, 0], material: mat });
        addBox(builder, { size: [p.length, inner, wall], center: [0, 0, (outer - wall) / 2], material: mat });
        addBox(builder, { size: [p.length, inner, wall], center: [0, 0, -(outer - wall) / 2], material: mat });
      }
    },
  }),
  define({
    id: 'MATERIAL_COIL', nameZh: '卷材', nameEn: 'Sheet Coil', category: 'material', file: 'coil', level: 2,
    description: '中心空心的宽幅卷材，可表示金属卷、纸卷和薄膜卷。',
    parameters: {
      outerDiameter: dimension(1.2, 0.12, 4), innerDiameter: dimension(0.52, 0.04, 3.8), width: dimension(0.65, 0.05, 3),
      sides: count(28, 12, 40),
    },
    materials: { body: 'steel' },
    build(builder, p) {
      addHorizontalAnnulus(builder, {
        outerRadius: p.outerDiameter / 2, innerRadius: Math.min(p.innerDiameter / 2, p.outerDiameter * 0.47),
        height: p.width, segments: p.sides, material: selectedMaterial(p, 'steel'),
      });
    },
  }),
  define({
    id: 'MATERIAL_WIRE_COIL', nameZh: '线材卷', nameEn: 'Wire Coil', category: 'material', file: 'wire-coil', level: 3,
    description: '由多个低模环形线圈堆叠成的线材卷，线径、卷径、卷宽和圈数都会改变几何。',
    parameters: {
      wireDiameter: dimension(0.035, 0.005, 0.16, 0.005), coilDiameter: dimension(0.72, 0.1, 3),
      coilWidth: dimension(0.34, 0.03, 1.5), turns: count(8, 3, 14),
    },
    materials: { wire: 'copper' },
    build(builder, p) {
      const mat = selectedMaterial(p, 'copper');
      const tube = Math.min(p.wireDiameter / 2, p.coilDiameter * 0.12);
      for (let i = 0; i < p.turns; i += 1) {
        const x = p.turns === 1 ? 0 : -p.coilWidth / 2 + (p.coilWidth * i) / (p.turns - 1);
        addTorus(builder, {
          majorRadius: Math.max(p.coilDiameter / 2 - tube, tube * 1.5), tubeRadius: tube,
          radialSegments: 6, tubularSegments: 16, center: [x, 0, 0], rotation: [0, 0, Math.PI / 2], material: mat,
        });
      }
    },
  }),
];

const mechanicalDefinitions = [
  define({
    id: 'PART_GEAR', nameZh: '齿轮', nameEn: 'Gear', category: 'mechanical', file: 'gear', level: 3,
    description: '低模直齿轮，齿数会直接决定周向齿块数量，孔径会改变真实中心孔。',
    parameters: {
      outerDiameter: dimension(0.72, 0.08, 3), thickness: dimension(0.12, 0.02, 0.8), centerHoleDiameter: dimension(0.14, 0.01, 2.5),
      toothCount: count(18, 8, 36), toothHeight: dimension(0.065, 0.008, 0.25, 0.005), toothWidthRatio: ratio(0.58, 0.28, 0.85, 0.02),
    },
    materials: { gear: 'steel' },
    build(builder, p) {
      const mat = selectedMaterial(p, 'steel');
      const outerRadius = p.outerDiameter / 2;
      const rootRadius = Math.max(outerRadius - p.toothHeight, outerRadius * 0.55);
      const innerRadius = Math.min(p.centerHoleDiameter / 2, rootRadius * 0.72);
      addAnnularCylinder(builder, { outerRadius: rootRadius, innerRadius, height: p.thickness, segments: Math.max(16, p.toothCount * 2), material: mat });
      const tangentialWidth = (TAU * rootRadius / p.toothCount) * p.toothWidthRatio;
      for (let i = 0; i < p.toothCount; i += 1) {
        const angle = (i / p.toothCount) * TAU;
        addBox(builder, {
          size: [p.toothHeight * 1.25, p.thickness, tangentialWidth],
          center: polar(rootRadius + p.toothHeight * 0.42, angle), rotation: [0, -angle, 0], material: mat,
        });
      }
    },
  }),
  define({
    id: 'PART_SHAFT', nameZh: '机械轴', nameEn: 'Shaft', category: 'mechanical', file: 'shaft', level: 3,
    description: '横置机械轴，支持端部台阶和贯穿中心孔。',
    parameters: {
      length: dimension(1.2, 0.08, 6), shaftDiameter: dimension(0.2, 0.02, 1.5), endDiameter: dimension(0.29, 0.02, 2),
      steppedEnds: toggle(true), stepLength: dimension(0.16, 0.01, 1), centerHoleDiameter: dimension(0, 0, 1), sides: count(18, 8, 32),
    },
    materials: { body: 'steel' },
    build(builder, p) {
      const mat = selectedMaterial(p, 'steel');
      const effectiveStepLength = Math.min(p.stepLength, p.length * 0.36);
      const bodyLength = p.steppedEnds ? p.length - effectiveStepLength * 2 : p.length;
      const shaftOuter = p.shaftDiameter / 2;
      const inner = Math.min(p.centerHoleDiameter / 2, shaftOuter * 0.72);
      if (inner > 0.002) {
        addHorizontalAnnulus(builder, { outerRadius: shaftOuter, innerRadius: inner, height: bodyLength, segments: p.sides, material: mat });
      } else {
        addHorizontalCylinder(builder, { radius: shaftOuter, height: bodyLength, segments: p.sides, material: mat });
      }
      if (p.steppedEnds) {
        for (const sign of [-1, 1]) {
          addHorizontalCylinder(builder, {
            radius: p.endDiameter / 2, height: effectiveStepLength, segments: p.sides,
            center: [sign * (bodyLength / 2 + effectiveStepLength / 2), 0, 0], material: mat,
          });
        }
      }
    },
  }),
  define({
    id: 'PART_BEARING', nameZh: '轴承', nameEn: 'Bearing', category: 'mechanical', file: 'bearing', level: 3,
    description: '由内外滚道和 6–12 个低模滚珠组成的通用轴承。',
    parameters: {
      outerDiameter: dimension(0.62, 0.08, 2.5), innerDiameter: dimension(0.28, 0.02, 2), thickness: dimension(0.16, 0.02, 0.7),
      ballCount: count(8, 6, 12), sides: count(24, 12, 32),
    },
    materials: { races: 'steel', balls: 'aluminum' },
    build(builder, p) {
      const mat = selectedMaterial(p, 'steel');
      const outer = p.outerDiameter / 2;
      const inner = Math.min(p.innerDiameter / 2, outer * 0.72);
      const ballRadius = Math.max(Math.min((outer - inner) * 0.28, p.thickness * 0.40), 0.012);
      const pitch = (outer + inner) / 2;
      const raceHeight = p.thickness * 0.72;
      addAnnularCylinder(builder, { outerRadius: outer, innerRadius: pitch + ballRadius * 0.72, height: raceHeight, segments: p.sides, material: mat });
      addAnnularCylinder(builder, { outerRadius: pitch - ballRadius * 0.72, innerRadius: inner, height: raceHeight, segments: p.sides, material: mat });
      for (let i = 0; i < p.ballCount; i += 1) {
        const center = polar(pitch, (i / p.ballCount) * TAU);
        center[1] = p.thickness * 0.20;
        addSphere(builder, { radius: ballRadius, center, segments: 8, rings: 5, material: selectedMaterial(p, 'aluminum') });
      }
    },
  }),
  define({
    id: 'PART_BOLT', nameZh: '螺栓', nameEn: 'Bolt', category: 'mechanical', file: 'bolt', level: 3,
    description: '简化螺栓，用低面数环形凸缘表现螺纹提示，不生成真实密集螺纹。',
    parameters: {
      length: dimension(0.65, 0.04, 3), diameter: dimension(0.12, 0.01, 0.8), headDiameter: dimension(0.25, 0.03, 1.2),
      headHeight: dimension(0.11, 0.01, 0.5), headType: choice('hex', ['hex', 'cylindrical']), threadBandCount: count(4, 0, 8),
    },
    materials: { body: 'steel' },
    build(builder, p) {
      const mat = selectedMaterial(p, 'steel');
      addCylinder(builder, { radius: p.diameter / 2, height: p.length, segments: 14, center: [0, p.length / 2, 0], material: mat });
      addCylinder(builder, {
        radius: p.headDiameter / 2, height: p.headHeight, segments: p.headType === 'hex' ? 6 : 18,
        center: [0, p.length + p.headHeight / 2, 0], material: mat,
      });
      const threadedLength = p.length * 0.48;
      for (let i = 0; i < p.threadBandCount; i += 1) {
        const y = p.threadBandCount === 1 ? threadedLength / 2 : (threadedLength * i) / Math.max(1, p.threadBandCount - 1);
        addTorus(builder, { majorRadius: p.diameter / 2, tubeRadius: p.diameter * 0.035, radialSegments: 5, tubularSegments: 12, center: [0, y, 0], material: mat });
      }
    },
  }),
  define({
    id: 'PART_NUT', nameZh: '螺母', nameEn: 'Nut', category: 'mechanical', file: 'nut', level: 2,
    description: '六角环形紧固件，具有真实贯穿中心孔。',
    parameters: {
      outerDiameter: dimension(0.34, 0.04, 1.5), innerDiameter: dimension(0.14, 0.01, 1.2), thickness: dimension(0.15, 0.01, 0.7),
      sides: choice(6, [6, 8]),
    },
    materials: { body: 'steel' },
    build(builder, p) {
      addAnnularCylinder(builder, {
        outerRadius: p.outerDiameter / 2, innerRadius: Math.min(p.innerDiameter / 2, p.outerDiameter * 0.42),
        height: p.thickness, segments: Number(p.sides), material: selectedMaterial(p, 'steel'),
      });
    },
  }),
  define({
    id: 'PART_SPRING', nameZh: '弹簧', nameEn: 'Spring', category: 'mechanical', file: 'spring', level: 3,
    description: '基于管路径生成的真实低模螺旋弹簧，圈数会直接改变螺旋路径。',
    parameters: {
      length: dimension(0.8, 0.08, 3), diameter: dimension(0.4, 0.04, 1.5), wireDiameter: dimension(0.045, 0.005, 0.2, 0.005),
      coilCount: count(7, 3, 14), segmentsPerCoil: count(10, 6, 14),
    },
    materials: { wire: 'steel' },
    build(builder, p) {
      const points = [];
      const steps = p.coilCount * p.segmentsPerCoil;
      const radius = Math.max(p.diameter / 2 - p.wireDiameter / 2, p.wireDiameter);
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const angle = t * p.coilCount * TAU;
        points.push([Math.cos(angle) * radius, -p.length / 2 + t * p.length, Math.sin(angle) * radius]);
      }
      addTubePath(builder, { points, radius: p.wireDiameter / 2, segments: 6, material: selectedMaterial(p, 'steel') });
    },
  }),
  define({
    id: 'PART_WHEEL', nameZh: '车轮 / 滚轮', nameEn: 'Wheel / Roller', category: 'mechanical', file: 'wheel', level: 3,
    description: '通用轮体，由轮缘、轮毂与中心孔构成，轮胎尺寸改变轮缘厚度。',
    parameters: {
      diameter: dimension(0.7, 0.08, 3), width: dimension(0.22, 0.03, 1.2), centerHoleDiameter: dimension(0.12, 0.01, 1.5),
      tireThickness: dimension(0.11, 0.015, 0.5), hubDiameter: dimension(0.30, 0.04, 2),
    },
    materials: { tire: 'rubber', hub: 'steel' },
    build(builder, p) {
      const tire = selectedMaterial(p, 'rubber');
      const outer = p.diameter / 2;
      const tireDepth = Math.min(p.tireThickness, outer * 0.45);
      const tireInner = Math.max(outer - tireDepth, outer * 0.25);
      const hole = Math.min(p.centerHoleDiameter / 2, p.hubDiameter * 0.38, p.diameter * 0.255);
      const hubOuter = Math.max(hole * 1.35, Math.min(p.hubDiameter / 2, tireInner * 0.82));
      addHorizontalAnnulus(builder, {
        outerRadius: outer, innerRadius: tireInner, height: p.width,
        segments: 24, material: tire,
      });
      // The web deliberately overlaps the tyre and hub so the wheel remains a
      // connected, manufacturable-looking object at every allowed parameter.
      addHorizontalAnnulus(builder, {
        outerRadius: tireInner * 1.015, innerRadius: hole, height: p.width * 0.30,
        segments: 24, material: selectedMaterial(p, 'steel'),
      });
      addHorizontalAnnulus(builder, {
        outerRadius: hubOuter, innerRadius: hole, height: p.width * 0.72,
        segments: 18, material: selectedMaterial(p, 'steel'),
      });
    },
  }),
  define({
    id: 'PART_FLANGE', nameZh: '法兰', nameEn: 'Flange', category: 'mechanical', file: 'flange', level: 3,
    description: '带中心通孔与环形螺栓孔标识的管道法兰。',
    parameters: {
      outerDiameter: dimension(0.78, 0.1, 3), innerDiameter: dimension(0.3, 0.02, 2.5), thickness: dimension(0.11, 0.015, 0.7),
      boltHoleCount: count(6, 3, 12), boltHoleDiameter: dimension(0.06, 0.008, 0.3), boltCircleDiameter: dimension(0.56, 0.05, 2.7),
    },
    materials: { body: 'steel', holeMarkers: 'dark_steel' },
    build(builder, p) {
      const outer = p.outerDiameter / 2;
      addAnnularCylinder(builder, {
        outerRadius: outer, innerRadius: Math.min(p.innerDiameter / 2, outer * 0.72), height: p.thickness,
        segments: 28, material: selectedMaterial(p, 'steel'),
      });
      const pitch = Math.min(p.boltCircleDiameter / 2, outer * 0.78);
      for (let i = 0; i < p.boltHoleCount; i += 1) {
        addCylinder(builder, {
          radius: p.boltHoleDiameter / 2, height: p.thickness * 1.04,
          segments: 10, center: polar(pitch, (i / p.boltHoleCount) * TAU), material: 'dark_steel',
        });
      }
    },
  }),
];

const electronicDefinitions = [
  define({
    id: 'ELEC_PCB', nameZh: '印制电路板', nameEn: 'PCB', category: 'electronic', file: 'pcb', level: 3,
    description: '简化 PCB 基板，以少量芯片、电容和接口几何提示电子属性，不伪造真实电路。',
    parameters: {
      length: dimension(0.52, 0.08, 1.5), width: dimension(0.34, 0.06, 1.2), thickness: dimension(0.018, 0.005, 0.08, 0.001),
      componentCount: count(7, 2, 14), connectorCount: count(2, 0, 5), layoutSeed: count(4721, 1, 999999),
    },
    materials: { board: 'pcb_green', components: 'component_black', contacts: 'copper' },
    build(builder, p) {
      const board = selectedMaterial(p, 'pcb_green');
      addBox(builder, { size: [p.length, p.thickness, p.width], material: board });
      const random = seededRandom(p.layoutSeed);
      for (let i = 0; i < p.componentCount; i += 1) {
        const x = (random() - 0.5) * p.length * 0.7;
        const z = (random() - 0.5) * p.width * 0.65;
        const w = p.length * (0.055 + random() * 0.07);
        const d = p.width * (0.07 + random() * 0.10);
        const h = p.thickness * (1.5 + random() * 2.8);
        if (i % 3 === 2) {
          addCylinder(builder, { radius: Math.min(w, d) / 2, height: h, segments: 10, center: [x, p.thickness / 2 + h / 2, z], material: i % 2 ? 'aluminum' : 'component_black' });
        } else {
          addBox(builder, { size: [w, h, d], center: [x, p.thickness / 2 + h / 2, z], material: 'component_black' });
        }
      }
      for (let i = 0; i < p.connectorCount; i += 1) {
        const z = p.connectorCount === 1 ? 0 : -p.width * 0.32 + (p.width * 0.64 * i) / Math.max(1, p.connectorCount - 1);
        addBox(builder, {
          size: [p.length * 0.09, p.thickness * 3.4, p.width * 0.12],
          center: [p.length * 0.46, p.thickness * 1.7, z], material: 'aluminum',
        });
      }
    },
  }),
  define({
    id: 'ELEC_CHIP', nameZh: '芯片', nameEn: 'Integrated Circuit', category: 'electronic', file: 'chip', level: 3,
    description: '通用集成电路封装，引脚数与引脚形式会真实改变周边几何。',
    parameters: {
      length: dimension(0.18, 0.025, 0.6), width: dimension(0.14, 0.02, 0.5), height: dimension(0.04, 0.008, 0.2),
      pinCount: count(16, 4, 40, 2), pinStyle: choice('gullwing', ['gullwing', 'straight', 'pad']), pinLength: dimension(0.035, 0.005, 0.12, 0.005),
    },
    materials: { package: 'component_black', pins: 'aluminum', marker: 'neutral' },
    build(builder, p) {
      const body = selectedMaterial(p, 'component_black');
      addBox(builder, { size: [p.length, p.height, p.width], cornerRadius: p.height * 0.12, center: [0, p.height / 2, 0], material: body });
      const perSide = Math.max(2, Math.floor(p.pinCount / 2));
      for (let i = 0; i < perSide; i += 1) {
        const x = perSide === 1 ? 0 : -p.length * 0.4 + (p.length * 0.8 * i) / (perSide - 1);
        for (const sign of [-1, 1]) {
          const extension = p.pinStyle === 'pad' ? p.pinLength * 0.42 : p.pinLength;
          const pinHeight = p.pinStyle === 'gullwing' ? p.height * 0.24 : p.height * 0.14;
          addBox(builder, {
            size: [Math.min(p.length / (perSide * 1.6), p.width * 0.08), pinHeight, extension],
            center: [x, pinHeight / 2, sign * (p.width / 2 + extension / 2)], material: 'aluminum',
          });
        }
      }
      addCylinder(builder, { radius: p.height * 0.11, height: p.height * 0.012, segments: 8, center: [-p.length * 0.3, p.height + 0.001, -p.width * 0.28], material: 'neutral' });
    },
  }),
  define({
    id: 'ELEC_BATTERY', nameZh: '电池', nameEn: 'Battery', category: 'electronic', file: 'battery', level: 3,
    description: '方形与圆柱形两种基础电池形态，形态选项会切换主体结构。',
    parameters: {
      shape: choice('prismatic', ['prismatic', 'cylindrical']), length: dimension(0.42, 0.05, 1.8),
      width: dimension(0.22, 0.04, 1.2), height: dimension(0.28, 0.06, 1.8),
      diameter: parameter('number', 0.22, {
        min: 0.03, max: 1, step: 0.01, unit: 'm', affects: ['geometry', 'bounds'], activeWhen: { shape: 'cylindrical' },
      }),
      terminalSize: dimension(0.045, 0.008, 0.2, 0.005),
    },
    materials: { casing: 'plastic_blue', positive: 'copper', negative: 'aluminum' },
    build(builder, p) {
      const body = selectedMaterial(p, 'plastic_blue');
      if (p.shape === 'cylindrical') {
        addCylinder(builder, { radius: p.diameter / 2, height: p.height, segments: 20, center: [0, p.height / 2, 0], material: body });
        addCylinder(builder, { radius: p.terminalSize / 2, height: p.terminalSize * 0.35, segments: 12, center: [0, p.height + p.terminalSize * 0.175, 0], material: 'copper' });
      } else {
        addBox(builder, { size: [p.length, p.height, p.width], cornerRadius: Math.min(p.width, p.height) * 0.07, center: [0, p.height / 2, 0], material: body });
        for (const [sign, materialId] of [[-1, 'aluminum'], [1, 'copper']]) {
          addBox(builder, {
            size: [p.terminalSize, p.terminalSize * 0.45, p.terminalSize],
            center: [sign * p.length * 0.3, p.height + p.terminalSize * 0.225, 0], material: materialId,
          });
        }
      }
    },
  }),
  define({
    id: 'ELEC_MOTOR', nameZh: '电机', nameEn: 'Electric Motor', category: 'electronic', file: 'motor', level: 3,
    description: '由横置圆柱主体、传动轴、散热环和底座组成的简化工业电机。',
    parameters: {
      bodyLength: dimension(0.75, 0.12, 3), bodyDiameter: dimension(0.42, 0.08, 1.5), shaftLength: dimension(0.22, 0.03, 1),
      shaftDiameter: dimension(0.09, 0.01, 0.4), baseWidth: dimension(0.54, 0.08, 2), baseHeight: dimension(0.08, 0.01, 0.4),
      coolingFinCount: count(5, 0, 10),
    },
    materials: { body: 'plastic_blue', endCaps: 'dark_steel', shaft: 'steel', base: 'dark_steel' },
    build(builder, p) {
      const body = selectedMaterial(p, 'plastic_blue');
      const bodyCenterY = p.baseHeight + p.bodyDiameter / 2;
      addHorizontalCylinder(builder, { radius: p.bodyDiameter / 2, height: p.bodyLength, segments: 20, center: [0, bodyCenterY, 0], material: body });
      for (const sign of [-1, 1]) {
        addHorizontalCylinder(builder, {
          radius: p.bodyDiameter * 0.47, height: p.bodyLength * 0.06, segments: 18,
          center: [sign * p.bodyLength * 0.5, bodyCenterY, 0], material: 'dark_steel',
        });
      }
      addHorizontalCylinder(builder, {
        radius: p.shaftDiameter / 2, height: p.shaftLength, segments: 14,
        center: [p.bodyLength / 2 + p.shaftLength / 2, bodyCenterY, 0], material: 'steel',
      });
      addBox(builder, { size: [p.bodyLength * 0.76, p.baseHeight, p.baseWidth], center: [0, p.baseHeight / 2, 0], material: 'dark_steel' });
      for (let i = 0; i < p.coolingFinCount; i += 1) {
        const x = p.coolingFinCount === 1 ? 0 : -p.bodyLength * 0.34 + (p.bodyLength * 0.68 * i) / Math.max(1, p.coolingFinCount - 1);
        addTorus(builder, {
          majorRadius: p.bodyDiameter * 0.49, tubeRadius: p.bodyDiameter * 0.018,
          radialSegments: 5, tubularSegments: 18, center: [x, bodyCenterY, 0], rotation: [0, 0, Math.PI / 2], material: 'dark_steel',
        });
      }
    },
  }),
  define({
    id: 'ELEC_MODULE', nameZh: '通用电子模块', nameEn: 'Electronic Module', category: 'electronic', file: 'module', level: 3,
    description: '带状态灯与可变数量接口的通用工业电子模块占位模型。',
    parameters: {
      length: dimension(0.46, 0.08, 1.5), width: dimension(0.25, 0.05, 1), height: dimension(0.18, 0.04, 0.8),
      portCount: count(4, 1, 10), portStyle: choice('socket', ['socket', 'terminal', 'round']), ledCount: count(3, 0, 6),
    },
    materials: { enclosure: 'plastic_gray', ports: 'component_black', contacts: 'copper', leds: 'safety_yellow' },
    build(builder, p) {
      const body = selectedMaterial(p, 'plastic_gray');
      addBox(builder, { size: [p.length, p.height, p.width], cornerRadius: p.height * 0.06, center: [0, p.height / 2, 0], material: body });
      for (let i = 0; i < p.portCount; i += 1) {
        const x = p.portCount === 1 ? 0 : -p.length * 0.38 + (p.length * 0.76 * i) / Math.max(1, p.portCount - 1);
        if (p.portStyle === 'round') {
          addCylinder(builder, { radius: p.width * 0.070, height: p.width * 0.075, segments: 10, center: [x, p.height * 0.48, p.width * 0.515], rotation: [Math.PI / 2, 0, 0], material: 'aluminum' });
          addCylinder(builder, { radius: p.width * 0.048, height: p.width * 0.105, segments: 10, center: [x, p.height * 0.48, p.width * 0.535], rotation: [Math.PI / 2, 0, 0], material: 'component_black' });
        } else {
          const portHeight = p.portStyle === 'terminal' ? p.height * 0.25 : p.height * 0.36;
          addBox(builder, { size: [p.length * 0.072, portHeight * 1.12, p.width * 0.055], center: [x, p.height * 0.46, p.width * 0.512], material: 'aluminum' });
          addBox(builder, { size: [p.length * 0.050, portHeight, p.width * 0.08], center: [x, p.height * 0.46, p.width * 0.54], material: p.portStyle === 'terminal' ? 'copper' : 'component_black' });
        }
      }
      for (let i = 0; i < p.ledCount; i += 1) {
        const x = p.ledCount === 1 ? 0 : -p.length * 0.28 + (p.length * 0.56 * i) / Math.max(1, p.ledCount - 1);
        addCylinder(builder, { radius: p.height * 0.052, height: p.height * 0.034, segments: 8, center: [x, p.height + 0.003, -p.width * 0.26], material: 'safety_yellow' });
      }
    },
  }),
];

const packageDefinitions = [
  define({
    id: 'PACK_BOX', nameZh: '包装纸箱', nameEn: 'Package Box', category: 'package', file: 'box', level: 3,
    description: '通用瓦楞纸箱，封箱方式会在封闭、胶带封口和开盖结构之间切换。',
    parameters: {
      length: dimension(0.72, 0.08, 3), width: dimension(0.48, 0.06, 2), height: dimension(0.5, 0.06, 2.5),
      closureStyle: choice('taped', ['sealed', 'taped', 'open']), wallThickness: dimension(0.018, 0.005, 0.08, 0.002),
    },
    materials: { carton: 'cardboard', tape: 'fabric' },
    build(builder, p) {
      const carton = selectedMaterial(p, 'cardboard');
      const t = Math.min(p.wallThickness, p.length * 0.12, p.width * 0.12, p.height * 0.12);
      if (p.closureStyle === 'open') {
        addBox(builder, { size: [p.length, t, p.width], center: [0, t / 2, 0], material: carton });
        addBox(builder, { size: [p.length, p.height, t], center: [0, p.height / 2, (p.width - t) / 2], material: carton });
        addBox(builder, { size: [p.length, p.height, t], center: [0, p.height / 2, -(p.width - t) / 2], material: carton });
        addBox(builder, { size: [t, p.height, p.width - 2 * t], center: [(p.length - t) / 2, p.height / 2, 0], material: carton });
        addBox(builder, { size: [t, p.height, p.width - 2 * t], center: [-(p.length - t) / 2, p.height / 2, 0], material: carton });
        for (const sign of [-1, 1]) {
          addBox(builder, {
            size: [p.length * 0.46, t, p.width], center: [sign * p.length * 0.27, p.height + t / 2, 0],
            rotation: [0, 0, sign * 0.30], material: carton,
          });
        }
      } else {
        addBox(builder, { size: [p.length, p.height, p.width], center: [0, p.height / 2, 0], material: carton });
        if (p.closureStyle === 'taped') {
          addBox(builder, { size: [p.length, t * 0.25, p.width * 0.12], center: [0, p.height + t * 0.13, 0], material: 'fabric' });
        }
      }
    },
  }),
  define({
    id: 'PACK_CRATE', nameZh: '木箱', nameEn: 'Wooden Crate', category: 'package', file: 'crate', level: 3,
    description: '由边框、底板和可变数量木条组成的低模运输木箱。',
    parameters: {
      length: dimension(1.0, 0.2, 4), width: dimension(0.72, 0.15, 3), height: dimension(0.75, 0.2, 3),
      slatCount: count(4, 2, 7), closed: toggle(false), slatThickness: dimension(0.065, 0.02, 0.2, 0.005),
    },
    materials: { wood: 'wood', fasteners: 'dark_steel' },
    build(builder, p) {
      const wood = selectedMaterial(p, 'wood');
      const t = Math.min(p.slatThickness, p.length * 0.16, p.width * 0.16);
      addBox(builder, { size: [p.length, t, p.width], center: [0, t / 2, 0], material: wood });
      for (const x of [-(p.length - t) / 2, (p.length - t) / 2]) {
        for (const z of [-(p.width - t) / 2, (p.width - t) / 2]) {
          addBox(builder, { size: [t, p.height, t], center: [x, p.height / 2, z], material: wood });
        }
      }
      const verticalSpan = Math.max(p.height - 2 * t, t);
      for (let i = 0; i < p.slatCount; i += 1) {
        const y = t + (verticalSpan * (i + 0.5)) / p.slatCount;
        for (const z of [-(p.width - t) / 2, (p.width - t) / 2]) {
          addBox(builder, { size: [p.length - 2 * t, t * 0.72, t], center: [0, y, z], material: wood });
        }
        for (const x of [-(p.length - t) / 2, (p.length - t) / 2]) {
          addBox(builder, { size: [t, t * 0.72, p.width - 2 * t], center: [x, y, 0], material: wood });
        }
      }
      if (p.closed) {
        addBox(builder, { size: [p.length, t, p.width], center: [0, p.height + t / 2, 0], material: wood });
      }
    },
  }),
  define({
    id: 'PACK_BIN', nameZh: '塑料周转箱', nameEn: 'Logistics Bin', category: 'package', file: 'bin', level: 3,
    description: '低模物流周转箱，支持顶部开口、前取料口和封闭抽屉形态。',
    parameters: {
      length: dimension(0.64, 0.12, 2.5), width: dimension(0.46, 0.1, 1.8), height: dimension(0.34, 0.08, 1.5),
      openingStyle: choice('top', ['top', 'front', 'drawer']), wallThickness: dimension(0.028, 0.008, 0.12, 0.002), ribCount: count(4, 0, 8),
    },
    materials: { body: 'plastic_blue', ribs: 'plastic_gray' },
    build(builder, p) {
      const body = selectedMaterial(p, 'plastic_blue');
      const t = Math.min(p.wallThickness, p.length * 0.12, p.width * 0.12, p.height * 0.18);
      addBox(builder, { size: [p.length, t, p.width], center: [0, t / 2, 0], material: body });
      addBox(builder, { size: [t, p.height, p.width], center: [-(p.length - t) / 2, p.height / 2, 0], material: body });
      addBox(builder, { size: [t, p.height, p.width], center: [(p.length - t) / 2, p.height / 2, 0], material: body });
      addBox(builder, { size: [p.length - 2 * t, p.height, t], center: [0, p.height / 2, -(p.width - t) / 2], material: body });
      if (p.openingStyle === 'front') {
        addBox(builder, { size: [p.length - 2 * t, p.height * 0.38, t], center: [0, p.height * 0.19, (p.width - t) / 2], material: body });
      } else {
        addBox(builder, { size: [p.length - 2 * t, p.height, t], center: [0, p.height / 2, (p.width - t) / 2], material: body });
      }
      if (p.openingStyle === 'drawer') {
        addBox(builder, { size: [p.length, t, p.width], center: [0, p.height + t / 2, 0], material: body });
        addBox(builder, { size: [p.length * 0.20, t * 0.55, t * 0.8], center: [0, p.height * 0.62, p.width / 2 + t * 0.4], material: 'plastic_gray' });
      }
      for (let i = 0; i < p.ribCount; i += 1) {
        const x = p.ribCount === 1 ? 0 : -p.length * 0.36 + (p.length * 0.72 * i) / Math.max(1, p.ribCount - 1);
        addBox(builder, { size: [t * 0.48, p.height * 0.78, t * 0.5], center: [x, p.height * 0.46, -(p.width / 2 + t * 0.2)], material: body });
      }
    },
  }),
  define({
    id: 'PACK_PALLET', nameZh: '托盘', nameEn: 'Pallet', category: 'package', file: 'pallet', level: 3,
    description: '用于仓储、AGV 搬运和运输的通用低模托盘，面板数和底梁数会改变几何。',
    parameters: {
      length: dimension(1.2, 0.35, 3), width: dimension(1.0, 0.3, 2.5), height: dimension(0.15, 0.06, 0.5),
      deckSlatCount: count(7, 4, 10), runnerCount: count(3, 2, 4), deckThicknessRatio: ratio(0.26, 0.15, 0.42, 0.01),
    },
    materials: { body: 'wood' },
    build(builder, p) {
      const mat = selectedMaterial(p, 'wood');
      const deckT = p.height * p.deckThicknessRatio;
      const gapLayer = p.height - deckT * 2;
      const slatWidth = p.width / (p.deckSlatCount * 1.45);
      for (let i = 0; i < p.deckSlatCount; i += 1) {
        const z = p.deckSlatCount === 1 ? 0 : -p.width * 0.44 + (p.width * 0.88 * i) / (p.deckSlatCount - 1);
        addBox(builder, { size: [p.length, deckT, slatWidth], center: [0, p.height - deckT / 2, z], material: mat });
      }
      const runnerWidth = p.width / (p.runnerCount * 2.4);
      for (let i = 0; i < p.runnerCount; i += 1) {
        const z = p.runnerCount === 1 ? 0 : -p.width * 0.36 + (p.width * 0.72 * i) / Math.max(1, p.runnerCount - 1);
        addBox(builder, { size: [p.length, deckT, runnerWidth * 1.15], center: [0, deckT / 2, z], material: mat });
        for (const x of [-p.length * 0.36, 0, p.length * 0.36]) {
          addBox(builder, {
            size: [p.length * 0.18, Math.max(gapLayer, deckT), runnerWidth],
            center: [x, deckT + gapLayer / 2, z], material: mat,
          });
        }
      }
    },
  }),
  define({
    id: 'PACK_SACK', nameZh: '麻袋 / 软袋', nameEn: 'Sack', category: 'package', file: 'sack', level: 3,
    description: '用旋转剖面生成的低多边形柔性袋，饱满度会改变袋身鼓胀程度。',
    parameters: {
      width: dimension(0.55, 0.12, 1.8), height: dimension(0.82, 0.18, 2.5), fullness: ratio(0.78, 0.25, 1, 0.05),
      neckRatio: ratio(0.28, 0.12, 0.55, 0.01), sides: count(14, 8, 24),
    },
    materials: { bag: 'fabric', tie: 'dark_steel' },
    build(builder, p) {
      const radius = p.width / 2;
      const bulge = 0.68 + p.fullness * 0.34;
      const profile = [
        [radius * 0.68, 0], [radius * 0.96, p.height * 0.055], [radius * (bulge + 0.05), p.height * 0.36],
        [radius * (bulge + 0.08), p.height * 0.60], [radius * (0.88 + p.fullness * 0.10), p.height * 0.82], [radius * p.neckRatio, p.height * 0.94],
        [radius * p.neckRatio * 0.74, p.height],
      ];
      const ovalScale = [1, 1, 0.70 + p.fullness * 0.12];
      addRevolved(builder, { profile, segments: p.sides, transformScale: ovalScale, material: selectedMaterial(p, 'fabric') });
      addTorus(builder, { majorRadius: radius * p.neckRatio * 0.82, tubeRadius: radius * 0.035, radialSegments: 5, tubularSegments: p.sides, center: [0, p.height * 0.94, 0], transformScale: ovalScale, material: 'dark_steel' });
    },
  }),
  define({
    id: 'CONTAINER_DRUM', nameZh: '工业桶', nameEn: 'Industrial Drum', category: 'package', file: 'drum', level: 3,
    description: '典型工业桶造型，桶箍数量会改变桶身加强环结构。',
    parameters: {
      height: dimension(0.9, 0.18, 2.5), diameter: dimension(0.58, 0.12, 1.8), bandCount: count(3, 0, 6),
      lidStyle: choice('closed', ['closed', 'open', 'bung']), sides: count(24, 12, 32),
    },
    materials: { body: 'plastic_blue', bands: 'dark_steel', lid: 'steel' },
    build(builder, p) {
      const body = selectedMaterial(p, 'plastic_blue');
      addCylinder(builder, { radius: p.diameter / 2, height: p.height, segments: p.sides, center: [0, p.height / 2, 0], material: body });
      for (let i = 0; i < p.bandCount; i += 1) {
        const y = p.bandCount === 1 ? p.height / 2 : p.height * 0.14 + (p.height * 0.72 * i) / Math.max(1, p.bandCount - 1);
        addTorus(builder, { majorRadius: p.diameter / 2, tubeRadius: p.diameter * 0.024, radialSegments: 5, tubularSegments: p.sides, center: [0, y, 0], material: 'dark_steel' });
      }
      if (p.lidStyle !== 'open') {
        addCylinder(builder, { radius: p.diameter * 0.47, height: p.height * 0.025, segments: p.sides, center: [0, p.height + p.height * 0.0125, 0], material: 'steel' });
      }
      if (p.lidStyle === 'bung') {
        addCylinder(builder, { radius: p.diameter * 0.045, height: p.height * 0.035, segments: 10, center: [p.diameter * 0.28, p.height * 1.04, 0], material: 'dark_steel' });
      }
    },
  }),
  define({
    id: 'CONTAINER_BOTTLE', nameZh: '瓶', nameEn: 'Bottle', category: 'package', file: 'bottle', level: 3,
    description: '参数化瓶身、瓶肩、瓶颈和瓶盖，可作为塑料、玻璃或金属容器的通用外观。',
    parameters: {
      bodyHeight: dimension(0.55, 0.08, 2), bodyDiameter: dimension(0.25, 0.04, 1), neckHeight: dimension(0.16, 0.02, 0.7),
      neckDiameter: dimension(0.10, 0.015, 0.6), capHeight: dimension(0.055, 0.008, 0.25), shoulderRatio: ratio(0.18, 0.05, 0.38, 0.01),
      sides: count(18, 10, 28),
    },
    materials: { bottle: 'glass', cap: 'plastic_red' },
    build(builder, p) {
      const radius = p.bodyDiameter / 2;
      const neckRadius = Math.min(p.neckDiameter / 2, radius * 0.82);
      const shoulderHeight = p.bodyHeight * p.shoulderRatio;
      const profile = [
        [radius * 0.82, 0], [radius, p.bodyHeight * 0.05], [radius, p.bodyHeight - shoulderHeight],
        [radius * 0.88, p.bodyHeight - shoulderHeight * 0.55], [neckRadius, p.bodyHeight],
        [neckRadius, p.bodyHeight + p.neckHeight],
      ];
      addRevolved(builder, { profile, segments: p.sides, material: selectedMaterial(p, 'glass') });
      addCylinder(builder, {
        radius: neckRadius * 1.08, height: p.capHeight, segments: p.sides,
        center: [0, p.bodyHeight + p.neckHeight + p.capHeight / 2, 0], material: 'plastic_red',
      });
    },
  }),
];

/** The complete first-release catalogue in the canonical display order. */
export const MODEL_DEFINITIONS = Object.freeze([
  ...basicDefinitions,
  ...materialDefinitions,
  ...mechanicalDefinitions,
  ...electronicDefinitions,
  ...packageDefinitions,
]);

const definitionById = new Map(MODEL_DEFINITIONS.map((definition) => [definition.id, definition]));

/** Return a model definition by stable id. Unknown ids return null. */
export function getModelDefinition(id) {
  if (typeof id !== 'string') return null;
  return definitionById.get(id.toUpperCase()) ?? null;
}

function normalizeParameters(definition, overrides) {
  const result = {};
  for (const [key, schema] of Object.entries(definition.parameters)) {
    let value = Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : schema.default;
    if (schema.type === 'number' || schema.type === 'integer') {
      value = Number(value);
      if (!Number.isFinite(value)) value = Number(schema.default);
      if (schema.type === 'integer') value = Math.round(value);
      if (schema.min !== null) value = Math.max(schema.min, value);
      if (schema.max !== null) value = Math.min(schema.max, value);
    } else if (schema.type === 'boolean') {
      value = value === true || value === 'true' || value === 1;
    } else if (schema.type === 'enum') {
      if (schema.options.length > 0 && typeof schema.options[0] === 'number') value = Number(value);
      if (!schema.options.includes(value)) value = schema.default;
    } else if (value === null || value === undefined) {
      value = schema.default;
    } else {
      value = String(value);
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

/**
 * Build one parameterized low-poly model. Business-only Item fields such as
 * mass and stack size are intentionally rejected by omission from the schema.
 */
export function buildModel(id, overrides = {}) {
  const definition = getModelDefinition(id);
  if (!definition) throw new RangeError(`Unknown ForgeCore model definition: ${id}`);
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('Model parameter overrides must be an object.');
  }
  const parameters = normalizeParameters(definition, overrides);
  const builder = new MeshBuilder();
  definition.build(builder, parameters);
  return Object.freeze({ definition, parameters, geometry: builder.finalize() });
}
