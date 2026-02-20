"use client";

import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FontLoader, Font } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { CSG } from "three-csg-ts";

// ═══ Constants ═══════════════════════════════════════════════════════════
const MM = 0.001;

// ═══ Font Map ════════════════════════════════════════════════════════════
const FONT_MAP: Record<string, { label: string; file: string }> = {
  helvetiker: { label: "Helvetiker Bold", file: "/fonts/helvetiker_bold.typeface.json" },
  optimer: { label: "Optimer Bold", file: "/fonts/optimer_bold.typeface.json" },
  playfair: { label: "Playfair Display", file: "/fonts/playfair_display_bold.typeface.json" },
  blackops: { label: "Black Ops One", file: "/fonts/black_ops_one.typeface.json" },
  poiret: { label: "Poiret One", file: "/fonts/poiret_one.typeface.json" },
  pacifico: { label: "Pacifico", file: "/fonts/pacifico.typeface.json" },
  alfaslab: { label: "Alfa Slab One", file: "/fonts/alfa_slab_one.typeface.json" },
};

// ═══ Types ═══════════════════════════════════════════════════════════════
type BackplateShape = "rectangle" | "rounded_rect" | "oval" | "arch" | "auto_contour" | "none";
type MountType = "none" | "2hole" | "4hole" | "french_cleat" | "keyhole";
type LineAlign = "left" | "center" | "right";

interface LineConfig {
  text: string;
  align: LineAlign;
}

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
  showMountingPoints: boolean;
  letterMounting: boolean;
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
  showMountingPoints: false,
  letterMounting: true,
};

const LED_CHANNELS: Record<string, [number, number]> = {
  strip_5v: [12, 4],
  strip_12v: [10, 3],
  cob: [8, 3],
};

// ═══ AI Recommendations Engine ═══════════════════════════════════════════

interface Recommendation {
  font: string;
  size: string;
  style: string;
  material: string;
}

function getRecommendations(params: Params): Recommendation {
  const allText = params.lines.map((l) => l.text).join(" ").trim();
  const isNumbersOnly = /^\d+$/.test(allText.replace(/\s/g, ""));
  const isShort = allText.length <= 6;
  const isLong = allText.length > 12;
  const wordCount = allText.split(/\s+/).filter(Boolean).length;
  const isName = wordCount >= 1 && wordCount <= 3 && !isNumbersOnly && /[a-zA-Z]/.test(allText);

  let font = "";
  if (isNumbersOnly) {
    font = "House numbers → clean sans-serif (Helvetiker) or slab serif (Alfa Slab One) for maximum readability at distance.";
  } else if (isName && isShort) {
    font = "Short name/word → bold display fonts work great. Try Black Ops One for modern, Playfair Display for elegant, or Pacifico for a friendly script look.";
  } else if (isName && !isShort) {
    font = "Longer name → use a compact, readable font. Helvetiker or Optimer Bold keeps it clean. Avoid wide scripts like Pacifico for long text.";
  } else if (isLong) {
    font = "Long text → needs a compact font. Helvetiker Bold or Poiret One (thin strokes) keep overall width manageable.";
  } else if (isShort) {
    font = "Short text → bold stencil/display fonts shine. Black Ops One or Alfa Slab One make a strong statement.";
  } else {
    font = "General text → Helvetiker Bold is the safest all-rounder. Optimer Bold for a slightly warmer feel.";
  }

  let size = "";
  if (isNumbersOnly) {
    size = "Street-visible house numbers: 150mm+ height. Door-mounted: 80–120mm. Mailbox: 50–80mm.";
  } else {
    size = "Names/signs: 80–120mm for door-level viewing. 150mm+ if mounting high or viewing from distance. For indoor decor, 50–80mm works fine.";
  }

  let style = "";
  const shape = params.backplateShape;
  if (shape === "none") {
    style = "No backplate = modern floating letter look. Works best with thick, bold fonts. Letters mount directly to wall with hidden screws.";
  } else if (shape === "rounded_rect") {
    style = "Rounded rectangle = modern/contemporary feel. Pair with sans-serif fonts. Great for new builds.";
  } else if (shape === "arch") {
    style = "Arch shape = traditional/classical. Pairs beautifully with serif fonts like Playfair Display.";
  } else if (shape === "oval") {
    style = "Oval = soft, welcoming. Works with script fonts (Pacifico) or classic serifs.";
  } else {
    style = "Rectangle = clean and universal. Modern home → pair with sans-serif. Traditional → serif works too.";
  }

  let material = "";
  if (params.housing) {
    material = "Outdoor use: Print housing in ASA or PETG for UV/weather resistance. Indoor: PLA is fine. Dark filament + light diffuser = best LED contrast. White/natural diffuser at 0.8mm for even glow.";
  } else {
    material = "Standalone letters: ASA/PETG for outdoors, PLA for indoor. Consider painting with spray primer + paint for a premium finish.";
  }

  return { font, size, style, material };
}

// ═══ Geometry Helpers ════════════════════════════════════════════════════

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

// ═══ Backplate Shape Generators ══════════════════════════════════════════

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
    shape.lineTo(-r, 0);
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

// ═══ Hidden Letter Mounting Points ═══════════════════════════════════════

interface MountingPoint {
  x: number; // mm
  y: number; // mm
  letterChar: string;
  letterIndex: number;
}

function computeLetterMountingPoints(letters: THREE.Mesh[], params: Params): MountingPoint[] {
  const points: MountingPoint[] = [];
  const throughR = 1.5; // 3mm through-hole diameter / 2
  const narrowChars = new Set(["I", "1", ".", "!", "|", "L"]);

  letters.forEach((letter, idx) => {
    letter.geometry.computeBoundingBox();
    const bb = letter.geometry.boundingBox!.clone();
    bb.applyMatrix4(letter.matrixWorld);
    const lw = (bb.max.x - bb.min.x) * 1000; // mm
    const lh = (bb.max.y - bb.min.y) * 1000;
    const cx = ((bb.min.x + bb.max.x) / 2) * 1000;
    const cy = ((bb.min.y + bb.max.y) / 2) * 1000;

    // Determine letter character from userData or index
    const ch = (letter.userData?.char as string) || "";
    const isNarrow = narrowChars.has(ch) || lw < params.heightMM * 0.4;

    if (isNarrow || lw < throughR * 8) {
      // Single center hole
      points.push({ x: cx, y: cy, letterChar: ch, letterIndex: idx });
    } else {
      // Two holes at 25% and 75% width
      const x25 = (bb.min.x + (bb.max.x - bb.min.x) * 0.25) * 1000;
      const x75 = (bb.min.x + (bb.max.x - bb.min.x) * 0.75) * 1000;
      points.push({ x: x25, y: cy, letterChar: ch, letterIndex: idx });
      points.push({ x: x75, y: cy, letterChar: ch, letterIndex: idx });
    }
  });

  return points;
}

function addLetterMountingHoles(letterMesh: THREE.Mesh, params: Params): THREE.Mesh {
  const throughR = 1.5 * MM * params.scaleFactor; // 3mm dia
  const counterR = 3.0 * MM * params.scaleFactor; // 6mm dia countersink
  const counterDepth = 3.0 * MM * params.scaleFactor;
  const d = params.depthMM * MM * params.scaleFactor;

  letterMesh.geometry.computeBoundingBox();
  const bb = letterMesh.geometry.boundingBox!.clone();
  bb.applyMatrix4(letterMesh.matrixWorld);
  const lw = bb.max.x - bb.min.x;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  const backZ = (bb.min.z + bb.max.z) / 2;

  const narrowChars = new Set(["I", "1", ".", "!", "|", "L"]);
  const ch = (letterMesh.userData?.char as string) || "";
  const isNarrow = narrowChars.has(ch) || lw < params.heightMM * MM * params.scaleFactor * 0.4;

  const holeXPositions: number[] = [];
  if (isNarrow || lw < throughR * 16) {
    holeXPositions.push(cx);
  } else {
    holeXPositions.push(bb.min.x + lw * 0.25);
    holeXPositions.push(bb.min.x + lw * 0.75);
  }

  let result = letterMesh;
  for (const hx of holeXPositions) {
    // Through hole (full depth)
    const through = cylMesh(throughR, d * 3, 0x666666);
    through.rotation.set(Math.PI / 2, 0, 0);
    through.position.set(hx, cy, backZ);
    through.updateMatrixWorld(true);
    result = safeCSG(result, through, "subtract");
    result.updateMatrixWorld(true);

    // Countersink on back face
    const counter = cylMesh(counterR, counterDepth, 0x666666);
    counter.rotation.set(Math.PI / 2, 0, 0);
    counter.position.set(hx, cy, bb.min.z + counterDepth / 2);
    counter.updateMatrixWorld(true);
    result = safeCSG(result, counter, "subtract");
    result.updateMatrixWorld(true);
  }

  return result;
}

function generateDrillingSVG(mountingPoints: MountingPoint[], params: Params): string {
  if (mountingPoints.length === 0) return "";
  // Find bounding box of all points
  const xs = mountingPoints.map((p) => p.x);
  const ys = mountingPoints.map((p) => p.y);
  const margin = 20;
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minY = Math.min(...ys) - margin;
  const maxY = Math.max(...ys) + margin;
  const w = maxX - minX;
  const h = maxY - minY;

  // SVG at 1:1 scale (1 unit = 1mm)
  const circles = mountingPoints.map((p) => {
    const sx = p.x - minX;
    const sy = maxY - p.y; // flip Y
    return `<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="1.5" fill="none" stroke="#333" stroke-width="0.3"/>
<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="3" fill="none" stroke="#999" stroke-width="0.2" stroke-dasharray="1,1"/>
<circle cx="${sx.toFixed(2)}" cy="${sy.toFixed(2)}" r="0.3" fill="#333"/>
<text x="${sx.toFixed(2)}" y="${(sy + 5).toFixed(2)}" font-size="2.5" text-anchor="middle" fill="#666">${p.letterChar || "•"}</text>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">
<title>Speak23D Drilling Template - 1:1 Scale</title>
<rect width="${w}" height="${h}" fill="white" stroke="#ccc" stroke-width="0.5"/>
<text x="5" y="5" font-size="3" fill="#999">Drilling Template (1:1) — 3mm through + 6mm countersink</text>
<text x="5" y="9" font-size="2.5" fill="#bbb">Height: ${params.heightMM}mm | Font: ${FONT_MAP[params.font]?.label || params.font}</text>
${circles}
<!-- Scale reference: 10mm bar -->
<line x1="5" y1="${h - 5}" x2="15" y2="${h - 5}" stroke="#333" stroke-width="0.3"/>
<text x="10" y="${h - 6}" font-size="2" text-anchor="middle" fill="#666">10mm</text>
</svg>`;
}

// ═══ Assembly Generation ═════════════════════════════════════════════════

function createMultiLineLetterMeshes(font: Font, params: Params): THREE.Mesh[] {
  const h = params.heightMM * MM * params.scaleFactor;
  const d = params.depthMM * MM * params.scaleFactor;
  const lineSpacing = params.lineSpacingMM * MM * params.scaleFactor;
  const allMeshes: THREE.Mesh[] = [];

  interface LineMeasure {
    meshes: THREE.Mesh[];
    width: number;
    config: LineConfig;
  }
  const lineMeasures: LineMeasure[] = [];

  for (const lineConf of params.lines) {
    const text = lineConf.text.toUpperCase().replace(/[^A-Z0-9 .#\-]/g, "");
    if (!text.trim()) {
      lineMeasures.push({ meshes: [], width: 0, config: lineConf });
      continue;
    }

    const meshes: THREE.Mesh[] = [];
    const widths: number[] = [];

    for (const ch of text) {
      if (ch === " ") {
        widths.push(h * 0.3);
        continue;
      }
      const geo = new TextGeometry(ch, { font, size: h, depth: d, curveSegments: 4, bevelEnabled: false });
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      widths.push(bb.max.x - bb.min.x);
      geo.dispose();
    }

    const gap = h * 0.03;
    let cursor = 0;
    const totalW = widths.reduce((a, b) => a + b, 0) + gap * (text.length - 1);

    let charIdx = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === " ") {
        cursor += widths[charIdx] + gap;
        charIdx++;
        continue;
      }
      const geo = new TextGeometry(ch, { font, size: h, depth: d, curveSegments: 4, bevelEnabled: false });
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      geo.translate(-bb.min.x, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
      const mesh = makeMesh(geo, 0xcccccc);
      mesh.position.set(cursor, 0, 0);
      mesh.userData.char = ch;
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
      case "left":
        offsetX = -maxWidth / 2;
        break;
      case "right":
        offsetX = maxWidth / 2 - line.width;
        break;
      default:
        offsetX = -line.width / 2;
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
      holePositions.push(
        [cx - outerW / 2 + inset, cy + outerH / 2 - inset],
        [cx + outerW / 2 - inset, cy + outerH / 2 - inset]
      );
      break;
    case "4hole":
      holePositions.push(
        [cx - outerW / 2 + inset, cy + outerH / 2 - inset],
        [cx + outerW / 2 - inset, cy + outerH / 2 - inset],
        [cx - outerW / 2 + inset, cy - outerH / 2 + inset],
        [cx + outerW / 2 - inset, cy - outerH / 2 + inset]
      );
      break;
    case "keyhole": {
      const bigR = holeR;
      const slotR = holeR * 0.5;
      const slotLen = holeR * 2;
      const positions: [number, number][] = [
        [cx - outerW * 0.3, cy],
        [cx + outerW * 0.3, cy],
      ];
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
    default:
      return result;
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

// ═══ STL / 3MF Export ════════════════════════════════════════════════════

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
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" /></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" /></Relationships>`;
  return createZipBlob({ "[Content_Types].xml": contentTypes, "_rels/.rels": rels, "3D/3dmodel.model": model });
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
    dv.setUint16(8, 0, true);
    dv.setUint32(14, crc32(dataBytes), true);
    dv.setUint32(18, dataBytes.length, true);
    dv.setUint32(22, dataBytes.length, true);
    dv.setUint16(26, nameBytes.length, true);
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
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint32(16, crc32(entry.data), true);
    dv.setUint32(20, entry.data.length, true);
    dv.setUint32(24, entry.data.length, true);
    dv.setUint16(28, entry.name.length, true);
    dv.setUint32(42, entry.offset, true);
    cd.set(entry.name, 46);
    cdParts.push(cd);
    cdSize += cd.length;
  }
  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, entries.length, true);
  dv.setUint16(10, entries.length, true);
  dv.setUint32(12, cdSize, true);
  dv.setUint32(16, offset, true);
  return new Blob([...parts.map(p => p.buffer as ArrayBuffer), ...cdParts.map(p => p.buffer as ArrayBuffer), eocd.buffer as ArrayBuffer], { type: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml" });
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[i] = c; }
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ═══ UI Sub-components ═══════════════════════════════════════════════════

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
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-500 h-1.5 bg-zinc-700 rounded-lg cursor-pointer"
      />
    </div>
  );
}

function SelectInput({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-300 mb-1">{label}</label>
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:border-blue-500 focus:outline-none text-sm"
      >
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

function AIRecommendationsPanel({ params }: { params: Params }) {
  const [open, setOpen] = useState(true);
  const recs = useMemo(() => getRecommendations(params), [params]);

  return (
    <div className="bg-gradient-to-br from-violet-950/40 to-blue-950/40 border border-violet-500/20 rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full text-left px-3 py-2.5 group">
        <span className="text-lg">🤖</span>
        <span className="text-sm font-semibold text-violet-300 flex-1">AI Recommendations</span>
        <span className={`text-violet-500 text-xs transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2.5 text-xs">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span>🔤</span>
              <span className="font-semibold text-zinc-300">Font</span>
            </div>
            <p className="text-zinc-400 leading-relaxed">{recs.font}</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span>📏</span>
              <span className="font-semibold text-zinc-300">Size</span>
            </div>
            <p className="text-zinc-400 leading-relaxed">{recs.size}</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span>🎨</span>
              <span className="font-semibold text-zinc-300">Style</span>
            </div>
            <p className="text-zinc-400 leading-relaxed">{recs.style}</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span>🧱</span>
              <span className="font-semibold text-zinc-300">Material</span>
            </div>
            <p className="text-zinc-400 leading-relaxed">{recs.material}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ Main Component ══════════════════════════════════════════════════════

export default function Speak23D() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const fontRef = useRef<Font | null>(null);
  const fontCacheRef = useRef<Record<string, Font>>({});
  const assemblyRef = useRef<{
    face?: THREE.Mesh; back?: THREE.Mesh; cleat?: THREE.Mesh; diffuser?: THREE.Mesh; letters: THREE.Mesh[];
    ledStrips: THREE.Mesh[]; diffuserPlate?: THREE.Mesh; wall?: THREE.Mesh;
    mountingPoints?: MountingPoint[];
  }>({ letters: [], ledStrips: [] });

  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [generating, setGenerating] = useState(false);
  const [fontLoaded, setFontLoaded] = useState(false);
  const [dims, setDims] = useState("");
  const [status, setStatus] = useState("Loading font...");
  const [hasGenerated, setHasGenerated] = useState(false);
  const [mountingPoints, setMountingPoints] = useState<MountingPoint[]>([]);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    dimensions: true, shape: false, mounting: false, multiline: false, led: false, font: true,
  });

  const toggleSection = (s: string) => setExpandedSections((prev) => ({ ...prev, [s]: !prev[s] }));

  const loadFont = useCallback((fontKey: string, callback: (font: Font) => void) => {
    if (fontCacheRef.current[fontKey]) {
      callback(fontCacheRef.current[fontKey]);
      return;
    }
    const entry = FONT_MAP[fontKey];
    if (!entry) return;
    const loader = new FontLoader();
    loader.load(entry.file, (font) => {
      fontCacheRef.current[fontKey] = font;
      callback(font);
    }, undefined, () => setStatus(`Error loading font: ${entry.label}`));
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
    const animate = () => { requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();
    const handleResize = () => { camera.aspect = container.clientWidth / container.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(container.clientWidth, container.clientHeight); };
    window.addEventListener("resize", handleResize);

    // Load default font
    const loader = new FontLoader();
    const defaultEntry = FONT_MAP["helvetiker"];
    loader.load(defaultEntry.file, (font) => {
      fontRef.current = font;
      fontCacheRef.current["helvetiker"] = font;
      setFontLoaded(true);
      setStatus("Ready — enter text and click Generate");
    }, undefined, () => setStatus("Error loading font"));

    return () => { window.removeEventListener("resize", handleResize); renderer.dispose(); container.removeChild(renderer.domElement); };
  }, []);

  const clearScene = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.children.filter((c) => c.type === "Mesh" || c.type === "Group").forEach((c) => scene.remove(c));
    assemblyRef.current = { letters: [], ledStrips: [] };
  }, []);

  const generate = useCallback(() => {
    if (!sceneRef.current) return;
    setGenerating(true);
    setStatus("Loading font...");

    const doGenerate = (font: Font) => {
      fontRef.current = font;
      clearScene();
      setStatus("Generating 3D model...");
      setTimeout(() => {
        try {
          const scene = sceneRef.current!;
          const letters = createMultiLineLetterMeshes(font, params);
          if (letters.length === 0) { setStatus("No valid characters"); setGenerating(false); return; }

          const isNoBackplate = params.backplateShape === "none";

          if (params.housing && !isNoBackplate) {
            const face = createFacePlate(letters, params);
            scene.add(face);
            assemblyRef.current.face = face;
            setStatus("Building back plate...");
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
            // No backplate or no housing — letters only, with optional mounting holes
            const processedLetters: THREE.Mesh[] = [];
            for (const l of letters) {
              let processed = l;
              if (isNoBackplate && params.letterMounting) {
                processed = addLetterMountingHoles(l, params);
              }
              scene.add(processed);
              processedLetters.push(processed);
            }
            assemblyRef.current.letters = processedLetters;

            // Compute mounting points for SVG template
            if (isNoBackplate && params.letterMounting) {
              const pts = computeLetterMountingPoints(processedLetters, params);
              assemblyRef.current.mountingPoints = pts;
              setMountingPoints(pts);
            }

            // Show mounting point indicators
            if (isNoBackplate && params.showMountingPoints && params.letterMounting) {
              const pts = assemblyRef.current.mountingPoints || computeLetterMountingPoints(processedLetters, params);
              for (const pt of pts) {
                const indicator = cylMesh(2 * MM * params.scaleFactor, params.depthMM * MM * params.scaleFactor + 0.001, 0xff4444);
                indicator.rotation.set(Math.PI / 2, 0, 0);
                indicator.position.set(pt.x / 1000, pt.y / 1000, params.depthMM * MM * params.scaleFactor / 2);
                indicator.updateMatrixWorld(true);
                scene.add(indicator);
              }
            }
          }

          assemblyRef.current.letters = assemblyRef.current.letters.length > 0 ? assemblyRef.current.letters : letters;
          const allMeshes = scene.children.filter((c): c is THREE.Mesh => c.type === "Mesh");
          if (allMeshes.length > 0) {
            const { min, max } = getBounds(allMeshes);
            setDims(`${((max.x - min.x) * 1000).toFixed(1)} × ${((max.y - min.y) * 1000).toFixed(1)} × ${((max.z - min.z) * 1000).toFixed(1)} mm`);
            const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
            cameraRef.current!.position.set(0, -size * 0.3, size * 2.5);
            controlsRef.current!.target.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
            controlsRef.current!.update();
          }
          setStatus("✅ Model generated");
          setHasGenerated(true);
        } catch (err: unknown) {
          setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
        setGenerating(false);
      }, 50);
    };

    loadFont(params.font, doGenerate);
  }, [params, clearScene, loadFont]);

  const downloadFile = useCallback((mesh: THREE.Mesh, name: string, format: "stl" | "3mf") => {
    const blob = format === "stl" ? exportSTL(mesh) : export3MF(mesh);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.${format}`; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadSVGTemplate = useCallback(() => {
    const pts = assemblyRef.current.mountingPoints || mountingPoints;
    if (!pts.length) return;
    const svg = generateDrillingSVG(pts, params);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "drilling_template.svg"; a.click();
    URL.revokeObjectURL(url);
  }, [mountingPoints, params]);

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
      <span className={`text-zinc-500 text-xs transition-transform ${expandedSections[id] ? "rotate-180" : ""}`}>▼</span>
    </button>
  );

  const isNoBackplate = params.backplateShape === "none";

  return (
    <div className="flex flex-col lg:flex-row h-screen">
      {/* Controls Panel */}
      <div className="w-full lg:w-[420px] bg-zinc-900 border-r border-zinc-800 overflow-y-auto p-5 flex flex-col gap-3 text-sm">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Speak23D</h1>
          <p className="text-zinc-500 text-xs mt-0.5">3D Printable Backlit House Numbers & Signs</p>
        </div>

        {/* AI Recommendations */}
        <AIRecommendationsPanel params={params} />

        {/* 📝 Multi-line Text */}
        <SectionHeader id="multiline" label="Text / Multi-line" icon="📝" />
        {expandedSections.multiline && (
          <div className="space-y-2 pl-3 border-l-2 border-purple-500/30">
            {params.lines.map((line, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  type="text" value={line.text} onChange={(e) => updateLine(i, "text", e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-white font-mono tracking-wider focus:border-blue-500 focus:outline-none"
                  placeholder={`Line ${i + 1}`} maxLength={20}
                />
                <select value={line.align} onChange={(e) => updateLine(i, "align", e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 rounded px-1 py-1.5 text-white text-xs focus:outline-none w-16">
                  <option value="left">L</option>
                  <option value="center">C</option>
                  <option value="right">R</option>
                </select>
                {params.lines.length > 1 && (
                  <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-300 px-1">✕</button>
                )}
              </div>
            ))}
            <button onClick={addLine} className="text-xs text-blue-400 hover:text-blue-300">+ Add line</button>
            <Slider label="Line Spacing" value={params.lineSpacingMM} onChange={(v) => updateParam("lineSpacingMM", v)} min={0} max={30} unit="mm" />
          </div>
        )}

        {/* 🔤 Font Selection */}
        <SectionHeader id="font" label="Font" icon="🔤" />
        {expandedSections.font && (
          <div className="space-y-2 pl-3 border-l-2 border-pink-500/30">
            <SelectInput label="Typeface" value={params.font} onChange={(v) => updateParam("font", v)}
              options={Object.entries(FONT_MAP).map(([k, v]) => ({ value: k, label: v.label }))}
            />
          </div>
        )}

        {/* 📐 Dimensions */}
        <SectionHeader id="dimensions" label="Dimensions" icon="📐" />
        {expandedSections.dimensions && (
          <div className="space-y-3 pl-3 border-l-2 border-blue-500/30">
            <Slider label="Text Height" value={params.heightMM} onChange={(v) => updateParam("heightMM", v)} min={50} max={300} unit="mm" />
            <Slider label="Text Depth" value={params.depthMM} onChange={(v) => updateParam("depthMM", v)} min={5} max={30} unit="mm" />
            <Slider label="Backplate Padding" value={params.paddingMM} onChange={(v) => updateParam("paddingMM", v)} min={3} max={30} unit="mm" />
            <Slider label="Wall Thickness" value={params.wallThickMM} onChange={(v) => updateParam("wallThickMM", v)} min={1} max={8} step={0.5} unit="mm" />
            <Slider label="Scale Factor" value={params.scaleFactor} onChange={(v) => updateParam("scaleFactor", v)} min={0.5} max={3.0} step={0.1} unit="×" />
          </div>
        )}

        {/* 🔷 Backplate Shape */}
        <SectionHeader id="shape" label="Backplate Shape" icon="🔷" />
        {expandedSections.shape && (
          <div className="space-y-3 pl-3 border-l-2 border-cyan-500/30">
            <div className="grid grid-cols-6 gap-1">
              {([
                ["rectangle", "▬"],
                ["rounded_rect", "▢"],
                ["oval", "⬭"],
                ["arch", "⌂"],
                ["auto_contour", "◎"],
                ["none", "✖"],
              ] as [BackplateShape, string][]).map(([shape, icon]) => (
                <button key={shape} onClick={() => updateParam("backplateShape", shape)}
                  className={`py-2 rounded text-lg transition-colors ${params.backplateShape === shape ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
                  title={shape === "none" ? "No Backplate (floating letters)" : shape.replace("_", " ")}>
                  {icon}
                </button>
              ))}
            </div>
            <p className="text-xs text-zinc-500 capitalize">{params.backplateShape === "none" ? "No Backplate (floating letters)" : params.backplateShape.replace("_", " ")}</p>
            {params.backplateShape === "rounded_rect" && (
              <Slider label="Corner Radius" value={params.cornerRadiusMM} onChange={(v) => updateParam("cornerRadiusMM", v)} min={2} max={40} unit="mm" />
            )}
          </div>
        )}

        {/* 🔩 Mounting */}
        <SectionHeader id="mounting" label="Mounting" icon="🔩" />
        {expandedSections.mounting && (
          <div className="space-y-3 pl-3 border-l-2 border-amber-500/30">
            {!isNoBackplate && (
              <>
                <SelectInput label="Mount Type" value={params.mountType} onChange={(v) => updateParam("mountType", v as MountType)}
                  options={[
                    { value: "none", label: "None" },
                    { value: "2hole", label: "2-Hole (top corners)" },
                    { value: "4hole", label: "4-Hole (all corners)" },
                    { value: "french_cleat", label: "French Cleat" },
                    { value: "keyhole", label: "Keyhole Slots" },
                  ]}
                />
                {(params.mountType === "2hole" || params.mountType === "4hole" || params.mountType === "keyhole") && (
                  <Slider label="Hole Diameter" value={params.holeDiameterMM} onChange={(v) => updateParam("holeDiameterMM", v)} min={3} max={10} step={0.5} unit="mm" />
                )}
              </>
            )}
            {isNoBackplate && (
              <>
                <div className="flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Hidden Letter Mounting</p>
                    <p className="text-xs text-zinc-500">Counterbored screw holes in letters</p>
                  </div>
                  <button onClick={() => updateParam("letterMounting", !params.letterMounting)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${params.letterMounting ? "bg-blue-500" : "bg-zinc-600"}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${params.letterMounting ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                </div>
                <div className="flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Show Mounting Points</p>
                    <p className="text-xs text-zinc-500">Highlight holes in red in preview</p>
                  </div>
                  <button onClick={() => updateParam("showMountingPoints", !params.showMountingPoints)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${params.showMountingPoints ? "bg-red-500" : "bg-zinc-600"}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${params.showMountingPoints ? "translate-x-5" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Housing / LED toggle */}
        {!isNoBackplate && (
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
        )}

        {params.housing && !isNoBackplate && (
          <>
            <SectionHeader id="led" label="LED & Options" icon="💡" />
            {expandedSections.led && (
              <div className="space-y-3 pl-3 border-l-2 border-green-500/30">
                <SelectInput label="LED Type" value={params.ledType} onChange={(v) => updateParam("ledType", v as Params["ledType"])}
                  options={[
                    { value: "strip_5v", label: "LED Strip 5V (12mm)" },
                    { value: "strip_12v", label: "LED Strip 12V (10mm)" },
                    { value: "cob", label: "COB LED (8mm)" },
                  ]}
                />
                <SelectInput label="Reflector" value={params.reflector} onChange={(v) => updateParam("reflector", v as Params["reflector"])}
                  options={[
                    { value: "none", label: "None" },
                    { value: "parabolic", label: "Parabolic" },
                    { value: "faceted", label: "Faceted" },
                  ]}
                />
              </div>
            )}
          </>
        )}

        {/* Generate */}
        <button onClick={generate} disabled={generating || !fontLoaded}
          className="w-full py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all mt-2">
          {generating ? "⏳ Generating..." : "🚀 Generate 3D Model"}
        </button>

        <p className="text-xs text-zinc-400">{status}</p>
        {dims && <p className="text-xs text-zinc-300">📐 <span className="font-mono text-blue-400">{dims}</span></p>}

        {/* Downloads */}
        {hasGenerated && (assemblyRef.current.face || assemblyRef.current.letters.length > 0) && (
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Downloads</h3>
            {assemblyRef.current.face ? (
              <>
                <DownloadBtn label="Face Plate" onSTL={() => downloadFile(assemblyRef.current.face!, "face_plate", "stl")} on3MF={() => downloadFile(assemblyRef.current.face!, "face_plate", "3mf")} />
                <DownloadBtn label="Back Plate" onSTL={() => downloadFile(assemblyRef.current.back!, "back_plate", "stl")} on3MF={() => downloadFile(assemblyRef.current.back!, "back_plate", "3mf")} />
                {assemblyRef.current.cleat && <DownloadBtn label="Wall Cleat" onSTL={() => downloadFile(assemblyRef.current.cleat!, "wall_cleat", "stl")} on3MF={() => downloadFile(assemblyRef.current.cleat!, "wall_cleat", "3mf")} />}
                {assemblyRef.current.diffuser && <DownloadBtn label="Diffuser" onSTL={() => downloadFile(assemblyRef.current.diffuser!, "diffuser", "stl")} on3MF={() => downloadFile(assemblyRef.current.diffuser!, "diffuser", "3mf")} />}
              </>
            ) : (
              assemblyRef.current.letters.map((l, i) => (
                <DownloadBtn key={i} label={`Letter ${l.userData?.char || i + 1}`} onSTL={() => downloadFile(l, `letter_${i}`, "stl")} on3MF={() => downloadFile(l, `letter_${i}`, "3mf")} />
              ))
            )}
            {isNoBackplate && params.letterMounting && mountingPoints.length > 0 && (
              <button onClick={downloadSVGTemplate}
                className="w-full flex items-center gap-2 bg-amber-900/30 border border-amber-500/20 rounded-lg px-3 py-2 text-sm text-amber-300 hover:bg-amber-900/50 transition-colors">
                <span>📐</span>
                <span className="flex-1 text-left">Download Drilling Template (SVG)</span>
              </button>
            )}
          </div>
        )}

        <div className="mt-auto pt-3 border-t border-zinc-800">
          <p className="text-[10px] text-zinc-600">Speak23D by Tonic Thought Studios — 100% client-side</p>
        </div>
      </div>

      {/* 3D Viewport */}
      <div ref={canvasRef} className="flex-1 relative min-h-[400px]">
        <div className="absolute top-4 left-4 bg-zinc-900/80 backdrop-blur rounded-lg px-3 py-1.5 text-xs text-zinc-400">
          🖱️ Drag to rotate · Scroll to zoom · Right-click to pan
        </div>
      </div>
    </div>
  );
}
