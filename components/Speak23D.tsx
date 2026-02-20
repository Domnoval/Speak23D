"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FontLoader, Font } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { CSG } from "three-csg-ts";

// ─── Constants ────────────────────────────────────────────────────────────
const MM = 0.001;
const BUILD_MAX = { x: 256, y: 256, z: 256 };

// ─── Font Definitions ─────────────────────────────────────────────────────
interface FontDef {
  id: string;
  name: string;
  category: string;
  url: string;
  description: string;
}

const FONT_DEFS: FontDef[] = [
  {
    id: "helvetiker",
    name: "Helvetiker Bold",
    category: "Modern Sans",
    url: "https://cdn.jsdelivr.net/npm/three@0.175.0/examples/fonts/helvetiker_bold.typeface.json",
    description: "Clean, contemporary sans-serif",
  },
  {
    id: "optimer",
    name: "Optimer Bold",
    category: "Classic Serif",
    url: "/fonts/optimer_bold.typeface.json",
    description: "Elegant traditional serif",
  },
  {
    id: "playfair",
    name: "Playfair Display",
    category: "Classic Serif",
    url: "/fonts/playfair_display_bold.typeface.json",
    description: "High-contrast editorial serif",
  },
  {
    id: "black_ops",
    name: "Black Ops One",
    category: "Stencil / Industrial",
    url: "/fonts/black_ops_one.typeface.json",
    description: "Military stencil look",
  },
  {
    id: "poiret",
    name: "Poiret One",
    category: "Art Deco",
    url: "/fonts/poiret_one.typeface.json",
    description: "1920s geometric elegance",
  },
  {
    id: "pacifico",
    name: "Pacifico",
    category: "Script / Cursive",
    url: "/fonts/pacifico.typeface.json",
    description: "Thick brush script — great for names",
  },
  {
    id: "alfa_slab",
    name: "Alfa Slab One",
    category: "Slab Serif",
    url: "/fonts/alfa_slab_one.typeface.json",
    description: "Bold slab serif, readable from distance",
  },
];

// ─── Types ────────────────────────────────────────────────────────────────
interface Params {
  text: string;
  fontId: string;
  heightMM: number;
  depthMM: number;
  letterSpacing: number; // multiplier, 1.0 = default
  housing: boolean;
  ledType: "strip_5v" | "strip_12v" | "cob";
  mount: "french_cleat" | "keyhole" | "flat";
  weatherSeal: boolean;
  reflector: "parabolic" | "faceted" | "none";
}

const DEFAULT_PARAMS: Params = {
  text: "1234",
  fontId: "helvetiker",
  heightMM: 80,
  depthMM: 12,
  letterSpacing: 1.0,
  housing: true,
  ledType: "strip_5v",
  mount: "french_cleat",
  weatherSeal: false,
  reflector: "none",
};

const LED_CHANNELS: Record<string, [number, number]> = {
  strip_5v: [12, 4],
  strip_12v: [10, 3],
  cob: [8, 3],
};

// ─── Geometry Helpers ─────────────────────────────────────────────────────

function getBounds(meshes: THREE.Mesh[]): { min: THREE.Vector3; max: THREE.Vector3 } {
  const box = new THREE.Box3();
  meshes.forEach((m) => {
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox!.clone();
    b.applyMatrix4(m.matrixWorld);
    box.union(b);
  });
  return { min: box.min, max: box.max };
}

function makeMesh(geo: THREE.BufferGeometry, color = 0x888888): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.1 });
  const m = new THREE.Mesh(geo, mat);
  m.updateMatrixWorld(true);
  return m;
}

function boxMesh(w: number, h: number, d: number, color = 0x888888): THREE.Mesh {
  return makeMesh(new THREE.BoxGeometry(w, h, d), color);
}

function cylMesh(r: number, h: number, color = 0x888888, segs = 16): THREE.Mesh {
  return makeMesh(new THREE.CylinderGeometry(r, r, h, segs), color);
}

function safeCSG(base: THREE.Mesh, tool: THREE.Mesh, op: "subtract" | "union" | "intersect"): THREE.Mesh {
  try {
    base.updateMatrixWorld(true);
    tool.updateMatrixWorld(true);
    let result: THREE.Mesh;
    if (op === "subtract") result = CSG.subtract(base, tool);
    else if (op === "union") result = CSG.union(base, tool);
    else result = CSG.intersect(base, tool);
    result.material = base.material;
    return result;
  } catch {
    console.warn("CSG failed, returning base");
    return base;
  }
}

// ─── Assembly Generation ──────────────────────────────────────────────────

function createLetterMeshes(font: Font, params: Params): THREE.Mesh[] {
  const text = params.text.toUpperCase().replace(/[^A-Z0-9 ]/g, "");
  if (!text.trim()) return [];

  const h = params.heightMM * MM;
  const d = params.depthMM * MM;
  const spacing = params.letterSpacing;
  const meshes: THREE.Mesh[] = [];
  const widths: number[] = [];

  for (const ch of text) {
    if (ch === " ") {
      widths.push(h * 0.3);
      continue;
    }
    const geo = new TextGeometry(ch, {
      font,
      size: h,
      depth: d,
      curveSegments: 4,
      bevelEnabled: false,
    });
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    widths.push(bb.max.x - bb.min.x);
    geo.dispose();
  }

  const gap = h * 0.03 * spacing;
  let cursor = 0;
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (text.length - 1);
  const offsetX = -totalW / 2;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") {
      cursor += widths[i] * spacing + gap;
      continue;
    }
    const geo = new TextGeometry(ch, {
      font,
      size: h,
      depth: d,
      curveSegments: 4,
      bevelEnabled: false,
    });
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    geo.translate(-bb.min.x, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
    const mesh = makeMesh(geo, 0xcccccc);
    mesh.position.set(offsetX + cursor, 0, 0);
    mesh.updateMatrixWorld(true);
    meshes.push(mesh);
    cursor += widths[i] + gap;
  }
  return meshes;
}

function createFacePlate(letters: THREE.Mesh[], params: Params): THREE.Mesh {
  const { min, max } = getBounds(letters);
  const pad = 5 * MM;
  const thick = 1.5 * MM;
  const w = max.x - min.x + pad * 2;
  const h = max.y - min.y + pad * 2;
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;

  let plate = boxMesh(w, h, thick, 0xdddddd);
  plate.position.set(cx, cy, -thick / 2);
  plate.updateMatrixWorld(true);

  for (const letter of letters) {
    const clone = letter.clone();
    clone.updateMatrixWorld(true);
    plate = safeCSG(plate, clone, "union");
    plate.position.set(0, 0, 0);
    plate.updateMatrixWorld(true);
  }

  const tabR = 1.5 * MM;
  const tabL = 2 * MM;
  const tabPositions = [
    [cx - w * 0.35, cy, -thick - tabL / 2],
    [cx + w * 0.35, cy, -thick - tabL / 2],
    [cx, cy - h * 0.35, -thick - tabL / 2],
    [cx, cy + h * 0.35, -thick - tabL / 2],
  ];
  for (const [tx, ty, tz] of tabPositions) {
    const tab2 = cylMesh(tabR, tabL, 0xdddddd);
    tab2.position.set(tx, ty, tz);
    tab2.updateMatrixWorld(true);
    plate = safeCSG(plate, tab2, "union");
    plate.updateMatrixWorld(true);
  }

  plate.name = "FacePlate";
  return plate;
}

function createBackPlate(letters: THREE.Mesh[], params: Params): THREE.Mesh {
  const { min, max } = getBounds(letters);
  const pad = 5 * MM;
  const wallThick = 3 * MM;
  const plateThick = 3 * MM;
  const d = params.depthMM * MM;
  const rimH = d + 3 * MM;

  const innerW = max.x - min.x + pad * 2;
  const innerH = max.y - min.y + pad * 2;
  const outerW = innerW + wallThick * 2;
  const outerH = innerH + wallThick * 2;
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  const faceBack = -1.5 * MM;
  const backFront = faceBack - 2 * MM;
  const backZ = backFront - plateThick / 2;

  let back = boxMesh(outerW, outerH, plateThick, 0x666666);
  back.position.set(cx, cy, backZ);
  back.updateMatrixWorld(true);

  const rimZ = backFront + rimH / 2;
  let rimOuter = boxMesh(outerW, outerH, rimH, 0x666666);
  rimOuter.position.set(cx, cy, rimZ);
  rimOuter.updateMatrixWorld(true);
  const rimInner = boxMesh(innerW, innerH, rimH + 0.001, 0x666666);
  rimInner.position.set(cx, cy, rimZ);
  rimInner.updateMatrixWorld(true);
  rimOuter = safeCSG(rimOuter, rimInner, "subtract");
  rimOuter.updateMatrixWorld(true);
  back = safeCSG(back, rimOuter, "union");
  back.updateMatrixWorld(true);

  const [ledW, ledD] = LED_CHANNELS[params.ledType] || [12, 4];
  for (const letter of letters) {
    letter.geometry.computeBoundingBox();
    const bb = letter.geometry.boundingBox!.clone();
    bb.applyMatrix4(letter.matrixWorld);
    const lCx = (bb.min.x + bb.max.x) / 2;
    const lCy = (bb.min.y + bb.max.y) / 2;
    const chLen = (bb.max.y - bb.min.y) * 0.8;
    const chZ = backFront + ledD * MM / 2 + 0.0001;
    const ch = boxMesh(ledW * MM, Math.max(chLen, ledW * MM), ledD * MM, 0x666666);
    ch.position.set(lCx, lCy, chZ);
    ch.updateMatrixWorld(true);
    back = safeCSG(back, ch, "subtract");
    back.updateMatrixWorld(true);
  }

  const wireSize = 4 * MM;
  const wireZ = backFront + wireSize / 2 + 0.0001;
  const wire = boxMesh(innerW * 0.9, wireSize, wireSize, 0x666666);
  wire.position.set(cx, cy, wireZ);
  wire.updateMatrixWorld(true);
  back = safeCSG(back, wire, "subtract");
  back.updateMatrixWorld(true);

  const glandR = 4 * MM;
  const glandX = cx + outerW / 2;
  const glandZ = backFront + rimH * 0.3;
  const gland = cylMesh(glandR, wallThick * 3, 0x666666);
  gland.rotation.set(0, 0, Math.PI / 2);
  gland.position.set(glandX, cy, glandZ);
  gland.updateMatrixWorld(true);
  back = safeCSG(back, gland, "subtract");
  back.updateMatrixWorld(true);

  if (params.mount === "french_cleat") {
    const cleatW = outerW * 0.6;
    const cleatH = 10 * MM;
    const cleatD = 8 * MM;
    const cleatZ = backZ - plateThick / 2 - cleatD / 2;
    let cleat = boxMesh(cleatW, cleatH, cleatD, 0x666666);
    cleat.position.set(cx, cy, cleatZ);
    cleat.updateMatrixWorld(true);
    const cutter = boxMesh(cleatW + 0.001, cleatH, cleatD, 0x666666);
    cutter.position.set(cx, cy + cleatH * 0.4, cleatZ);
    cutter.rotation.set(Math.PI / 4, 0, 0);
    cutter.updateMatrixWorld(true);
    cleat = safeCSG(cleat, cutter, "subtract");
    cleat.updateMatrixWorld(true);
    back = safeCSG(back, cleat, "union");
    back.updateMatrixWorld(true);
  }

  back.name = "BackPlate";
  return back;
}

function createWallCleat(letters: THREE.Mesh[], params: Params): THREE.Mesh {
  const { min, max } = getBounds(letters);
  const pad = 5 * MM;
  const outerW = (max.x - min.x) + pad * 2 + 6 * MM;
  const cleatW = outerW * 0.6;
  const cleatH = 10 * MM;
  const cleatD = 8 * MM;
  const mountThick = 3 * MM;
  const mountH = cleatH * 3;

  let base = boxMesh(cleatW, mountH, mountThick, 0x999999);
  base.position.set(0, 0, -mountThick / 2);
  base.updateMatrixWorld(true);

  let cleat = boxMesh(cleatW, cleatH, cleatD, 0x999999);
  cleat.position.set(0, 0, mountThick / 2 + cleatD / 2);
  cleat.updateMatrixWorld(true);
  const cutter = boxMesh(cleatW + 0.001, cleatH, cleatD, 0x999999);
  cutter.position.set(0, -cleatH * 0.4, mountThick / 2 + cleatD / 2);
  cutter.rotation.set(-Math.PI / 4, 0, 0);
  cutter.updateMatrixWorld(true);
  cleat = safeCSG(cleat, cutter, "subtract");
  cleat.updateMatrixWorld(true);
  base = safeCSG(base, cleat, "union");
  base.updateMatrixWorld(true);

  for (const yOff of [-mountH * 0.3, mountH * 0.3]) {
    const hole = cylMesh(2.5 * MM, mountThick * 3, 0x999999);
    hole.position.set(0, yOff, 0);
    hole.updateMatrixWorld(true);
    base = safeCSG(base, hole, "subtract");
    base.updateMatrixWorld(true);
  }

  base.name = "WallCleat";
  return base;
}

function createDiffuser(letters: THREE.Mesh[]): THREE.Mesh {
  const { min, max } = getBounds(letters);
  const pad = 4 * MM;
  const w = max.x - min.x + pad * 2;
  const h = max.y - min.y + pad * 2;
  const thick = 0.8 * MM;
  const diff = boxMesh(w, h, thick, 0xffffff);
  diff.name = "Diffuser";
  return diff;
}

// ─── STL Export ───────────────────────────────────────────────────────────

function exportSTL(mesh: THREE.Mesh): Blob {
  const exporter = new STLExporter();
  const clone = mesh.clone();
  clone.scale.multiplyScalar(1000);
  clone.updateMatrixWorld(true);
  const data = exporter.parse(clone, { binary: true });
  return new Blob([data], { type: "application/octet-stream" });
}

function export3MF(mesh: THREE.Mesh): Blob {
  const clone = mesh.clone();
  clone.scale.multiplyScalar(1000);
  clone.updateMatrixWorld(true);
  const geo = clone.geometry.clone();
  geo.applyMatrix4(clone.matrixWorld);

  const pos = geo.getAttribute("position");
  const idx = geo.index;

  const vertMap = new Map<string, number>();
  const verts: number[][] = [];
  const tris: number[][] = [];

  const getVert = (i: number): number => {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
    if (vertMap.has(key)) return vertMap.get(key)!;
    const id = verts.length;
    vertMap.set(key, id);
    verts.push([x, y, z]);
    return id;
  };

  const count = idx ? idx.count : pos.count;
  for (let i = 0; i < count; i += 3) {
    const a = idx ? idx.getX(i) : i;
    const b = idx ? idx.getX(i + 1) : i + 1;
    const c = idx ? idx.getX(i + 2) : i + 2;
    tris.push([getVert(a), getVert(b), getVert(c)]);
  }

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
${verts.map((v) => `          <vertex x="${v[0]}" y="${v[1]}" z="${v[2]}" />`).join("\n")}
        </vertices>
        <triangles>
${tris.map((t) => `          <triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}" />`).join("\n")}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  return createZipBlob({
    "[Content_Types].xml": contentTypes,
    "_rels/.rels": rels,
    "3D/3dmodel.model": model,
  });
}

function createZipBlob(files: Record<string, string>): Blob {
  const entries: { name: Uint8Array; data: Uint8Array; offset: number }[] = [];
  const parts: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = new TextEncoder().encode(name);
    const dataBytes = new TextEncoder().encode(content);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(localHeader.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint32(14, crc32(dataBytes), true);
    dv.setUint32(18, dataBytes.length, true);
    dv.setUint32(22, dataBytes.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    entries.push({ name: nameBytes, data: dataBytes, offset });
    parts.push(localHeader);
    parts.push(dataBytes);
    offset += localHeader.length + dataBytes.length;
  }

  const cdParts: Uint8Array[] = [];
  let cdSize = 0;
  for (const entry of entries) {
    const cd = new Uint8Array(46 + entry.name.length);
    const dv = new DataView(cd.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0, true);
    dv.setUint16(14, 0, true);
    dv.setUint32(16, crc32(entry.data), true);
    dv.setUint32(20, entry.data.length, true);
    dv.setUint32(24, entry.data.length, true);
    dv.setUint16(28, entry.name.length, true);
    dv.setUint16(30, 0, true);
    dv.setUint16(32, 0, true);
    dv.setUint16(34, 0, true);
    dv.setUint16(36, 0, true);
    dv.setUint32(38, 0, true);
    dv.setUint32(42, entry.offset, true);
    cd.set(entry.name, 46);
    cdParts.push(cd);
    cdSize += cd.length;
  }

  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(4, 0, true);
  dv.setUint16(6, 0, true);
  dv.setUint16(8, entries.length, true);
  dv.setUint16(10, entries.length, true);
  dv.setUint32(12, cdSize, true);
  dv.setUint32(16, offset, true);
  dv.setUint16(20, 0, true);

  const allParts: BlobPart[] = [...parts.map(p => p.buffer as ArrayBuffer), ...cdParts.map(p => p.buffer as ArrayBuffer), eocd.buffer as ArrayBuffer];
  return new Blob(allParts, { type: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml" });
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ─── Component ────────────────────────────────────────────────────────────

export default function Speak23D() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const fontsRef = useRef<Map<string, Font>>(new Map());
  const assemblyRef = useRef<{
    face?: THREE.Mesh;
    back?: THREE.Mesh;
    cleat?: THREE.Mesh;
    diffuser?: THREE.Mesh;
    letters: THREE.Mesh[];
  }>({ letters: [] });

  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [generating, setGenerating] = useState(false);
  const [fontsLoaded, setFontsLoaded] = useState<Set<string>>(new Set());
  const [loadingFont, setLoadingFont] = useState<string | null>(null);
  const [dims, setDims] = useState<string>("");
  const [status, setStatus] = useState("Loading fonts...");

  // Load a font on demand
  const loadFont = useCallback((fontId: string): Promise<Font> => {
    return new Promise((resolve, reject) => {
      if (fontsRef.current.has(fontId)) {
        resolve(fontsRef.current.get(fontId)!);
        return;
      }
      const def = FONT_DEFS.find((f) => f.id === fontId);
      if (!def) {
        reject(new Error(`Unknown font: ${fontId}`));
        return;
      }
      setLoadingFont(fontId);
      const loader = new FontLoader();
      loader.load(
        def.url,
        (font) => {
          fontsRef.current.set(fontId, font);
          setFontsLoaded((prev) => new Set([...prev, fontId]));
          setLoadingFont(null);
          resolve(font);
        },
        undefined,
        () => {
          setLoadingFont(null);
          reject(new Error(`Failed to load font: ${def.name}`));
        }
      );
    });
  }, []);

  // Init Three.js
  useEffect(() => {
    if (!canvasRef.current) return;
    const container = canvasRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.001, 10);
    camera.position.set(0, 0, 0.4);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.position.set(0.5, 0.5, 1);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3);
    fill.position.set(-0.5, -0.3, 0.5);
    scene.add(fill);

    const grid = new THREE.GridHelper(0.5, 50, 0x333355, 0x222244);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.02;
    scene.add(grid);

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", handleResize);

    // Load default font
    loadFont("helvetiker").then(() => {
      setStatus("Ready — enter your text and click Generate");
    }).catch(() => {
      setStatus("Error loading default font");
    });

    return () => {
      window.removeEventListener("resize", handleResize);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [loadFont]);

  const clearScene = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const toRemove = scene.children.filter(
      (c) => c.type === "Mesh" || c.type === "Group"
    );
    toRemove.forEach((c) => scene.remove(c));
    assemblyRef.current = { letters: [] };
  }, []);

  const generate = useCallback(async () => {
    if (!sceneRef.current) return;
    setGenerating(true);
    setStatus("Loading font...");

    try {
      const font = await loadFont(params.fontId);
      clearScene();
      setStatus("Generating 3D model...");

      // Use setTimeout to let UI update
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          try {
            const scene = sceneRef.current!;
            const letters = createLetterMeshes(font, params);

            if (letters.length === 0) {
              setStatus("No valid characters to generate");
              setGenerating(false);
              resolve();
              return;
            }

            if (params.housing) {
              setStatus("Building face plate...");
              const face = createFacePlate(letters, params);
              scene.add(face);

              setStatus("Building back plate...");
              const back = createBackPlate(letters, params);
              scene.add(back);

              assemblyRef.current.face = face;
              assemblyRef.current.back = back;

              if (params.mount === "french_cleat") {
                setStatus("Building wall cleat...");
                const cleat = createWallCleat(letters, params);
                cleat.position.set(0, -0.1, 0);
                cleat.updateMatrixWorld(true);
                scene.add(cleat);
                assemblyRef.current.cleat = cleat;
              }

              const diffuser = createDiffuser(letters);
              assemblyRef.current.diffuser = diffuser;
            } else {
              letters.forEach((l) => scene.add(l));
            }

            assemblyRef.current.letters = letters;

            const allMeshes = scene.children.filter((c): c is THREE.Mesh => c.type === "Mesh");
            if (allMeshes.length > 0) {
              const { min, max } = getBounds(allMeshes);
              const sx = ((max.x - min.x) * 1000).toFixed(1);
              const sy = ((max.y - min.y) * 1000).toFixed(1);
              const sz = ((max.z - min.z) * 1000).toFixed(1);
              setDims(`${sx} × ${sy} × ${sz} mm`);

              const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
              cameraRef.current!.position.set(0, -size * 0.3, size * 2.5);
              controlsRef.current!.target.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
              controlsRef.current!.update();
            }

            const fontDef = FONT_DEFS.find((f) => f.id === params.fontId);
            setStatus(`✓ Model generated with ${fontDef?.name || params.fontId}`);
          } catch (err: unknown) {
            setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
          }
          setGenerating(false);
          resolve();
        }, 50);
      });
    } catch (err: unknown) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setGenerating(false);
    }
  }, [params, clearScene, loadFont]);

  const downloadFile = useCallback((mesh: THREE.Mesh, name: string, format: "stl" | "3mf") => {
    const blob = format === "stl" ? exportSTL(mesh) : export3MF(mesh);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const update = (key: keyof Params, val: string | number | boolean) => {
    setParams((p) => ({ ...p, [key]: val }));
  };

  // Group fonts by category for dropdown
  const fontsByCategory = FONT_DEFS.reduce<Record<string, FontDef[]>>((acc, f) => {
    if (!acc[f.category]) acc[f.category] = [];
    acc[f.category].push(f);
    return acc;
  }, {});

  return (
    <div className="flex flex-col lg:flex-row h-screen">
      {/* Controls Panel */}
      <div className="w-full lg:w-96 bg-zinc-900 border-r border-zinc-800 overflow-y-auto p-6 flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
            Speak23D
          </h1>
          <p className="text-zinc-400 text-sm mt-1">3D Printable Backlit House Numbers</p>
        </div>

        {/* Text Input */}
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Text</label>
          <input
            type="text"
            value={params.text}
            onChange={(e) => update("text", e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-lg font-mono tracking-wider focus:border-blue-500 focus:outline-none"
            placeholder="1234"
            maxLength={12}
          />
          <p className="text-zinc-500 text-xs mt-1">Letters, numbers, spaces. Max 12 chars.</p>
        </div>

        {/* Font Selection */}
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Font</label>
          <select
            value={params.fontId}
            onChange={(e) => update("fontId", e.target.value)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
          >
            {Object.entries(fontsByCategory).map(([category, fonts]) => (
              <optgroup key={category} label={category}>
                {fonts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="text-zinc-500 text-xs mt-1">
            {FONT_DEFS.find((f) => f.id === params.fontId)?.description}
            {loadingFont && ` (loading ${FONT_DEFS.find((f) => f.id === loadingFont)?.name}...)`}
          </p>
        </div>

        {/* Size Controls */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Height: {params.heightMM}mm
            </label>
            <input
              type="range"
              value={params.heightMM}
              onChange={(e) => update("heightMM", Number(e.target.value))}
              className="w-full accent-blue-500"
              min={20}
              max={200}
              step={5}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-1">
              Depth: {params.depthMM}mm
            </label>
            <input
              type="range"
              value={params.depthMM}
              onChange={(e) => update("depthMM", Number(e.target.value))}
              className="w-full accent-blue-500"
              min={5}
              max={30}
              step={1}
            />
          </div>
        </div>

        {/* Letter Spacing */}
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">
            Letter Spacing: {params.letterSpacing.toFixed(1)}×
          </label>
          <input
            type="range"
            value={params.letterSpacing}
            onChange={(e) => update("letterSpacing", Number(e.target.value))}
            className="w-full accent-purple-500"
            min={0.5}
            max={3.0}
            step={0.1}
          />
          <div className="flex justify-between text-xs text-zinc-600">
            <span>Tight</span>
            <span>Normal</span>
            <span>Wide</span>
          </div>
        </div>

        {/* Housing Toggle */}
        <div className="flex items-center justify-between bg-zinc-800 rounded-lg px-4 py-3">
          <div>
            <p className="text-sm font-medium text-zinc-200">Full Housing Assembly</p>
            <p className="text-xs text-zinc-500">Face plate + back plate + LED channels + mounting</p>
          </div>
          <button
            onClick={() => update("housing", !params.housing)}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              params.housing ? "bg-blue-500" : "bg-zinc-600"
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                params.housing ? "translate-x-6" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {/* Housing Options */}
        {params.housing && (
          <div className="space-y-3 pl-3 border-l-2 border-blue-500/30">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">LED Type</label>
              <select
                value={params.ledType}
                onChange={(e) => update("ledType", e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="strip_5v">LED Strip 5V (12mm wide)</option>
                <option value="strip_12v">LED Strip 12V (10mm wide)</option>
                <option value="cob">COB LED (8mm wide)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Mounting</label>
              <select
                value={params.mount}
                onChange={(e) => update("mount", e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="french_cleat">French Cleat</option>
                <option value="keyhole">Keyhole Slots</option>
                <option value="flat">Flat (adhesive)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">Reflector</label>
              <select
                value={params.reflector}
                onChange={(e) => update("reflector", e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="none">None</option>
                <option value="parabolic">Parabolic</option>
                <option value="faceted">Faceted</option>
              </select>
            </div>
          </div>
        )}

        {/* Generate Button */}
        <button
          onClick={generate}
          disabled={generating}
          className="w-full py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {generating ? "⏳ Generating..." : "🎨 Generate 3D Model"}
        </button>

        {/* Status */}
        <p className="text-sm text-zinc-400">{status}</p>
        {dims && (
          <p className="text-sm text-zinc-300">
            📐 Dimensions: <span className="font-mono text-blue-400">{dims}</span>
          </p>
        )}

        {/* Downloads */}
        {assemblyRef.current.face && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide">Downloads</h3>
            {params.housing ? (
              <>
                <DownloadBtn
                  label="Face Plate"
                  onSTL={() => downloadFile(assemblyRef.current.face!, "face_plate", "stl")}
                  on3MF={() => downloadFile(assemblyRef.current.face!, "face_plate", "3mf")}
                />
                <DownloadBtn
                  label="Back Plate"
                  onSTL={() => downloadFile(assemblyRef.current.back!, "back_plate", "stl")}
                  on3MF={() => downloadFile(assemblyRef.current.back!, "back_plate", "3mf")}
                />
                {assemblyRef.current.cleat && (
                  <DownloadBtn
                    label="Wall Cleat"
                    onSTL={() => downloadFile(assemblyRef.current.cleat!, "wall_cleat", "stl")}
                    on3MF={() => downloadFile(assemblyRef.current.cleat!, "wall_cleat", "3mf")}
                  />
                )}
                {assemblyRef.current.diffuser && (
                  <DownloadBtn
                    label="Diffuser"
                    onSTL={() => downloadFile(assemblyRef.current.diffuser!, "diffuser", "stl")}
                    on3MF={() => downloadFile(assemblyRef.current.diffuser!, "diffuser", "3mf")}
                  />
                )}
              </>
            ) : (
              assemblyRef.current.letters.map((l, i) => (
                <DownloadBtn
                  key={i}
                  label={`Letter "${params.text[i]}"`}
                  onSTL={() => downloadFile(l, `letter_${params.text[i]}`, "stl")}
                  on3MF={() => downloadFile(l, `letter_${params.text[i]}`, "3mf")}
                />
              ))
            )}
          </div>
        )}

        <div className="mt-auto pt-4 border-t border-zinc-800">
          <p className="text-xs text-zinc-600">
            Speak23D by Tonic Thought Studios • Generates Bambu-compatible 3MF files •{" "}
            <span className="text-zinc-500">100% client-side — no server needed</span>
          </p>
        </div>
      </div>

      {/* 3D Viewport */}
      <div ref={canvasRef} className="flex-1 relative min-h-[400px]">
        <div className="absolute top-4 left-4 bg-zinc-900/80 backdrop-blur rounded-lg px-3 py-1.5 text-xs text-zinc-400">
          🖱️ Drag to rotate • Scroll to zoom • Right-click to pan
        </div>
      </div>
    </div>
  );
}

function DownloadBtn({ label, onSTL, on3MF }: { label: string; onSTL: () => void; on3MF: () => void }) {
  return (
    <div className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2">
      <span className="text-sm text-zinc-300 flex-1">{label}</span>
      <button
        onClick={onSTL}
        className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded font-mono"
      >
        STL
      </button>
      <button
        onClick={on3MF}
        className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded font-mono"
      >
        3MF
      </button>
    </div>
  );
}
