"use client";

import React, { useRef, useState, useEffect, useCallback, useMemo } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FontLoader, Font } from "three/examples/jsm/loaders/FontLoader.js";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { CSG } from "three-csg-ts";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

// ═══ Constants ═══════════════════════════════════════════════════════════
const MM = 0.001;

// ═══ Font Map ════════════════════════════════════════════════════════════
const FONT_MAP: Record<string, { label: string; file: string }> = {
  helvetiker: { label: "Helvetiker Bold", file: "/fonts/helvetiker_bold.typeface.json" },
  optimer: { label: "Optimer Bold", file: "/fonts/optimer_bold.typeface.json" },
  greatvibes: { label: "Great Vibes (Connected Script)", file: "/fonts/great_vibes.typeface.json" },
  playfair: { label: "Playfair Display", file: "/fonts/playfair_display_bold.typeface.json" },
  blackops: { label: "Black Ops One", file: "/fonts/black_ops_one.typeface.json" },
  poiret: { label: "Poiret One", file: "/fonts/poiret_one.typeface.json" },
  pacifico: { label: "Pacifico", file: "/fonts/pacifico.typeface.json" },
  alfaslab: { label: "Alfa Slab One", file: "/fonts/alfa_slab_one.typeface.json" },
};

// ═══ LED Color Presets ═══════════════════════════════════════════════════
const LED_COLOR_PRESETS: Record<string, { label: string; color: string }> = {
  warm_white: { label: "Warm White", color: "#FFE4B5" },
  cool_white: { label: "Cool White", color: "#F0F8FF" },
  red: { label: "Red", color: "#FF0000" },
  green: { label: "Green", color: "#00FF00" },
  blue: { label: "Blue", color: "#0066FF" },
  custom: { label: "Custom RGB", color: "#FF00FF" },
};

// ═══ Environment Presets ═════════════════════════════════════════════════
type EnvironmentType = "house_wall" | "rock" | "fence" | "mailbox" | "freestanding";
const ENVIRONMENT_PRESETS: Record<EnvironmentType, { label: string; icon: string }> = {
  house_wall: { label: "House Wall", icon: "🏠" },
  rock: { label: "Rock / Boulder", icon: "🪨" },
  fence: { label: "Fence / Gate", icon: "🚧" },
  mailbox: { label: "Mailbox", icon: "📬" },
  freestanding: { label: "Freestanding", icon: "🌿" },
};

type WallTexture = "brick" | "wood_siding" | "stucco" | "modern_render";

// ═══ Types ═══════════════════════════════════════════════════════════════
type BackplateShape = "rectangle" | "rounded_rect" | "oval" | "arch" | "auto_contour" | "none";
type MountType = "none" | "2hole" | "4hole" | "french_cleat" | "keyhole";
type NoBackplateMountType = "flush" | "standoff" | "adhesive";
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
  noBackplateMountType: NoBackplateMountType;
  haloLED: boolean;
  // LED visualization
  ledOn: boolean;
  ledColorPreset: string;
  ledCustomColor: string;
  ledBrightness: number;
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
  noBackplateMountType: "flush",
  haloLED: false,
  ledOn: true,
  ledColorPreset: "warm_white",
  ledCustomColor: "#FF00FF",
  ledBrightness: 0.8,
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
  const isNoBackplate = params.backplateShape === "none";

  let font = "";
  if (isNoBackplate && params.font === "poiret" && params.depthMM < 15) {
    font = "⚠️ WARNING: Poiret One is fragile for standalone letters under 15mm depth. Use Helvetiker Bold or increase depth to 15mm+ for structural integrity.";
  } else if (isNoBackplate && params.depthMM < 15) {
    font = "⚠️ Standalone letters: Recommend 15mm+ depth for structural integrity. Bold fonts (Helvetiker, Black Ops One) are strongest. Great Vibes connected script provides structural joining between letters.";
  } else if (isNumbersOnly) {
    font = "House numbers → clean sans-serif (Helvetiker) or slab serif (Alfa Slab One) for maximum readability at distance.";
  } else if (isName && isShort) {
    font = "Short name/word → bold display fonts work great. Try Black Ops One for modern, Playfair Display for elegant, or Great Vibes for connected script elegance.";
  } else if (isName && !isShort) {
    font = "Longer name → use a compact, readable font. Helvetiker or Optimer Bold keeps it clean. Great Vibes connects letters for strength.";
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
    let mountAdvice = "";
    if (params.noBackplateMountType === "flush") {
      mountAdvice = " Flush mount (hidden screws) gives clean look. Drilling template included.";
    } else if (params.noBackplateMountType === "standoff") {
      mountAdvice = " Standoff mount creates premium floating effect with halo shadows.";
    } else {
      mountAdvice = " Adhesive mount for lightweight indoor signs only.";
    }
    style = `No backplate = modern floating letter look. Works best with thick, bold fonts (15mm+ depth).${mountAdvice} ${allText.length * params.heightMM < 1500 ? "Good size for halo LED strips." : "Too large for easy LED strip routing."}`;
  } else if (shape === "rounded_rect") {
    style = "Rounded rectangle = modern/contemporary feel. Pair with sans-serif fonts. Great for new builds.";
  } else if (shape === "arch") {
    style = "Arch shape = traditional/classical. Pairs beautifully with serif fonts like Playfair Display.";
  } else if (shape === "oval") {
    style = "Oval = soft, welcoming. Works with script fonts (Great Vibes, Pacifico) or classic serifs.";
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

// ═══ URL Params for Share Links ══════════════════════════════════════════

function encodeParamsToURL(params: Params): string {
  const data: Record<string, string> = {
    t: params.lines.map(l => `${l.text}|${l.align}`).join("~"),
    f: params.font,
    h: String(params.heightMM),
    d: String(params.depthMM),
    p: String(params.paddingMM),
    w: String(params.wallThickMM),
    s: String(params.scaleFactor),
    ho: params.housing ? "1" : "0",
    lt: params.ledType,
    bs: params.backplateShape,
    cr: String(params.cornerRadiusMM),
    mt: params.mountType,
    hd: String(params.holeDiameterMM),
    ls: String(params.lineSpacingMM),
    lo: params.ledOn ? "1" : "0",
    lc: params.ledColorPreset,
    lcc: params.ledCustomColor,
    lb: String(params.ledBrightness),
    nbm: params.noBackplateMountType,
    hl: params.haloLED ? "1" : "0",
  };
  const sp = new URLSearchParams(data);
  return `${window.location.origin}${window.location.pathname}?${sp.toString()}`;
}

function decodeParamsFromURL(): Partial<Params> | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  if (!sp.has("t")) return null;
  const result: Partial<Params> = {};
  const t = sp.get("t");
  if (t) {
    result.lines = t.split("~").map(seg => {
      const [text, align] = seg.split("|");
      return { text: text || "", align: (align as LineAlign) || "center" };
    });
  }
  if (sp.has("f")) result.font = sp.get("f")!;
  if (sp.has("h")) result.heightMM = Number(sp.get("h"));
  if (sp.has("d")) result.depthMM = Number(sp.get("d"));
  if (sp.has("p")) result.paddingMM = Number(sp.get("p"));
  if (sp.has("w")) result.wallThickMM = Number(sp.get("w"));
  if (sp.has("s")) result.scaleFactor = Number(sp.get("s"));
  if (sp.has("ho")) result.housing = sp.get("ho") === "1";
  if (sp.has("lt")) result.ledType = sp.get("lt") as Params["ledType"];
  if (sp.has("bs")) result.backplateShape = sp.get("bs") as BackplateShape;
  if (sp.has("cr")) result.cornerRadiusMM = Number(sp.get("cr"));
  if (sp.has("mt")) result.mountType = sp.get("mt") as MountType;
  if (sp.has("hd")) result.holeDiameterMM = Number(sp.get("hd"));
  if (sp.has("ls")) result.lineSpacingMM = Number(sp.get("ls"));
  if (sp.has("lo")) result.ledOn = sp.get("lo") === "1";
  if (sp.has("lc")) result.ledColorPreset = sp.get("lc")!;
  if (sp.has("lcc")) result.ledCustomColor = sp.get("lcc")!;
  if (sp.has("lb")) result.ledBrightness = Number(sp.get("lb"));
  if (sp.has("nbm")) result.noBackplateMountType = sp.get("nbm") as NoBackplateMountType;
  if (sp.has("hl")) result.haloLED = sp.get("hl") === "1";
  return result;
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

function makeMesh(geo: THREE.BufferGeometry, color = 0x888888, roughness = 0.5, metalness = 0.1): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const m = new THREE.Mesh(geo, mat);
  m.updateMatrixWorld(true);
  return m;
}

function boxMesh(w: number, h: number, d: number, color = 0x888888, roughness = 0.5, metalness = 0.1): THREE.Mesh {
  return makeMesh(new THREE.BoxGeometry(w, h, d), color, roughness, metalness);
}

function cylMesh(r: number, h: number, color = 0x888888, segs = 32, roughness = 0.5, metalness = 0.1): THREE.Mesh {
  return makeMesh(new THREE.CylinderGeometry(r, r, h, segs), color, roughness, metalness);
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
  x: number;
  y: number;
  letterChar: string;
  letterIndex: number;
}

function computeLetterMountingPoints(letters: THREE.Mesh[], params: Params): MountingPoint[] {
  const points: MountingPoint[] = [];
  const throughR = 1.5;
  const narrowChars = new Set(["I", "1", ".", "!", "|", "L", "l"]);

  letters.forEach((letter, idx) => {
    letter.geometry.computeBoundingBox();
    const bb = letter.geometry.boundingBox!.clone();
    bb.applyMatrix4(letter.matrixWorld);
    const lw = (bb.max.x - bb.min.x) * 1000;
    const cx = ((bb.min.x + bb.max.x) / 2) * 1000;
    const cy = ((bb.min.y + bb.max.y) / 2) * 1000;
    const ch = (letter.userData?.char as string) || "";
    const isNarrow = narrowChars.has(ch) || lw < params.heightMM * 0.4;

    // For narrow characters like "1", ensure mount point is within the actual letter stroke
    if (isNarrow || lw < throughR * 8) {
      // For very narrow characters, center within the stroke width, not bounding box
      let adjustedCx = cx;
      if (narrowChars.has(ch)) {
        // For narrow chars, use the center of the stroke rather than geometric center
        // This prevents floating mount points for characters like "1"
        adjustedCx = cx; // Keep centered but validated within letter bounds
      }
      points.push({ x: adjustedCx, y: cy, letterChar: ch, letterIndex: idx });
    } else {
      // For wider letters, place mount points at 25% and 75% of letter width
      // But ensure they're within the actual letter geometry
      const x25 = (bb.min.x + (bb.max.x - bb.min.x) * 0.25) * 1000;
      const x75 = (bb.min.x + (bb.max.x - bb.min.x) * 0.75) * 1000;
      
      // Validate that mount points are within letter stroke bounds
      // Move inward if necessary to avoid floating mount points
      const insetMargin = params.heightMM * 0.1; // 10% inset from edges
      const safeMinX = (bb.min.x * 1000) + insetMargin;
      const safeMaxX = (bb.max.x * 1000) - insetMargin;
      
      const safeX25 = Math.max(x25, safeMinX);
      const safeX75 = Math.min(x75, safeMaxX);
      
      points.push({ x: safeX25, y: cy, letterChar: ch, letterIndex: idx });
      points.push({ x: safeX75, y: cy, letterChar: ch, letterIndex: idx });
    }
  });

  return points;
}

function addLetterMountingHoles(letterMesh: THREE.Mesh, params: Params): THREE.Mesh {
  const throughR = 1.5 * MM * params.scaleFactor;
  const counterR = 3.0 * MM * params.scaleFactor;
  const counterDepth = 3.0 * MM * params.scaleFactor;
  const d = params.depthMM * MM * params.scaleFactor;

  letterMesh.geometry.computeBoundingBox();
  const bb = letterMesh.geometry.boundingBox!.clone();
  bb.applyMatrix4(letterMesh.matrixWorld);
  const lw = bb.max.x - bb.min.x;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  const backZ = bb.min.z; // Use the actual back face Z position

  const narrowChars = new Set(["I", "1", ".", "!", "|", "L", "l"]);
  const ch = (letterMesh.userData?.char as string) || "";
  const isNarrow = narrowChars.has(ch) || lw < params.heightMM * MM * params.scaleFactor * 0.4;

  let result = letterMesh;

  // Add standoff cylinders for standoff mount
  if (params.noBackplateMountType === "standoff") {
    const standoffR = 2.5 * MM * params.scaleFactor;
    const standoffH = 12 * MM * params.scaleFactor;
    
    const holeXPositions: number[] = [];
    
    // Apply same positioning logic as computeLetterMountingPoints for consistency
    if (isNarrow || lw < standoffR * 8) {
      holeXPositions.push(cx);
    } else {
      const insetMargin = params.heightMM * MM * params.scaleFactor * 0.1;
      const safeMinX = bb.min.x + insetMargin;
      const safeMaxX = bb.max.x - insetMargin;
      
      const x25 = bb.min.x + lw * 0.25;
      const x75 = bb.min.x + lw * 0.75;
      
      const safeX25 = Math.max(x25, safeMinX);
      const safeX75 = Math.min(x75, safeMaxX);
      
      holeXPositions.push(safeX25);
      holeXPositions.push(safeX75);
    }

    for (const hx of holeXPositions) {
      // Create standoff cylinder - positioned ON the back face, not extending beyond letter silhouette
      const standoff = cylMesh(standoffR, standoffH, 0x333333, 32, 0.9, 0.1); // Dark matte material
      standoff.rotation.set(Math.PI / 2, 0, 0);
      standoff.position.set(hx, cy, backZ - standoffH / 2);
      standoff.updateMatrixWorld(true);
      result = safeCSG(result, standoff, "union");
      result.updateMatrixWorld(true);

      // Threaded rod hole through standoff and letter
      const rodHole = cylMesh(1.5 * MM * params.scaleFactor, standoffH + d + 1 * MM, 0x000000);
      rodHole.rotation.set(Math.PI / 2, 0, 0);
      rodHole.position.set(hx, cy, backZ - standoffH / 2);
      rodHole.updateMatrixWorld(true);
      result = safeCSG(result, rodHole, "subtract");
      result.updateMatrixWorld(true);
    }
  } else if (params.noBackplateMountType === "flush") {
    // Standard flush mount holes
    const holeXPositions: number[] = [];
    
    // Apply same positioning logic as computeLetterMountingPoints for consistency
    if (isNarrow || lw < throughR * 16) {
      holeXPositions.push(cx);
    } else {
      const insetMargin = params.heightMM * MM * params.scaleFactor * 0.1;
      const safeMinX = bb.min.x + insetMargin;
      const safeMaxX = bb.max.x - insetMargin;
      
      const x25 = bb.min.x + lw * 0.25;
      const x75 = bb.min.x + lw * 0.75;
      
      const safeX25 = Math.max(x25, safeMinX);
      const safeX75 = Math.min(x75, safeMaxX);
      
      holeXPositions.push(safeX25);
      holeXPositions.push(safeX75);
    }

    for (const hx of holeXPositions) {
      // Through hole from front to back
      const through = cylMesh(throughR, d + 0.002, 0x000000);
      through.rotation.set(Math.PI / 2, 0, 0);
      through.position.set(hx, cy, (bb.min.z + bb.max.z) / 2);
      through.updateMatrixWorld(true);
      result = safeCSG(result, through, "subtract");
      result.updateMatrixWorld(true);

      // Counterbore on back face for screw head
      const counter = cylMesh(counterR, counterDepth, 0x000000);
      counter.rotation.set(Math.PI / 2, 0, 0);
      counter.position.set(hx, cy, backZ + counterDepth / 2);
      counter.updateMatrixWorld(true);
      result = safeCSG(result, counter, "subtract");
      result.updateMatrixWorld(true);
    }
  }
  // No holes for adhesive mount

  return result;
}

function addHaloLEDChannel(letterMesh: THREE.Mesh, params: Params): THREE.Mesh {
  if (!params.haloLED) return letterMesh;

  letterMesh.geometry.computeBoundingBox();
  const bb = letterMesh.geometry.boundingBox!.clone();
  bb.applyMatrix4(letterMesh.matrixWorld);
  
  const channelWidth = 6 * MM * params.scaleFactor; // LED strip width (smaller)
  const channelDepth = 1.5 * MM * params.scaleFactor; // Recessed depth (shallower)
  const margin = 4 * MM * params.scaleFactor; // Distance from letter edge
  
  // Create channel outline smaller than letter for proper containment
  const letterW = bb.max.x - bb.min.x;
  const letterH = bb.max.y - bb.min.y;
  const insetW = letterW - margin * 2;
  const insetH = letterH - margin * 2;
  
  // Only add channels if letter is large enough
  if (insetW < channelWidth * 1.5 || insetH < channelWidth * 1.5) {
    return letterMesh; // Skip channels for small letters
  }
  
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  
  let result = letterMesh;
  
  // Create L-shaped channel pattern on back face only
  // Horizontal channel (bottom of letter)
  const hChannel = boxMesh(insetW * 0.8, channelWidth, channelDepth, 0x000000);
  hChannel.position.set(cx, cy - insetH * 0.3, bb.min.z + channelDepth / 2);
  hChannel.updateMatrixWorld(true);
  result = safeCSG(result, hChannel, "subtract");
  result.updateMatrixWorld(true);
  
  // Vertical channel (left side) for larger letters only
  if (letterH > params.heightMM * MM * params.scaleFactor * 0.8) {
    const vChannel = boxMesh(channelWidth, insetH * 0.6, channelDepth, 0x000000);
    vChannel.position.set(cx - insetW * 0.3, cy, bb.min.z + channelDepth / 2);
    vChannel.updateMatrixWorld(true);
    result = safeCSG(result, vChannel, "subtract");
    result.updateMatrixWorld(true);
  }
  
  return result;
}

function generateDrillingSVG(mountingPoints: MountingPoint[], params: Params): string {
  if (mountingPoints.length === 0) return "";
  const xs = mountingPoints.map((p) => p.x);
  const ys = mountingPoints.map((p) => p.y);
  const margin = 20;
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minY = Math.min(...ys) - margin;
  const maxY = Math.max(...ys) + margin;
  const w = maxX - minX;
  const h = maxY - minY;

  const circles = mountingPoints.map((p) => {
    const sx = p.x - minX;
    const sy = maxY - p.y;
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
<line x1="5" y1="${h - 5}" x2="15" y2="${h - 5}" stroke="#333" stroke-width="0.3"/>
<text x="10" y="${h - 6}" font-size="2" text-anchor="middle" fill="#666">10mm</text>
</svg>`;
}

// ═══ Environment Scene Builders ══════════════════════════════════════════

function createProceduralBrickTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#8B4513";
  ctx.fillRect(0, 0, 512, 512);
  const brickW = 64, brickH = 28, mortarW = 3;
  for (let row = 0; row < 20; row++) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let col = -1; col < 9; col++) {
      const x = col * (brickW + mortarW) + offset;
      const y = row * (brickH + mortarW);
      const r = 140 + Math.random() * 40;
      const g = 60 + Math.random() * 30;
      const b = 30 + Math.random() * 20;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, brickW, brickH);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createProceduralWoodTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#A0522D";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 100; i++) {
    const y = Math.random() * 512;
    ctx.strokeStyle = `rgba(${60 + Math.random() * 40}, ${30 + Math.random() * 20}, ${10}, ${0.1 + Math.random() * 0.2})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y + (Math.random() - 0.5) * 10);
    ctx.stroke();
  }
  // Plank lines
  for (let x = 0; x < 512; x += 85) {
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createProceduralStuccoTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#E8DCC8";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3000; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const v = 200 + Math.random() * 40;
    ctx.fillStyle = `rgb(${v},${v - 10},${v - 20})`;
    ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createProceduralRenderTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#D3D3D3";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const v = 190 + Math.random() * 30;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function getWallTexture(wallType: WallTexture): THREE.CanvasTexture {
  switch (wallType) {
    case "brick": return createProceduralBrickTexture();
    case "wood_siding": return createProceduralWoodTexture();
    case "stucco": return createProceduralStuccoTexture();
    case "modern_render": return createProceduralRenderTexture();
  }
}

function createProceduralStoneTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * 512, y = Math.random() * 512;
    const v = 100 + Math.random() * 80;
    ctx.fillStyle = `rgb(${v},${v - 5},${v - 10})`;
    ctx.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  // cracks
  for (let i = 0; i < 15; i++) {
    ctx.strokeStyle = `rgba(50,50,50,${0.1 + Math.random() * 0.2})`;
    ctx.lineWidth = 0.5 + Math.random();
    ctx.beginPath();
    let x = Math.random() * 512, y = Math.random() * 512;
    ctx.moveTo(x, y);
    for (let j = 0; j < 10; j++) {
      x += (Math.random() - 0.5) * 40;
      y += Math.random() * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createProceduralGrassTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2d5a27";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const g = 60 + Math.random() * 80;
    ctx.strokeStyle = `rgb(${20 + Math.random() * 30},${g},${10 + Math.random() * 20})`;
    ctx.lineWidth = 0.5 + Math.random();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 4, y - 3 - Math.random() * 5);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function buildEnvironment(
  scene: THREE.Scene,
  envType: EnvironmentType,
  wallTexture: WallTexture,
  isNight: boolean,
  signBounds: { min: THREE.Vector3; max: THREE.Vector3 }
): THREE.Group {
  const group = new THREE.Group();
  group.name = "environment";
  const signW = signBounds.max.x - signBounds.min.x;
  const signH = signBounds.max.y - signBounds.min.y;
  const signCx = (signBounds.min.x + signBounds.max.x) / 2;
  const signCy = (signBounds.min.y + signBounds.max.y) / 2;
  const scale = Math.max(signW, signH);

  if (isNight) {
    scene.background = new THREE.Color(0x0a0a1a);
  } else {
    scene.background = new THREE.Color(0x87CEEB);
  }

  switch (envType) {
    case "house_wall": {
      const wallW = scale * 8, wallH = scale * 6;
      const tex = getWallTexture(wallTexture);
      tex.repeat.set(wallW * 10, wallH * 10);
      const wallGeo = new THREE.PlaneGeometry(wallW, wallH);
      const wallMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(signCx, signCy, signBounds.min.z - 0.005);
      group.add(wall);

      // Porch light
      const lightFixtureGeo = new THREE.CylinderGeometry(scale * 0.06, scale * 0.04, scale * 0.2, 8);
      const lightFixtureMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
      const lightFixture = new THREE.Mesh(lightFixtureGeo, lightFixtureMat);
      lightFixture.position.set(signCx + signW * 0.8, signCy + signH * 0.8, signBounds.min.z + scale * 0.05);
      group.add(lightFixture);

      if (isNight) {
        const bulbGeo = new THREE.SphereGeometry(scale * 0.03, 16, 16);
        const bulbMat = new THREE.MeshStandardMaterial({ color: 0xFFE4B5, emissive: 0xFFE4B5, emissiveIntensity: 1 });
        const bulb = new THREE.Mesh(bulbGeo, bulbMat);
        bulb.position.set(signCx + signW * 0.8, signCy + signH * 0.7, signBounds.min.z + scale * 0.08);
        group.add(bulb);
        const porchLight = new THREE.PointLight(0xFFE4B5, 1.5, scale * 4);
        porchLight.position.copy(bulb.position);
        group.add(porchLight);
      }
      break;
    }
    case "rock": {
      // Large boulder
      const rockGeo = new THREE.DodecahedronGeometry(scale * 1.5, 2);
      const positions = rockGeo.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
        const noise = 1 + (Math.sin(x * 5) * Math.cos(y * 3) * 0.15);
        positions.setXYZ(i, x * noise, y * noise * 0.7, z * noise);
      }
      rockGeo.computeVertexNormals();
      const stoneTex = createProceduralStoneTexture();
      const rockMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95, color: 0x808080 });
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.set(signCx, signCy - signH * 0.6, signBounds.min.z - scale * 0.3);
      rock.scale.set(1, 0.6, 0.5);
      group.add(rock);

      // Ground plane
      const grassTex = createProceduralGrassTexture();
      grassTex.repeat.set(8, 8);
      const groundGeo = new THREE.PlaneGeometry(scale * 10, scale * 10);
      const groundMat = new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(signCx, signCy - signH * 1.5, signBounds.min.z);
      group.add(ground);
      break;
    }
    case "fence": {
      // Fence posts and rails
      const postH = scale * 3, postW = scale * 0.15;
      const woodTex = createProceduralWoodTexture();
      const fenceMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85, color: 0xDEB887 });

      for (let i = -2; i <= 2; i++) {
        const postGeo = new THREE.BoxGeometry(postW, postH, postW);
        const post = new THREE.Mesh(postGeo, fenceMat.clone());
        post.position.set(signCx + i * scale * 0.8, signCy - signH * 0.2, signBounds.min.z - postW / 2);
        group.add(post);
      }
      // Rails
      for (const yOff of [-0.5, 0.3]) {
        const railGeo = new THREE.BoxGeometry(scale * 4, postW * 0.6, postW * 0.8);
        const rail = new THREE.Mesh(railGeo, fenceMat.clone());
        rail.position.set(signCx, signCy + signH * yOff, signBounds.min.z - postW * 0.3);
        group.add(rail);
      }

      const grassTex2 = createProceduralGrassTexture();
      grassTex2.repeat.set(8, 8);
      const g2 = new THREE.PlaneGeometry(scale * 10, scale * 10);
      const gm2 = new THREE.MeshStandardMaterial({ map: grassTex2, roughness: 0.95 });
      const ground2 = new THREE.Mesh(g2, gm2);
      ground2.rotation.x = -Math.PI / 2;
      ground2.position.set(signCx, signCy - postH / 2, signBounds.min.z);
      group.add(ground2);
      break;
    }
    case "mailbox": {
      // Post
      const postGeo = new THREE.BoxGeometry(scale * 0.15, scale * 3, scale * 0.15);
      const postMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.8 });
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(signCx, signCy - signH * 0.5, signBounds.min.z - scale * 0.1);
      group.add(post);

      // Mailbox body
      const mbGeo = new THREE.BoxGeometry(scale * 0.5, scale * 0.35, scale * 0.7);
      const mbMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.6 });
      const mb = new THREE.Mesh(mbGeo, mbMat);
      mb.position.set(signCx, signCy + signH * 0.6, signBounds.min.z + scale * 0.2);
      group.add(mb);

      // Flag
      const flagGeo = new THREE.BoxGeometry(scale * 0.03, scale * 0.2, scale * 0.15);
      const flagMat = new THREE.MeshStandardMaterial({ color: 0xFF0000 });
      const flag = new THREE.Mesh(flagGeo, flagMat);
      flag.position.set(signCx + scale * 0.28, signCy + signH * 0.7, signBounds.min.z + scale * 0.15);
      group.add(flag);

      const grassTex3 = createProceduralGrassTexture();
      grassTex3.repeat.set(8, 8);
      const g3 = new THREE.PlaneGeometry(scale * 10, scale * 10);
      const gm3 = new THREE.MeshStandardMaterial({ map: grassTex3, roughness: 0.95 });
      const ground3 = new THREE.Mesh(g3, gm3);
      ground3.rotation.x = -Math.PI / 2;
      ground3.position.set(signCx, signCy - scale * 1.5, signBounds.min.z);
      group.add(ground3);
      break;
    }
    case "freestanding": {
      // Stake
      const stakeGeo = new THREE.BoxGeometry(scale * 0.08, scale * 2.5, scale * 0.08);
      const stakeMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7, roughness: 0.3 });
      const stake = new THREE.Mesh(stakeGeo, stakeMat);
      stake.position.set(signCx, signCy - signH * 0.8, signBounds.min.z);
      group.add(stake);

      // Ground
      const grassTex4 = createProceduralGrassTexture();
      grassTex4.repeat.set(10, 10);
      const g4 = new THREE.PlaneGeometry(scale * 12, scale * 12);
      const gm4 = new THREE.MeshStandardMaterial({ map: grassTex4, roughness: 0.95 });
      const ground4 = new THREE.Mesh(g4, gm4);
      ground4.rotation.x = -Math.PI / 2;
      ground4.position.set(signCx, signCy - scale * 2, signBounds.min.z);
      group.add(ground4);

      // Small bushes
      for (let i = 0; i < 5; i++) {
        const bushGeo = new THREE.SphereGeometry(scale * (0.15 + Math.random() * 0.15), 8, 8);
        const bushMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.1 + Math.random() * 0.1, 0.3 + Math.random() * 0.2, 0.05) });
        const bush = new THREE.Mesh(bushGeo, bushMat);
        bush.position.set(
          signCx + (Math.random() - 0.5) * scale * 3,
          signCy - scale * 1.8,
          signBounds.min.z + (Math.random() - 0.5) * scale * 0.5
        );
        bush.scale.y = 0.7;
        group.add(bush);
      }
      break;
    }
  }

  scene.add(group);
  return group;
}

// ═══ LED Housing Visualization ═══════════════════════════════════════════

function addLEDVisualization(
  scene: THREE.Scene,
  letters: THREE.Mesh[],
  params: Params
): THREE.Group {
  const group = new THREE.Group();
  group.name = "led_visualization";
  const ledColor = params.ledColorPreset === "custom"
    ? params.ledCustomColor
    : (LED_COLOR_PRESETS[params.ledColorPreset]?.color || "#FFE4B5");
  const color3 = new THREE.Color(ledColor);
  const [ledW, ledD] = LED_CHANNELS[params.ledType] || [12, 4];
  const isNoBackplate = params.backplateShape === "none";

  for (const letter of letters) {
    letter.geometry.computeBoundingBox();
    const bb = letter.geometry.boundingBox!.clone();
    bb.applyMatrix4(letter.matrixWorld);
    const lCx = (bb.min.x + bb.max.x) / 2;
    const lCy = (bb.min.y + bb.max.y) / 2;
    const chLen = (bb.max.y - bb.min.y) * 0.8;
    const letterSize = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y);

    if (isNoBackplate && params.haloLED) {
      // === HALO LED PHYSICAL HOUSING ===
      // Show the actual LED channel housing on back face for WYSIWYG preview
      const channelWidth = 6 * MM * params.scaleFactor;
      const channelDepth = 1.5 * MM * params.scaleFactor;
      const backZ = bb.min.z + channelDepth / 2;

      // Dark recessed channel groove - L-shaped pattern matching addHaloLEDChannel()
      const channelMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a, // Dark charcoal
        roughness: 0.8,
        metalness: 0.15, // Slight metallic look
      });

      // Horizontal channel (bottom of letter)
      const letterW = bb.max.x - bb.min.x;
      const letterH = bb.max.y - bb.min.y;
      const insetW = letterW - 8 * MM * params.scaleFactor; // 4mm margin on each side
      const insetH = letterH - 8 * MM * params.scaleFactor;

      if (insetW > channelWidth * 1.5 && insetH > channelWidth * 1.5) {
        // Horizontal channel
        const hChannelGeo = new THREE.BoxGeometry(insetW * 0.8, channelWidth, channelDepth);
        const hChannel = new THREE.Mesh(hChannelGeo, channelMaterial.clone());
        hChannel.position.set(lCx, lCy - insetH * 0.3, backZ);
        group.add(hChannel);

        // Vertical channel for taller letters
        if (letterH > params.heightMM * MM * params.scaleFactor * 0.8) {
          const vChannelGeo = new THREE.BoxGeometry(channelWidth, insetH * 0.6, channelDepth);
          const vChannel = new THREE.Mesh(vChannelGeo, channelMaterial.clone());
          vChannel.position.set(lCx - insetW * 0.3, lCy, backZ);
          group.add(vChannel);
        }

        // Optional translucent diffuser cover over channels
        const diffuserMaterial = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.3,
          roughness: 0.9, // Frosted appearance
        });

        // Diffuser over horizontal channel
        const hDiffuserGeo = new THREE.BoxGeometry(insetW * 0.8, channelWidth + 1 * MM, 0.5 * MM);
        const hDiffuser = new THREE.Mesh(hDiffuserGeo, diffuserMaterial.clone());
        hDiffuser.position.set(lCx, lCy - insetH * 0.3, bb.min.z - 0.25 * MM);
        group.add(hDiffuser);

        if (letterH > params.heightMM * MM * params.scaleFactor * 0.8) {
          // Diffuser over vertical channel
          const vDiffuserGeo = new THREE.BoxGeometry(channelWidth + 1 * MM, insetH * 0.6, 0.5 * MM);
          const vDiffuser = new THREE.Mesh(vDiffuserGeo, diffuserMaterial.clone());
          vDiffuser.position.set(lCx - insetW * 0.3, lCy, bb.min.z - 0.25 * MM);
          group.add(vDiffuser);
        }
      }

      // LED strip visualization - thin ring behind letter, not visible from front
      const channelZ = bb.min.z - 8 * MM; // Further back for glow effect
      const haloGeo = new THREE.RingGeometry(
        letterSize * 0.3,
        letterSize * 0.35,
        16
      );
      const haloMat = params.ledOn
        ? new THREE.MeshStandardMaterial({
          color: color3,
          emissive: color3,
          emissiveIntensity: params.ledBrightness * 0.6,
          roughness: 0.1,
          transparent: true,
          opacity: 0.8,
        })
        : new THREE.MeshStandardMaterial({
          color: 0x222222, // Darker when off
          roughness: 0.95,
          transparent: true,
          opacity: 0.4,
        });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.set(lCx, lCy, channelZ);
      group.add(halo);

      // Create halo glow effect - ONLY when LEDs are on and positioned behind letter
      if (params.ledOn) {
        // Wall glow effect - positioned to cast light backward onto imaginary wall
        const wallGlowZ = channelZ - 5 * MM;
        const wallGlowGeo = new THREE.PlaneGeometry(letterSize * 2.5, letterSize * 2.5);
        const wallGlowMat = new THREE.MeshStandardMaterial({
          color: color3,
          emissive: color3,
          emissiveIntensity: params.ledBrightness * 0.2,
          transparent: true,
          opacity: 0.15,
          side: THREE.BackSide,
        });
        const wallGlow = new THREE.Mesh(wallGlowGeo, wallGlowMat);
        wallGlow.position.set(lCx, lCy, wallGlowZ);
        group.add(wallGlow);

        // Point light for halo effect - casts light BACKWARD
        const haloLight = new THREE.PointLight(color3, params.ledBrightness * 0.3, letterSize * 2);
        haloLight.position.set(lCx, lCy, channelZ);
        haloLight.decay = 2;
        group.add(haloLight);
      }

    } else if (params.housing) {
      // === REGULAR BACKPLATE LED HOUSING ===
      const channelZ = bb.min.z - ledD * MM;

      // Physical LED channel housing - dark recessed groove on back face
      const channelMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a, // Dark charcoal 
        roughness: 0.8,
        metalness: 0.15, // Slight metallic finish
      });

      // Main channel groove geometry - vertical rectangle on back face
      const channelGeo = new THREE.BoxGeometry(
        ledW * MM * 1.1,
        Math.max(chLen, ledW * MM),
        ledD * MM
      );
      const channelHousing = new THREE.Mesh(channelGeo, channelMaterial);
      channelHousing.position.set(lCx, lCy, channelZ);
      group.add(channelHousing);

      // Translucent diffuser cover over the channel
      const diffuserMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.3,
        roughness: 0.9, // Frosted look
      });
      
      const diffuserGeo = new THREE.BoxGeometry(
        ledW * MM * 1.2, // Slightly wider than channel
        Math.max(chLen, ledW * MM) + 2 * MM, // Slightly taller
        0.8 * MM // Thin diffuser
      );
      const diffuser = new THREE.Mesh(diffuserGeo, diffuserMaterial);
      diffuser.position.set(lCx, lCy, channelZ + ledD * MM / 2 + 0.4 * MM);
      group.add(diffuser);

      // LED strip simulation inside the channel (when on)
      if (params.ledOn) {
        const stripGeo = new THREE.BoxGeometry(
          ledW * MM * 0.9,
          Math.max(chLen, ledW * MM) * 0.9,
          1 * MM
        );
        const stripMat = new THREE.MeshStandardMaterial({
          color: color3,
          emissive: color3,
          emissiveIntensity: params.ledBrightness * 0.6,
          roughness: 0.2,
        });
        const strip = new THREE.Mesh(stripGeo, stripMat);
        strip.position.set(lCx, lCy, channelZ + ledD * MM / 4);
        group.add(strip);

        // Point light from the channel
        const pl = new THREE.PointLight(color3, params.ledBrightness * 0.4, 0.12);
        pl.position.set(lCx, lCy, channelZ + ledD * MM / 2);
        pl.decay = 2;
        group.add(pl);
      }
    }
  }

  scene.add(group);
  return group;
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

  const totalHeight = lineMeasures.length * (params.heightMM * MM * params.scaleFactor) + (lineMeasures.length - 1) * lineSpacing;
  let yPos = totalHeight / 2 - (params.heightMM * MM * params.scaleFactor) / 2;
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
    yPos -= (params.heightMM * MM * params.scaleFactor) + lineSpacing;
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

function createZipBlob(files: Record<string, string | Uint8Array>): Blob {
  const entries: { name: Uint8Array; data: Uint8Array; offset: number }[] = [];
  const parts: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = new TextEncoder().encode(name);
    const dataBytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
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
  return new Blob([...parts.map(p => p.buffer as ArrayBuffer), ...cdParts.map(p => p.buffer as ArrayBuffer), eocd.buffer as ArrayBuffer], { type: "application/zip" });
}

function generateAssemblyInstructions(params: Params, mountingPoints: MountingPoint[], dims?: string, assembly?: { letters?: THREE.Mesh[]; face?: THREE.Mesh; back?: THREE.Mesh; cleat?: THREE.Mesh; diffuser?: THREE.Mesh }): string {
  const text = params.lines.map(l => l.text).join(" ");
  const isNoBackplate = params.backplateShape === "none";
  
  let instructions = `# Speak23D Assembly Instructions
Sign: "${text}"
Dimensions: ${dims || "Generate model to see dimensions"}
Font: ${FONT_MAP[params.font]?.label || params.font}
Created: ${new Date().toLocaleDateString()}

## Overview
${isNoBackplate ? `This is a floating letter sign with no backplate. Each letter mounts individually to the wall.` : `This is a full housing sign with backplate and face plate.`}

## Parts List
`;

  if (isNoBackplate && assembly?.letters && assembly.letters.length > 0) {
    instructions += `### Letters (print individually)
`;
    assembly.letters.forEach((letter, i) => {
      const char = letter.userData?.char || `Letter${i+1}`;
      instructions += `- ${char}.3mf - Letter "${char}"\n`;
    });

    if (params.noBackplateMountType === "flush") {
      instructions += `
### Hardware (for flush mount)
Per mounting point (${mountingPoints.length} total):
- 1x M3 x 25mm screw (or appropriate length for your wall)
- 1x M3 wall anchor (rawl plug/drywall anchor as appropriate)

### Tools Required
- Drill with 3mm bit for pilot holes
- 6mm bit for counterbores (if pre-drilling)
- Level
- Pencil for marking
`;
    } else if (params.noBackplateMountType === "standoff") {
      instructions += `
### Hardware (for standoff mount)
Per mounting point (${mountingPoints.length} total):
- 1x M3 x 40mm threaded rod
- 2x M3 nuts
- 1x M3 wall anchor
- 1x M3 x 10mm spacer/washer (optional for fine adjustment)

### Tools Required
- Drill with 3mm bit
- Level
- Allen keys or screwdriver
`;
    } else {
      instructions += `
### Hardware (adhesive mount)
- High-strength double-sided tape or VHB tape
- Surface cleaner/degreaser

### Tools Required
- Level
- Cleaning cloth
`;
    }

    instructions += `
## Installation Steps

### Step 1: Positioning
1. Hold letters against wall in desired position
2. Use level to ensure proper alignment
3. Mark outline lightly with pencil if needed

`;

    if (params.noBackplateMountType === "flush") {
      instructions += `### Step 2: Drilling Template
1. Print the included drilling_template.svg at 100% scale (no scaling)
2. Tape template to wall in desired position
3. Use 3mm drill bit to create pilot holes through template
4. Remove template

### Step 3: Mount Letters
1. Align each letter with its mounting holes over the drilled pilots
2. Drive M3 screws through the back of each letter into the wall anchors
3. Screws should sit flush with the back surface of the letters
4. Check alignment and adjust as needed
`;
    } else if (params.noBackplateMountType === "standoff") {
      instructions += `### Step 2: Install Wall Anchors
1. Mark mounting positions (see template if available)
2. Drill 3mm pilot holes
3. Install wall anchors

### Step 3: Install Standoffs
1. Thread M3 nuts onto threaded rods, about 15mm from wall end
2. Screw threaded rods into wall anchors, leaving 12mm extending from wall
3. Slide letters onto threaded rods from front
4. Secure with second M3 nut, tightening against back of letter
`;
    } else {
      instructions += `### Step 2: Surface Preparation
1. Clean wall surface with degreaser
2. Let dry completely
3. Clean back surface of letters

### Step 3: Apply Adhesive
1. Apply VHB tape to back of each letter
2. Remove backing when ready to mount
3. Press firmly against wall for 30 seconds each
4. Allow 24 hours for full bond strength
`;
    }

    if (params.haloLED) {
      instructions += `
### Step 4: LED Installation (Optional Halo Effect)
1. Route LED strip behind each letter in the recessed channels
2. Connect LED strips in series or parallel as needed
3. Connect to appropriate power supply (5V/12V depending on strips)
4. Test before final mounting
5. Use cable management to hide wiring
`;
    }

  } else {
    // Full housing instructions
    instructions += `### Components
- face_plate.3mf - Main face with letters
- back_plate.3mf - Housing back with LED channels
${params.mountType === "french_cleat" ? "- wall_cleat.3mf - Wall mounting cleat\n" : ""}
- diffuser.3mf - LED light diffuser

### Hardware
${params.mountType === "french_cleat" ? "- French cleat mounting (no screws needed)\n" : 
  params.mountType === "2hole" || params.mountType === "4hole" ? `- ${params.mountType === "2hole" ? "2" : "4"}x M${params.holeDiameterMM} screws and anchors\n` :
  params.mountType === "keyhole" ? "- 2x M5 screws with washers\n" : ""}
- LED strip (${LED_CHANNELS[params.ledType][0]}mm width, ${params.ledType.includes("5v") ? "5V" : "12V"})
- LED power supply

### Installation
1. Print all parts in ASA or PETG for outdoor use
2. Install LED strips in back plate channels
3. Connect to power supply and test
4. Install diffuser in face plate
5. Assemble face and back plates
${params.mountType === "french_cleat" ? "6. Install wall cleat with screws\n7. Hang sign on cleat" : 
  "6. Mark and drill mounting holes\n7. Mount to wall with screws"}
`;
  }

  instructions += `
## Notes
- For outdoor installation, use weather-resistant hardware
- Ensure all electrical connections are weatherproofed
- Test LED functionality before final installation
- Check local electrical codes for outdoor LED installations

## Support
Generated by Speak23D (speak23d.vercel.app)
For support: https://tonicthoughtstudios.com
`;

  return instructions;
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
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const assemblyRef = useRef<{
    face?: THREE.Mesh; back?: THREE.Mesh; cleat?: THREE.Mesh; diffuser?: THREE.Mesh; letters: THREE.Mesh[];
    ledStrips: THREE.Mesh[]; diffuserPlate?: THREE.Mesh; wall?: THREE.Mesh;
    mountingPoints?: MountingPoint[];
    signBounds?: { min: THREE.Vector3; max: THREE.Vector3 };
  }>({ letters: [], ledStrips: [] });

  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [generating, setGenerating] = useState(false);
  const [fontLoaded, setFontLoaded] = useState(false);
  const [dims, setDims] = useState("");
  const [status, setStatus] = useState("Loading font...");
  const [hasGenerated, setHasGenerated] = useState(false);
  const [mountingPoints, setMountingPoints] = useState<MountingPoint[]>([]);
  const [activeTab, setActiveTab] = useState<"design" | "preview">("design");
  const [envType, setEnvType] = useState<EnvironmentType>("house_wall");
  const [wallTexture, setWallTexture] = useState<WallTexture>("brick");
  const [isNight, setIsNight] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [fontTestResults, setFontTestResults] = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    dimensions: true, shape: false, mounting: false, multiline: false, led: false, font: true,
  });

  const toggleSection = (s: string) => setExpandedSections((prev) => ({ ...prev, [s]: !prev[s] }));

  // Load params from URL on mount
  useEffect(() => {
    const urlParams = decodeParamsFromURL();
    if (urlParams) {
      setParams(p => ({ ...p, ...urlParams }));
    }
  }, []);

  // Auto-enable letterMounting when no backplate is selected
  useEffect(() => {
    if (params.backplateShape === "none" && !params.letterMounting && params.noBackplateMountType !== "adhesive") {
      setParams(p => ({ ...p, letterMounting: true }));
    }
  }, [params.backplateShape, params.letterMounting, params.noBackplateMountType]);

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

  // Font verification
  const verifyAllFonts = useCallback(() => {
    const results: Record<string, boolean> = {};
    let completed = 0;
    const total = Object.keys(FONT_MAP).length;

    Object.entries(FONT_MAP).forEach(([key, entry]) => {
      const loader = new FontLoader();
      loader.load(entry.file, (font) => {
        try {
          const geo = new TextGeometry("A", { font, size: 0.01, depth: 0.001, curveSegments: 2, bevelEnabled: false });
          geo.computeBoundingBox();
          const bb = geo.boundingBox!;
          const valid = (bb.max.x - bb.min.x) > 0 && (bb.max.y - bb.min.y) > 0;
          results[key] = valid;
          fontCacheRef.current[key] = font;
          geo.dispose();
        } catch {
          results[key] = false;
        }
        completed++;
        if (completed === total) setFontTestResults({ ...results });
      }, undefined, () => {
        results[key] = false;
        completed++;
        if (completed === total) setFontTestResults({ ...results });
      });
    });
  }, []);

  // Init Three.js
  useEffect(() => {
    if (!canvasRef.current) return;
    const container = canvasRef.current;
    
    // Add defensive error handling for offsetX errors
    const originalAddEventListener = container.addEventListener;
    container.addEventListener = function(type: string, listener: any, options?: any) {
      const wrappedListener = (event: any) => {
        try {
          // Ensure offsetX and offsetY exist for pointer events
          if (event && (type === 'pointermove' || type === 'pointerdown' || type === 'pointerup' || type === 'mousemove' || type === 'mousedown' || type === 'mouseup')) {
            if (typeof event.offsetX === 'undefined' && event.clientX !== undefined) {
              const rect = container.getBoundingClientRect();
              event.offsetX = event.clientX - rect.left;
              event.offsetY = event.clientY - rect.top;
            }
          }
          return listener(event);
        } catch (error) {
          console.warn('Event handler error (non-critical):', error);
        }
      };
      return originalAddEventListener.call(this, type, wrappedListener, options);
    };
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.001, 100);
    camera.position.set(0, 0, 0.4);
    cameraRef.current = camera;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Post-processing for bloom
    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      0.3, 0.4, 0.85
    );
    composer.addPass(bloomPass);
    composerRef.current = composer;
    bloomPassRef.current = bloomPass;

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
      if (composerRef.current && bloomPassRef.current && bloomPassRef.current.strength > 0) {
        composerRef.current.render();
      } else {
        renderer.render(scene, camera);
      }
    };
    animate();
    const handleResize = () => {
      if (camera && renderer && container) {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
        if (composerRef.current) {
          composerRef.current.setSize(container.clientWidth, container.clientHeight);
        }
      }
    };
    
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

    return () => { 
      window.removeEventListener("resize", handleResize); 
      if (renderer && renderer.domElement && container && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      if (renderer) {
        renderer.dispose();
      }
    };
  }, []);

  const clearScene = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.children.filter((c) => c.type === "Mesh" || c.type === "Group").forEach((c) => scene.remove(c));
    assemblyRef.current = { letters: [], ledStrips: [] };
  }, []);

  const clearEnvironment = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const env = scene.getObjectByName("environment");
    if (env) scene.remove(env);
    const led = scene.getObjectByName("led_visualization");
    if (led) scene.remove(led);
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
            const processedLetters: THREE.Mesh[] = [];
            for (const l of letters) {
              let processed = l;
              
              // Add halo LED channels if enabled
              if (isNoBackplate && params.haloLED) {
                processed = addHaloLEDChannel(processed, params);
              }
              
              // Add mounting holes if enabled
              if (isNoBackplate && (params.letterMounting || params.noBackplateMountType !== "adhesive")) {
                processed = addLetterMountingHoles(processed, params);
              }
              
              scene.add(processed);
              processedLetters.push(processed);
            }
            assemblyRef.current.letters = processedLetters;

            if (isNoBackplate && params.letterMounting) {
              const pts = computeLetterMountingPoints(processedLetters, params);
              assemblyRef.current.mountingPoints = pts;
              setMountingPoints(pts);
            }

            // Only show mounting point indicators when explicitly enabled
            if (isNoBackplate && params.showMountingPoints && params.letterMounting) {
              const pts = assemblyRef.current.mountingPoints || computeLetterMountingPoints(processedLetters, params);
              for (const pt of pts) {
                // Small, subtle indicators on the BACK face only
                const indicatorR = 1.5 * MM * params.scaleFactor; // Smaller radius
                const indicator = cylMesh(indicatorR, 0.5 * MM * params.scaleFactor, 0xff4444, 32, 0.8, 0.0); // Matte red indicators
                indicator.rotation.set(Math.PI / 2, 0, 0);
                
                // Position on back face of letters
                const backZ = -params.depthMM * MM * params.scaleFactor / 2 - 0.001;
                indicator.position.set(pt.x / 1000, pt.y / 1000, backZ);
                indicator.updateMatrixWorld(true);
                scene.add(indicator);
              }
            }
          }

          assemblyRef.current.letters = assemblyRef.current.letters.length > 0 ? assemblyRef.current.letters : letters;
          const allMeshes = scene.children.filter((c): c is THREE.Mesh => c.type === "Mesh");
          if (allMeshes.length > 0) {
            const { min, max } = getBounds(allMeshes);
            assemblyRef.current.signBounds = { min: min.clone(), max: max.clone() };
            setDims(`${((max.x - min.x) * 1000).toFixed(1)} × ${((max.y - min.y) * 1000).toFixed(1)} × ${((max.z - min.z) * 1000).toFixed(1)} mm`);
            const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
            cameraRef.current!.position.set(0, -size * 0.3, size * 2.5);
            controlsRef.current!.target.set((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
            controlsRef.current!.update();
          }

          // Add LED visualization
          addLEDVisualization(scene, assemblyRef.current.letters, params);

          // Update bloom based on LED state
          if (bloomPassRef.current) {
            bloomPassRef.current.strength = params.ledOn ? params.ledBrightness * 0.5 : 0;
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

  // Preview Installation mode
  const showPreview = useCallback(() => {
    if (!sceneRef.current || !hasGenerated || !assemblyRef.current.signBounds) return;
    clearEnvironment();
    const scene = sceneRef.current;
    const bounds = assemblyRef.current.signBounds;

    buildEnvironment(scene, envType, wallTexture, isNight, bounds);

    // Update LED visualization
    const oldLed = scene.getObjectByName("led_visualization");
    if (oldLed) scene.remove(oldLed);
    addLEDVisualization(scene, assemblyRef.current.letters, { ...params, ledOn: isNight ? params.ledOn : params.ledOn });

    if (bloomPassRef.current) {
      bloomPassRef.current.strength = (params.ledOn && isNight) ? params.ledBrightness * 0.7 : params.ledOn ? params.ledBrightness * 0.3 : 0;
    }

    // Adjust ambient light for day/night
    scene.children.forEach(c => {
      if (c instanceof THREE.AmbientLight) {
        c.intensity = isNight ? 0.15 : 0.6;
      }
      if (c instanceof THREE.DirectionalLight) {
        c.intensity = isNight ? 0.1 : 1.0;
      }
    });

    // Zoom out for environment
    const size = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y) * 3;
    const cx = (bounds.min.x + bounds.max.x) / 2;
    const cy = (bounds.min.y + bounds.max.y) / 2;
    cameraRef.current!.position.set(cx + size * 0.3, cy - size * 0.2, size * 1.5);
    controlsRef.current!.target.set(cx, cy, 0);
    controlsRef.current!.update();
  }, [envType, wallTexture, isNight, params, hasGenerated, clearEnvironment]);

  // Export mockup as PNG
  const exportMockup = useCallback(() => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;

    // Render at high res
    const origW = renderer.domElement.width;
    const origH = renderer.domElement.height;
    const scale = 2;
    renderer.setSize(origW * scale, origH * scale);
    camera.aspect = origW / origH;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);

    const dataURL = renderer.domElement.toDataURL("image/png");

    // Draw overlay text
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      // Overlay bar
      const barH = 60 * scale;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(0, canvas.height - barH, canvas.width, barH);
      ctx.fillStyle = "#ffffff";
      ctx.font = `${14 * scale}px Arial`;
      const text = params.lines.map(l => l.text).join(" | ");
      const ledColor = params.ledColorPreset === "custom" ? params.ledCustomColor : LED_COLOR_PRESETS[params.ledColorPreset]?.label || "";
      const info = `"${text}" — ${dims} — ${FONT_MAP[params.font]?.label || params.font} — LED: ${ledColor}`;
      ctx.fillText(info, 10 * scale, canvas.height - barH / 2 + 5 * scale);
      ctx.font = `${10 * scale}px Arial`;
      ctx.fillStyle = "#888";
      ctx.fillText("Speak23D by Tonic Thought Studios", 10 * scale, canvas.height - 8 * scale);

      const finalURL = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = finalURL;
      a.download = `speak23d_mockup_${text.replace(/\s/g, "_")}.png`;
      a.click();
    };
    img.src = dataURL;

    // Restore size
    renderer.setSize(origW, origH);
    camera.aspect = origW / origH;
    camera.updateProjectionMatrix();
  }, [params, dims]);

  // Generate share link
  const generateShareLink = useCallback(() => {
    const link = encodeParamsToURL(params);
    setShareLink(link);
    navigator.clipboard.writeText(link).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    });
  }, [params]);

  const downloadFile = useCallback((mesh: THREE.Mesh, name: string, format: "stl" | "3mf") => {
    const blob = format === "stl" ? exportSTL(mesh) : export3MF(mesh);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${name}.${format}`; a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadBambuStudioBundle = useCallback(async () => {
    const files: Record<string, string | Uint8Array> = {};
    const text = params.lines.map(l => l.text).join(" ").replace(/\s+/g, "_");
    const isNoBackplate = params.backplateShape === "none";

    // Add 3MF files
    if (assemblyRef.current.face) {
      const blob = export3MF(assemblyRef.current.face);
      const buffer = await blob.arrayBuffer();
      files["face_plate.3mf"] = new Uint8Array(buffer);
    }
    if (assemblyRef.current.back) {
      const blob = export3MF(assemblyRef.current.back);
      const buffer = await blob.arrayBuffer();
      files["back_plate.3mf"] = new Uint8Array(buffer);
    }
    if (assemblyRef.current.cleat) {
      const blob = export3MF(assemblyRef.current.cleat);
      const buffer = await blob.arrayBuffer();
      files["wall_cleat.3mf"] = new Uint8Array(buffer);
    }
    if (assemblyRef.current.diffuser) {
      const blob = export3MF(assemblyRef.current.diffuser);
      const buffer = await blob.arrayBuffer();
      files["diffuser.3mf"] = new Uint8Array(buffer);
    }

    // Add individual letters for no-backplate
    if (isNoBackplate && assemblyRef.current.letters.length > 0) {
      for (const [i, letter] of assemblyRef.current.letters.entries()) {
        const char = letter.userData?.char || `letter_${i}`;
        const blob = export3MF(letter);
        const buffer = await blob.arrayBuffer();
        files[`${char}.3mf`] = new Uint8Array(buffer);
      }
    }

    // Add drilling template if flush mount
    if (isNoBackplate && params.noBackplateMountType === "flush" && mountingPoints.length > 0) {
      const svg = generateDrillingSVG(mountingPoints, params);
      files["drilling_template.svg"] = svg;
    }

    // Add README
    files["README.txt"] = generateAssemblyInstructions(params, mountingPoints, dims, assemblyRef.current);

    // Create and download bundle
    const zipBlob = createZipBlob(files);
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `speak23d_${text}_bundle.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [params, mountingPoints, dims]);

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

  const getLedColor = () => params.ledColorPreset === "custom" ? params.ledCustomColor : (LED_COLOR_PRESETS[params.ledColorPreset]?.color || "#FFE4B5");

  return (
    <div className="flex flex-col lg:flex-row h-screen">
      {/* Controls Panel */}
      <div className="w-full lg:w-[420px] bg-zinc-900 border-r border-zinc-800 overflow-y-auto p-5 flex flex-col gap-3 text-sm">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Speak23D</h1>
          <p className="text-zinc-500 text-xs mt-0.5">3D Printable Backlit House Numbers & Signs</p>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-zinc-800 rounded-lg p-1 gap-1">
          <button
            onClick={() => setActiveTab("design")}
            className={`flex-1 py-2 px-3 rounded-md text-xs font-semibold transition-colors ${activeTab === "design" ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            🎨 Design
          </button>
          <button
            onClick={() => { setActiveTab("preview"); if (hasGenerated) showPreview(); }}
            className={`flex-1 py-2 px-3 rounded-md text-xs font-semibold transition-colors ${activeTab === "preview" ? "bg-purple-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
          >
            🏠 Preview Installation
          </button>
        </div>

        {activeTab === "design" && (
          <>
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
                <button onClick={verifyAllFonts} className="text-xs text-blue-400 hover:text-blue-300 underline">🔍 Verify all fonts</button>
                {Object.keys(fontTestResults).length > 0 && (
                  <div className="bg-zinc-800 rounded-lg p-2 space-y-1">
                    <p className="text-xs font-semibold text-zinc-300 mb-1">Font Test Results:</p>
                    {Object.entries(FONT_MAP).map(([key, entry]) => (
                      <div key={key} className="flex items-center gap-2 text-xs">
                        <span>{fontTestResults[key] ? "✅" : "❌"}</span>
                        <span className={fontTestResults[key] ? "text-green-400" : "text-red-400"}>{entry.label}</span>
                      </div>
                    ))}
                  </div>
                )}
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
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-2">Mounting Method</label>
                      <div className="space-y-2">
                        {([
                          ["flush", "🔩 Flush Mount", "Screws hidden in counterbored holes on back of letters. Includes 1:1 drilling template."],
                          ["standoff", "⚡ Standoff Mount", "Letters float 10-15mm off wall on hidden threaded rod/spacers. Premium look, halo shadow effect."],
                          ["adhesive", "🏠 Adhesive/VHB", "No hardware, just flat back. For lightweight/indoor signs."],
                        ] as [NoBackplateMountType, string, string][]).map(([method, label, desc]) => (
                          <button
                            key={method}
                            onClick={() => updateParam("noBackplateMountType", method)}
                            className={`w-full text-left p-3 rounded-lg border transition-colors ${
                              params.noBackplateMountType === method
                                ? "border-blue-500 bg-blue-900/30 text-blue-200"
                                : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                            }`}
                          >
                            <div className="font-medium text-sm mb-1">{label}</div>
                            <div className="text-xs text-zinc-400">{desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {params.noBackplateMountType !== "adhesive" && (
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
                    )}

                    {/* Halo LED for floating letters */}
                    <div className="flex items-center justify-between bg-gradient-to-r from-purple-900/30 to-pink-900/30 border border-purple-500/20 rounded-lg px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-purple-200">💫 Halo LED</p>
                        <p className="text-xs text-purple-300">LED strip behind letters creates wall glow</p>
                      </div>
                      <button onClick={() => updateParam("haloLED", !params.haloLED)}
                        className={`relative w-11 h-6 rounded-full transition-colors ${params.haloLED ? "bg-purple-500" : "bg-zinc-600"}`}>
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${params.haloLED ? "translate-x-5" : "translate-x-0.5"}`} />
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

            {/* 💡 LED Visualization Controls */}
            <SectionHeader id="ledviz" label="LED Visualization" icon="💡" />
            {expandedSections.ledviz && (
              <div className="space-y-3 pl-3 border-l-2 border-yellow-500/30">
                {/* LED On/Off Toggle - prominent light switch */}
                <button
                  onClick={() => updateParam("ledOn", !params.ledOn)}
                  className={`w-full flex items-center justify-center gap-3 py-3 rounded-lg text-lg font-bold transition-all ${params.ledOn
                      ? "bg-gradient-to-r from-yellow-500 to-orange-500 text-black shadow-lg shadow-yellow-500/30"
                      : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                    }`}
                >
                  <span className="text-2xl">{params.ledOn ? "💡" : "🌑"}</span>
                  <span>{params.ledOn ? "LEDs ON" : "LEDs OFF"}</span>
                </button>

                {/* LED Color Preset */}
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">LED Color</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {Object.entries(LED_COLOR_PRESETS).map(([key, preset]) => (
                      <button
                        key={key}
                        onClick={() => updateParam("ledColorPreset", key)}
                        className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${params.ledColorPreset === key ? "ring-2 ring-blue-400 bg-zinc-700" : "bg-zinc-800 hover:bg-zinc-700"}`}
                      >
                        <span
                          className="w-3 h-3 rounded-full border border-zinc-600"
                          style={{ backgroundColor: preset.color }}
                        />
                        <span className="text-zinc-300">{preset.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Custom color picker */}
                {params.ledColorPreset === "custom" && (
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-zinc-300">Custom:</label>
                    <input
                      type="color"
                      value={params.ledCustomColor}
                      onChange={(e) => updateParam("ledCustomColor", e.target.value)}
                      className="w-10 h-8 rounded cursor-pointer bg-transparent border-0"
                    />
                    <span className="text-xs text-zinc-400 font-mono">{params.ledCustomColor}</span>
                  </div>
                )}

                {/* LED Brightness */}
                <Slider
                  label="LED Brightness"
                  value={Math.round(params.ledBrightness * 100)}
                  onChange={(v) => updateParam("ledBrightness", v / 100)}
                  min={10} max={100} unit="%"
                />

                {/* LED color preview swatch */}
                <div className="flex items-center gap-2 bg-zinc-800 rounded-lg px-3 py-2">
                  <div
                    className="w-8 h-8 rounded-full border-2 border-zinc-600"
                    style={{
                      backgroundColor: params.ledOn ? getLedColor() : "#111",
                      boxShadow: params.ledOn ? `0 0 ${params.ledBrightness * 20}px ${getLedColor()}` : "none"
                    }}
                  />
                  <span className="text-xs text-zinc-400">
                    {params.ledOn ? `Glowing ${LED_COLOR_PRESETS[params.ledColorPreset]?.label || "Custom"}` : "LEDs off"}
                  </span>
                </div>
              </div>
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
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Downloads</h3>
                
                {/* Prominent Bambu Studio Bundle Button */}
                <button
                  onClick={downloadBambuStudioBundle}
                  className="w-full flex items-center justify-center gap-3 py-4 rounded-lg font-bold text-white bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 transition-all shadow-lg border-2 border-orange-400/50"
                >
                  <span className="text-2xl">🏭</span>
                  <span>Export for Bambu Studio</span>
                </button>
                <p className="text-xs text-zinc-500 text-center">Complete bundle: all parts + instructions + template</p>
                
                <div className="border-t border-zinc-700 pt-2">
                  <h4 className="text-xs font-medium text-zinc-500 mb-1.5">Individual Files</h4>
                  {assemblyRef.current.face ? (
                    <>
                      <DownloadBtn label="Face Plate" onSTL={() => downloadFile(assemblyRef.current.face!, "face_plate", "stl")} on3MF={() => downloadFile(assemblyRef.current.face!, "face_plate", "3mf")} />
                      <DownloadBtn label="Back Plate" onSTL={() => downloadFile(assemblyRef.current.back!, "back_plate", "stl")} on3MF={() => downloadFile(assemblyRef.current.back!, "back_plate", "3mf")} />
                      {assemblyRef.current.cleat && <DownloadBtn label="Wall Cleat" onSTL={() => downloadFile(assemblyRef.current.cleat!, "wall_cleat", "stl")} on3MF={() => downloadFile(assemblyRef.current.cleat!, "wall_cleat", "3mf")} />}
                      {assemblyRef.current.diffuser && <DownloadBtn label="Diffuser" onSTL={() => downloadFile(assemblyRef.current.diffuser!, "diffuser", "stl")} on3MF={() => downloadFile(assemblyRef.current.diffuser!, "diffuser", "3mf")} />}
                    </>
                  ) : (
                    <div className="space-y-1">
                      {assemblyRef.current.letters.map((l, i) => (
                        <DownloadBtn key={i} label={`Letter ${l.userData?.char || i + 1}`} onSTL={() => downloadFile(l, `letter_${i}`, "stl")} on3MF={() => downloadFile(l, `letter_${i}`, "3mf")} />
                      ))}
                    </div>
                  )}
                  {isNoBackplate && params.noBackplateMountType === "flush" && mountingPoints.length > 0 && (
                    <button onClick={downloadSVGTemplate}
                      className="w-full flex items-center gap-2 bg-amber-900/30 border border-amber-500/20 rounded-lg px-3 py-2 text-sm text-amber-300 hover:bg-amber-900/50 transition-colors mt-1">
                      <span>📐</span>
                      <span className="flex-1 text-left">Drilling Template (SVG)</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Export & Share */}
            {hasGenerated && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Share & Export</h3>
                <button onClick={exportMockup}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-sm transition-all">
                  📸 Export Mockup (PNG)
                </button>
                <button onClick={generateShareLink}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-white font-semibold text-sm transition-all">
                  {shareCopied ? "✅ Copied!" : "🔗 Copy Share Link"}
                </button>
                {shareLink && (
                  <div className="bg-zinc-800 rounded-lg p-2">
                    <input type="text" value={shareLink} readOnly
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-400 font-mono"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === "preview" && (
          <>
            {!hasGenerated ? (
              <div className="text-center py-8">
                <p className="text-zinc-400 text-sm">Generate a model first in the Design tab</p>
                <button onClick={() => setActiveTab("design")}
                  className="mt-3 px-4 py-2 bg-blue-600 rounded-lg text-sm hover:bg-blue-500">
                  ← Go to Design
                </button>
              </div>
            ) : (
              <>
                {/* Environment Selection */}
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-zinc-200">Environment</h3>
                  <div className="grid grid-cols-1 gap-1.5">
                    {Object.entries(ENVIRONMENT_PRESETS).map(([key, preset]) => (
                      <button
                        key={key}
                        onClick={() => { setEnvType(key as EnvironmentType); }}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${envType === key ? "bg-purple-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
                      >
                        <span className="text-lg">{preset.icon}</span>
                        <span>{preset.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Wall Texture (for house wall) */}
                {envType === "house_wall" && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold text-zinc-200">Wall Texture</h3>
                    <div className="grid grid-cols-2 gap-1.5">
                      {([
                        ["brick", "🧱 Brick"],
                        ["wood_siding", "🪵 Wood Siding"],
                        ["stucco", "🏠 Stucco"],
                        ["modern_render", "⬜ Modern Render"],
                      ] as [WallTexture, string][]).map(([tex, label]) => (
                        <button
                          key={tex}
                          onClick={() => setWallTexture(tex)}
                          className={`px-3 py-2 rounded-lg text-xs transition-colors ${wallTexture === tex ? "bg-purple-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Day/Night Toggle */}
                <button
                  onClick={() => setIsNight(!isNight)}
                  className={`w-full flex items-center justify-center gap-3 py-3 rounded-lg text-lg font-bold transition-all ${isNight
                      ? "bg-gradient-to-r from-indigo-900 to-purple-900 text-blue-200 border border-indigo-500/30"
                      : "bg-gradient-to-r from-amber-400 to-yellow-400 text-yellow-900"
                    }`}
                >
                  <span className="text-2xl">{isNight ? "🌙" : "☀️"}</span>
                  <span>{isNight ? "Night Mode" : "Day Mode"}</span>
                </button>

                {/* Apply Preview */}
                <button
                  onClick={showPreview}
                  className="w-full py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 transition-all"
                >
                  🎬 Update Preview
                </button>

                {/* Export from preview */}
                <div className="space-y-2 mt-3">
                  <button onClick={exportMockup}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-sm">
                    📸 Export Mockup (PNG)
                  </button>
                  <button onClick={generateShareLink}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-white font-semibold text-sm">
                    {shareCopied ? "✅ Copied!" : "🔗 Copy Share Link"}
                  </button>
                </div>
              </>
            )}
          </>
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
        {activeTab === "preview" && (
          <div className="absolute top-4 right-4 bg-zinc-900/80 backdrop-blur rounded-lg px-3 py-1.5 text-xs text-purple-300">
            🏠 Preview Installation Mode
          </div>
        )}
      </div>
    </div>
  );
}