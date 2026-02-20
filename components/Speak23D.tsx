"use client";

import React, { useRef, useState, useEffect, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FontLoader, Font } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { CSG } from "three-csg-ts";

const MM = 0.001;

type BackplateShape = "rectangle" | "rounded_rect" | "oval" | "arch" | "auto_contour";
type MountType = "none" | "2hole" | "4hole" | "french_cleat" | "keyhole";
type LineAlign = "left" | "center" | "right";

interface LineConfig { text: string; align: LineAlign; }

interface Params {
  lines: LineConfig[];
  font: string;
  heightMM: number;
  depthMM: number;
  paddingMM: number;
  wallThickMM: number;
  scaleFactor: number;
  housing: boolean;
  ledType: "strip_5v" | "strip_12v" | "cob";
  backplateShape: BackplateShape;
  cornerRadiusMM: number;
  mountType: MountType;
  holeDiameterMM: number;
  lineSpacingMM: number;
  weatherSeal: boolean;
  reflector: "parabolic" | "faceted" | "none";
}

const DEFAULT_PARAMS: Params = {
  lines: [{ text: "1234", align: "center" }],
  font: "helvetiker",
  heightMM: 80,
  depthMM: 12,
  paddingMM: 8,
  wallThickMM: 3,
  scaleFactor: 1.0,
  housing: true,
  ledType: "strip_5v",
  backplateShape: "rectangle",
  cornerRadiusMM: 10,
  mountType: "french_cleat",
  holeDiameterMM: 5,
  lineSpacingMM: 5,
  weatherSeal: false,
  reflector: "none",
};

const LED_CHANNELS: Record<string, [number, number]> = {
  strip_5v: [12, 4],
  strip_12v: [10, 3],
  cob: [8, 3],
};

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

function cylMesh(r: number, h: number, color = 0x888888, segs = 32): THREE.Mesh {
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

function createRoundedRectShape(w: number, h: number, r: number): THREE.Shape {
  r = Math.min(r, w / 2, h / 2);
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  shape.lineTo(w / 2, h / 2 - r);
  shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return shape;
}

function createOvalShape(w: number, h: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, false, 0);
  return shape;
}

function createArchShape(w: number, h: number): THREE.Shape {
  const shape = new THREE.Shape();
  const r = w / 2;
  const straightH = h - r;
  if (straightH <= 0) {
    shape.moveTo(-r, 0);
    shape.absarc(0, 0, r, Math.PI, 0, false);
    shape.lineTo(-r, 0);
  } else {
    shape.moveTo(-r, -straightH / 2);
    shape.lineTo(r, -straightH / 2);
    shape.lineTo(r, straightH / 2);
    shape.absarc(0, straightH / 2, r, 0, Math.PI, false);
    shape.lineTo(-r, -straightH / 2);
  }
  return shape;
}

function createBackplateShapeMesh(
  w: number, h: number, thick: number,
  shapeType: BackplateShape, cornerR: number, color = 0x666666
): THREE.Mesh {
  let shape: THREE.Shape;
  switch (shapeType) {
    case "rounded_rect":
      shape = createRoundedRectShape(w, h, cornerR);
      break;
    case "oval":
      shape = createOvalShape(w, h);
      break;
    case "arch":
      shape = createArchShape(w, h);
      break;
    case "auto_contour":
      shape = createRoundedRectShape(w, h, Math.min(w, h) * 0.3);
      break;
    default:
      shape = new THREE.Shape();
      shape.moveTo(-w / 2, -h / 2);
      shape.lineTo(w / 2, -h / 2);
      shape.lineTo(w / 2, h / 2);
      shape.lineTo(-w / 2, h / 2);
      shape.lineTo(-w / 2, -h / 2);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  geo.translate(0, 0, -thick / 2);
  return makeMesh(geo, color);
}

function createRimFromShape(
  w: number, h: number, rimH: number, wallThick: number,
  shapeType: BackplateShape, cornerR: number, color = 0x666666
): THREE.Mesh {
  const innerW = w - wallThick * 2;
  const innerH = h - wallThick * 2;
  const innerCornerR = Math.max(0, cornerR - wallThick);
  let outer = createBackplateShapeMesh(w, h, rimH, shapeType, cornerR, color);
  outer.updateMatrixWorld(true);
  const inner = createBackplateShapeMesh(innerW, innerH, rimH + 0.001, shapeType, innerCornerR, color);
  inner.updateMatrixWorld(true);
  outer = safeCSG(outer, inner, "subtract");
  return outer;
}

function createMultiLineLetterMeshes(font: Font, params: Params): THREE.Mesh[] {
  const h = params.heightMM * MM * params.scaleFactor;
  const d = params.depthMM * MM * params.scaleFactor;
  const lineSpacing = params.lineSpacingMM * MM * params.scaleFactor;
  const allMeshes: THREE.Mesh[] = [];

  interface LineMeasure { meshes: THREE.Mesh[]; width: number; config: LineConfig; }
  const lineMeasures: LineMeasure[] = [];

  for (const lineConf of params.lines) {
    const text = lineConf.text.toUpperCase().replace(/[^A-Z0-9 .#\-]/g, "");
    if (!text.trim()) { lineMeasures.push({ meshes: [], width: 0, config: lineConf }); continue; }

    const meshes: THREE.Mesh[] = [];
    const widths: number[] = [];
    for (const ch of text) {
      if (ch === " ") { widths.push(h * 0.3); continue; }
      const geo = new TextGeometry(ch, { font, size: h, depth: d, curveSegments: 4, bevelEnabled: false });
      geo.computeBoundingBox();
      widths.push(geo.boundingBox!.max.x - geo.boundingBox!.min.x);
      geo.dispose();
    }

    const gap = h * 0.03;
    let cursor = 0;
    const totalW = widths.reduce((a, b) => a + b, 0) + gap * (text.length - 1);
    let charIdx = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === " ") { cursor += widths[charIdx] + gap; charIdx++; continue; }
      const geo = new TextGeometry(ch, { font, size: h, depth: d, curveSegments: 4, bevelEnabled: false });
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      geo.translate(-bb.min.x, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
      const mesh = makeMesh(geo, 0xcccccc);
      mesh.position.set(cursor, 0, 0);
      mesh.updateMatrixWorld(true);
      meshes.push(mesh);
      cursor += widths[charIdx] + gap;
      charIdx++;
    }
    lineMeasures.push({ meshes, width: totalW, config: lineConf });
  }

  const totalHeight = lineMeasures.length * h + (lineMeasures.length - 1) * lineSpacing;
  let yPos = totalHeight / 2 - h / 2;
  const maxWidth = Math.max(...lineMeasures.map((l) => l.width), 0.001);

  for (const line of lineMeasures) {
    let offsetX = 0;
    switch (line.config.align) {
      case "left": offsetX = -maxWidth / 2; break;
      case "right": offsetX = maxWidth / 2 - line.width; break;
      default: offsetX = -line.width / 2;
    }
    for (const mesh of line.meshes) {
      mesh.position.x += offsetX;
      mesh.position.y += yPos;
      mesh.updateMatrixWorld(true);
      allMeshes.push(mesh);
    }
    yPos -= h + lineSpacing;
  }
  return allMeshes;
}

function createFacePlate(letters: THREE.Mesh[], params: Params): THREE.Mesh {
  const { min, max } = getBounds(letters);
  const pad = params.paddingMM * MM * params.scaleFactor;
  const thick = 1.5 * MM * params.scaleFactor;
  const w = max.x - min.x + pad * 2;
  const h = max.y - min.y + pad * 2;
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  const cornerR = params.cornerRadiusMM * MM * params.scaleFactor;

  let plate = createBackplateShapeMesh(w, h, thick, params.backplateShape, cornerR, 0xdddddd);
  plate.position.set(cx, cy, -thick / 2);
  plate.updateMatrixWorld(true);

  for (const letter of letters) {
    const clone = letter.clone();
    clone.updateMatrixWorld(true);
    plate = safeCSG(plate, clone, "union");
    plate.position.set(0, 0, 0);
    plate.updateMatrixWorld(true);
  }
  plate.name = "FacePlate";
  return plate;
}

function addMountingHoles(mesh: THREE.Mesh, params: Params, outerW: number, outerH: number, cx: number, cy: number, plateThick: number, backZ: number): THREE.Mesh {
  const holeR = (params.holeDiameterMM / 2) * MM * params.scaleFactor;
  const inset = params.paddingMM * MM * params.scaleFactor * 0.6;
  let result = mesh;

  const holePositions: [number, number][] = [];
  switch (params.mountType) {
    case "2hole":
      holePositions.push([cx - outerW / 2 + inset, cy + outerH / 2 - inset], [cx + outerW / 2 - inset, cy + outerH / 2 - inset]);
      break;
    case "4hole":
      holePositions.push(
        [cx - outerW / 2 + inset, cy + outerH / 2 - inset], [cx + outerW / 2 - inset, cy + outerH / 2 - inset],
        [cx - outerW / 2 + inset, cy - outerH / 2 + inset], [cx + outerW / 2 - inset, cy - outerH / 2 + inset]
      );
      break;
    case "keyhole": {
      const bigR = holeR;
      const slotR = holeR * 0.5;
      const slotLen = holeR * 2;
      const positions: [number, number][] = [[cx - outerW * 0.3, cy], [cx + outerW * 0.3, cy]];
      for (const [hx, hy] of positions) {
        const big = cylMesh(bigR, plateThick * 3, 0x666666);
        big.rotation.set(Math.PI / 2, 0, 0);
        big.position.set(hx, hy, backZ);
        big.updateMatrixWorld(true);
        result = safeCSG(result, big, "subtract");
        result.updateMatrixWorld(true);
        const slot = boxMesh(slotR * 2, slotLen, plateThick * 3, 0x666666);
        slot.position.set(hx, hy + slotLen / 2, backZ);
        slot.updateMatrixWorld(true);
        result = safeCSG(result, slot, "subtract");
        result.updateMatrixWorld(true);
      }
      return result;
    }
    default: return result;
  }

  for (const [hx, hy] of holePositions) {
    const hole = cylMesh(holeR, plateThick * 3, 0x666666);
    hole.rotation.set(Math.PI / 2, 0, 0);
    hole.position.set(hx, hy, backZ);
    hole.updateMatrixWorld(true);
    result = safeCSG(result, hole, "subtract");
    result.updateMatrixWorld(true);
  }
  return result;
}

function createBackPlate(letters: THREE.Mesh[], params: Params): THREE.Mesh {
  const { min, max } = getBounds(letters);
  const pad = params.paddingMM * MM * params.scaleFactor;
  const wallThick = params.wallThickMM * MM * params.scaleFactor;
  const plateThick = params.wallThickMM * MM * params.scaleFactor;
  const d = params.depthMM * MM * params.scaleFactor;
  const rimH = d + 3 * MM * params.scaleFactor;
  const cornerR = params.cornerRadiusMM * MM * params.scaleFactor;

  const innerW = max.x - min.x + pad * 2;
  const innerH = max.y - min.y + pad * 2;
  const outerW = innerW + wallThick * 2;
  const outerH = innerH + wallThick * 2;
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  const faceBack = -1.5 * MM * params.scaleFactor;
  const backFront = faceBack - 2 * MM * params.scaleFactor;
  const backZ = backFront - plateThick / 2;

  let back = createBackplateShapeMesh(outerW, outerH, plateThick, params.backplateShape, cornerR, 0x666666);
  back.position.set(cx, cy, backZ);
  back.updateMatrixWorld(true);

  const rimZ = backFront + rimH / 2;
  let rim = createRimFromShape(outerW, outerH, rimH, wallThick, params.backplateShape, cornerR, 0x666666);
  rim.position.set(cx, cy, rimZ);
  rim.updateMatrixWorld(true);
  back = safeCSG(back, rim, "union");
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

  const wireSize = 4 * MM * params.scaleFactor;
  const wireZ = backFront + wireSize / 2 + 0.0001;
  const wire = boxMesh(innerW * 0.9, wireSize, wireSize, 0x666666);
  wire.position.set(cx, cy, wireZ);
  wire.updateMatrixWorld(true);
  back = safeCSG(back, wire, "subtract");
  back.updateMatrixWorld(true);

  const glandR = 4 * MM * params.scaleFactor;
  const glandX = cx + outerW / 2;
  const glandZ = backFront + rimH * 0.3;
  const gland = cylMesh(glandR, wallThick * 3, 0x666666);
  gland.rotation.set(0, 0, Math.PI / 2);
  gland.position.set(glandX, cy, glandZ);
  gland.updateMatrixWorld(true);
  back = safeCSG(back, gland, "subtract");
  back.updateMatrixWorld(true);

  if (params.mountType === "french_cleat") {
    const cleatW = outerW * 0.6;
    const cleatH = 10 * MM * params.scaleFactor;
    const cleatD = 8 * MM * params.scaleFactor;
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
  } else if (params.mountType !== "none") {
    back = addMountingHoles(back, params, outerW, outerH, cx, cy, plateThick, backZ);
  }

  back.name = "BackPlate";
  return back;
}

function createWallCleat(letters: THREE.Mesh[], params: Params): THREE.Mesh {
  const { min, max } = getBounds(letters);
  const pad = params.paddingMM * MM * params.scaleFactor;
  const wallThick = params.wallThickMM * MM * params.scaleFactor;
  const outerW = (max.x - min.x) + pad * 2 + wallThick * 2;
  const cleatW = outerW * 0.6;
  const cleatH = 10 * MM * params.scaleFactor;
  const cleatD = 8 * MM * params.scaleFactor;
  const mountThick = 3 * MM * params.scaleFactor;
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
    const hole = cylMesh(2.5 * MM * params.scaleFactor, mountThick * 3, 0x999999);
    hole.position.set(0, yOff, 0);
    hole.updateMatrixWorld(true);
    base = safeCSG(base, hole, "subtract");
    base.updateMatrixWorld(true);
  }
  base.name = "WallCleat";
  return base;
}

function createDiffuser(letters: THREE.Mesh[], params: Params): THREE.Mesh {
  const { min, max } = getBounds(letters);
  const pad = (params.paddingMM - 1) * MM * params.scaleFactor;
  const w = max.x - min.x + pad * 2;
  const h = max.y - min.y + pad * 2;
  const thick = 0.8 * MM * params.scaleFactor;
  const diff = boxMesh(w, h, thick, 0xffffff);
  diff.name = "Diffuser";
  return diff;
}

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
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
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
  <resources><object id="1" type="model"><mesh>
    <vertices>${verts.map((v) => `<vertex x="${v[0]}" y="${v[1]}" z="${v[2]}" />`).join("")}</vertices>
    <triangles>${tris.map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}" />`).join("")}</triangles>
  </mesh></object></resources>
  <build><item objectid="1" /></build>
</model>`;
  const ct = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" /></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" /></Relationships>`;
  return createZipBlob({ "[Content_Types].xml": ct, "_rels/.rels": rels, "3D/3dmodel.model": model });
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
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(8, 0, true);
    dv.setUint32(14, crc32(dataBytes), true); dv.setUint32(18, dataBytes.length, true);
    dv.setUint32(22, dataBytes.length, true); dv.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    entries.push({ name: nameBytes, data: dataBytes, offset });
    parts.push(localHeader, dataBytes);
    offset += localHeader.length + dataBytes.length;
  }
  const cdParts: Uint8Array[] = [];
  let cdSize = 0;
  for (const entry of entries) {
    const cd = new Uint8Array(46 + entry.name.length);
    const dv = new DataView(cd.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true);
    dv.setUint32(16, crc32(entry.data), true); dv.setUint32(20, entry.data.length, true);
    dv.setUint32(24, entry.data.length, true); dv.setUint16(28, entry.name.length, true);
    dv.setUint32(42, entry.offset, true);
    cd.set(entry.name, 46);
    cdParts.push(cd);
    cdSize += cd.length;
  }
  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true); dv.setUint16(8, entries.length, true);
  dv.setUint16(10, entries.length, true); dv.setUint32(12, cdSize, true); dv.setUint32(16, offset, true);
  return new Blob([...parts.map(p => p.buffer as ArrayBuffer), ...cdParts.map(p => p.buffer as ArrayBuffer), eocd.buffer as ArrayBuffer]);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[i] = c; }
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function Slider({ label, value, onChange, min, max, step = 1, unit = "" }: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number; unit?: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-zinc-300">{label}</span>
        <span className="text-blue-400 font-mono">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-500 h-1.5 bg-zinc-700 rounded-lg cursor-pointer" />
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-300 mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none text-sm">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function DownloadBtn({ label, onSTL, on3MF }: { label: string; onSTL: () => void; on3MF: () => void }) {
  return (
    <div className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2">
      <span className="text-sm text-zinc-300 flex-1">{label}</span>
      <button onClick={onSTL} className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded font-mono">STL</button>
      <button onClick={on3MF} className="px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded font-mono">3MF</button>
    </div>
  );
}

export default function Speak23D() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const fontRef = useRef<Font | null>(null);
  const assemblyRef = useRef<{
    face?: THREE.Mesh; back?: THREE.Mesh; cleat?: THREE.Mesh; diffuser?: THREE.Mesh; letters: THREE.Mesh[];
  }>({ letters: [] });

  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [generating, setGenerating] = useState(false);
  const [fontLoaded, setFontLoaded] = useState(false);
  const [dims, setDims] = useState("");
  const [status, setStatus] = useState("Loading font...");
  const [hasGenerated, setHasGenerated] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    dimensions: true, shape: false, mounting: false, multiline: false, led: false,
  });

  const toggleSection = (s: string) => setExpandedSections((prev) => ({ ...prev, [s]: !prev[s] }));

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
    const animate = () => { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();
    const handleResize = () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener("resize", handleResize);
    const loader = new FontLoader();
    loader.load("https://cdn.jsdelivr.net/npm/three@0.175.0/examples/fonts/helvetiker_bold.typeface.json", (font) => {
      fontRef.current = font; setFontLoaded(true); setStatus("Ready — enter text and click Generate");
    }, undefined, () => setStatus("Error loading font"));
    return () => { window.removeEventListener("resize", handleResize); renderer.dispose(); container.removeChild(renderer.domElement); };
  }, []);

  const clearScene = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.children.filter((c) => c.type === "Mesh").forEach((c) => scene.remove(c));
    assemblyRef.current = { letters: [] };
  }, []);

  const generate = useCallback(() => {
    if (!fontRef.current || !sceneRef.current) return;
    setGenerating(true);
    setStatus("Generating 3D model...");
    clearScene();
    setTimeout(() => {
      try {
        const font = fontRef.current!;
        const scene = sceneRef.current!;
        const letters = createMultiLineLetterMeshes(font, params);
        if (letters.length === 0) { setStatus("No valid characters"); setGenerating(false); return; }
        if (params.housing) {
          const face = createFacePlate(letters, params);
          scene.add(face);
          assemblyRef.current.face = face;
          const back = createBackPlate(letters, params);
          scene.add(back);
          assemblyRef.current.back = back;
          if (params.mountType === "french_cleat") {
            const cleat = createWallCleat(letters, params);
            cleat.position.set(0, -0.1, 0);
            cleat.updateMatrixWorld(true);
            scene.add(cleat);
            assemblyRef.current.cleat = cleat;
          }
          assemblyRef.current.diffuser = createDiffuser(letters, params);
        } else {
          letters.forEach((l) => scene.add(l));
        }
        assemblyRef.current.letters = letters;
        const allMeshes = scene.children.filter((c): c is THREE.Mesh => c.type === "Mesh");
        if (allMeshes.length > 0) {
          const { min, max } = getBounds(allMeshes);
          setDims(`${((max.x - min.x) * 1000).toFixed(1)} x ${((max.y - min.y) * 1000).toFixed(1)} x ${((max.z - min.z) * 1000).toFixed(1)} mm`);
          const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
          cameraRef.current!.position.set(0, -size * 0.3, size * 2.5);
          controlsRef.current!.target.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
          controlsRef.current!.update();
        }
        setStatus("Done");
        setHasGenerated(true);
      } catch (err: unknown) {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
      setGenerating(false);
    }, 50);
  }, [params, clearScene]);

  const downloadFile = useCallback((mesh: THREE.Mesh, name: string, format: "stl" | "3mf") => {
    const blob = format === "stl" ? exportSTL(mesh) : export3MF(mesh);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.${format}`; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const updateParam = <K extends keyof Params>(key: K, val: Params[K]) => setParams((p) => ({ ...p, [key]: val }));
  const updateLine = (idx: number, field: keyof LineConfig, val: string) => {
    setParams((p) => {
      const lines = [...p.lines];
      lines[idx] = { ...lines[idx], [field]: val };
      return { ...p, lines };
    });
  };
  const addLine = () => setParams((p) => ({ ...p, lines: [...p.lines, { text: "", align: "center" }] }));
  const removeLine = (idx: number) => setParams((p) => ({ ...p, lines: p.lines.filter((_, i) => i !== idx) }));

  const SectionHeader = ({ id, label, icon }: { id: string; label: string; icon: string }) => (
    <button onClick={() => toggleSection(id)} className="flex items-center gap-2 w-full text-left py-2 group">
      <span className="text-lg">{icon}</span>
      <span className="text-sm font-semibold text-zinc-200 flex-1">{label}</span>
      <span className={`text-zinc-500 text-xs transition-transform ${expandedSections[id] ? "rotate-180" : ""}`}>&#9660;</span>
    </button>
  );

  return (
    <div className="flex flex-col lg:flex-row h-screen">
      <div className="w-full lg:w-[420px] bg-zinc-900 border-r border-zinc-800 overflow-y-auto p-5 flex flex-col gap-3 text-sm">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Speak23D</h1>
          <p className="text-zinc-500 text-xs mt-0.5">3D Printable Backlit House Numbers &amp; Signs</p>
        </div>

        <SectionHeader id="multiline" label="Text / Multi-line" icon="&#9999;&#65039;" />
        {expandedSections.multiline && (
          <div className="space-y-2 pl-3 border-l-2 border-purple-500/30">
            {params.lines.map((line, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input type="text" value={line.text} onChange={(e) => updateLine(i, "text", e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white font-mono tracking-wider focus:border-blue-500 focus:outline-none"
                  placeholder={`Line ${i + 1}`} maxLength={20} />
                <select value={line.align} onChange={(e) => updateLine(i, "align", e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded px-1 py-1.5 text-white text-xs focus:outline-none w-16">
                  <option value="left">L</option>
                  <option value="center">C</option>
                  <option value="right">R</option>
                </select>
                {params.lines.length > 1 && (
                  <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-300 px-1">&#10005;</button>
                )}
              </div>
            ))}
            <button onClick={addLine} className="text-xs text-blue-400 hover:text-blue-300">+ Add line</button>
            <Slider label="Line Spacing" value={params.lineSpacingMM} onChange={(v) => updateParam("lineSpacingMM", v)} min={0} max={30} unit="mm" />
          </div>
        )}

        <SectionHeader id="dimensions" label="Dimensions" icon="&#128207;" />
        {expandedSections.dimensions && (
          <div className="space-y-3 pl-3 border-l-2 border-blue-500/30">
            <Slider label="Text Height" value={params.heightMM} onChange={(v) => updateParam("heightMM", v)} min={50} max={300} unit="mm" />
            <Slider label="Text Depth" value={params.depthMM} onChange={(v) => updateParam("depthMM", v)} min={5} max={30} unit="mm" />
            <Slider label="Backplate Padding" value={params.paddingMM} onChange={(v) => updateParam("paddingMM", v)} min={3} max={30} unit="mm" />
            <Slider label="Wall Thickness" value={params.wallThickMM} onChange={(v) => updateParam("wallThickMM", v)} min={1} max={8} step={0.5} unit="mm" />
            <Slider label="Scale Factor" value={params.scaleFactor} onChange={(v) => updateParam("scaleFactor", v)} min={0.5} max={3.0} step={0.1} unit="x" />
          </div>
        )}

        <SectionHeader id="shape" label="Backplate Shape" icon="&#128311;" />
        {expandedSections.shape && (
          <div className="space-y-3 pl-3 border-l-2 border-cyan-500/30">
            <div className="grid grid-cols-5 gap-1">
              {([
                ["rectangle", "Rect"], ["rounded_rect", "Round"], ["oval", "Oval"], ["arch", "Arch"], ["auto_contour", "Auto"],
              ] as [BackplateShape, string][]).map(([shape, lbl]) => (
                <button key={shape} onClick={() => updateParam("backplateShape", shape)}
                  className={`py-2 rounded text-xs transition-colors ${params.backplateShape === shape ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}>
                  {lbl}
                </button>
              ))}
            </div>
            {params.backplateShape === "rounded_rect" && (
              <Slider label="Corner Radius" value={params.cornerRadiusMM} onChange={(v) => updateParam("cornerRadiusMM", v)} min={2} max={40} unit="mm" />
            )}
          </div>
        )}

        <SectionHeader id="mounting" label="Mounting Holes" icon="&#128297;" />
        {expandedSections.mounting && (
          <div className="space-y-3 pl-3 border-l-2 border-amber-500/30">
            <Select label="Mount Type" value={params.mountType} onChange={(v) => updateParam("mountType", v as MountType)}
              options={[
                { value: "none", label: "None" },
                { value: "2hole", label: "2-Hole (top corners)" },
                { value: "4hole", label: "4-Hole (all corners)" },
                { value: "french_cleat", label: "French Cleat" },
                { value: "keyhole", label: "Keyhole Slots" },
              ]} />
            {(params.mountType === "2hole" || params.mountType === "4hole" || params.mountType === "keyhole") && (
              <Slider label="Hole Diameter" value={params.holeDiameterMM} onChange={(v) => updateParam("holeDiameterMM", v)} min={3} max={10} step={0.5} unit="mm" />
            )}
          </div>
        )}

        <div className="flex items-center justify-between bg-zinc-800 rounded-lg px-4 py-2.5">
          <div>
            <p className="text-sm font-medium text-zinc-200">Full Housing</p>
            <p className="text-xs text-zinc-500">Face + back + LED channels</p>
          </div>
          <button onClick={() => updateParam("housing", !params.housing)}
            className={`relative w-11 h-6 rounded-full transition-colors ${params.housing ? "bg-blue-500" : "bg-zinc-600"}`}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${params.housing ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>

        {params.housing && (
          <>
            <SectionHeader id="led" label="LED &amp; Options" icon="&#128161;" />
            {expandedSections.led && (
              <div className="space-y-3 pl-3 border-l-2 border-green-500/30">
                <Select label="LED Type" value={params.ledType} onChange={(v) => updateParam("ledType", v as Params["ledType"])}
                  options={[
                    { value: "strip_5v", label: "LED Strip 5V (12mm)" },
                    { value: "strip_12v", label: "LED Strip 12V (10mm)" },
                    { value: "cob", label: "COB LED (8mm)" },
                  ]} />
                <Select label="Reflector" value={params.reflector} onChange={(v) => updateParam("reflector", v as Params["reflector"])}
                  options={[
                    { value: "none", label: "None" },
                    { value: "parabolic", label: "Parabolic" },
                    { value: "faceted", label: "Faceted" },
                  ]} />
              </div>
            )}
          </>
        )}

        <button onClick={generate} disabled={generating || !fontLoaded}
          className="w-full py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all mt-2">
          {generating ? "Generating..." : "Generate 3D Model"}
        </button>

        <p className="text-xs text-zinc-400">{status}</p>
        {dims && <p className="text-xs text-zinc-300 font-mono text-blue-400">{dims}</p>}

        {hasGenerated && assemblyRef.current.face && (
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Downloads</h3>
            {params.housing ? (
              <>
                <DownloadBtn label="Face Plate" onSTL={() => downloadFile(assemblyRef.current.face!, "face_plate", "stl")} on3MF={() => downloadFile(assemblyRef.current.face!, "face_plate", "3mf")} />
                <DownloadBtn label="Back Plate" onSTL={() => downloadFile(assemblyRef.current.back!, "back_plate", "stl")} on3MF={() => downloadFile(assemblyRef.current.back!, "back_plate", "3mf")} />
                {assemblyRef.current.cleat && <DownloadBtn label="Wall Cleat" onSTL={() => downloadFile(assemblyRef.current.cleat!, "wall_cleat", "stl")} on3MF={() => downloadFile(assemblyRef.current.cleat!, "wall_cleat", "3mf")} />}
                {assemblyRef.current.diffuser && <DownloadBtn label="Diffuser" onSTL={() => downloadFile(assemblyRef.current.diffuser!, "diffuser", "stl")} on3MF={() => downloadFile(assemblyRef.current.diffuser!, "diffuser", "3mf")} />}
              </>
            ) : (
              assemblyRef.current.letters.map((l, i) => (
                <DownloadBtn key={i} label={`Letter ${i + 1}`} onSTL={() => downloadFile(l, `letter_${i}`, "stl")} on3MF={() => downloadFile(l, `letter_${i}`, "3mf")} />
              ))
            )}
          </div>
        )}

        <div className="mt-auto pt-3 border-t border-zinc-800">
          <p className="text-[10px] text-zinc-600">Speak23D by Tonic Thought Studios</p>
        </div>
      </div>

      <div ref={canvasRef} className="flex-1 relative min-h-[400px]">
        <div className="absolute top-4 left-4 bg-zinc-900/80 backdrop-blur rounded-lg px-3 py-1.5 text-xs text-zinc-400">
          Drag to rotate / Scroll to zoom / Right-click to pan
        </div>
      </div>
    </div>
  );
}
