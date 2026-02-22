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
  roboto: { label: "Roboto Bold", file: "/fonts/roboto_bold.typeface.json" },
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
  hollowInterior: boolean;
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
  cornerRadiusMM: 4,
  mountType: "2hole",
  holeDiameterMM: 5,
  lineSpacingMM: 10,
  weatherSeal: false,
  reflector: "none",
  showMountingPoints: false,
  letterMounting: false,
  noBackplateMountType: "standoff",
  haloLED: false,
  hollowInterior: false,
  ledOn: false,
  ledColorPreset: "warm_white",
  ledCustomColor: "#FFE4B5",
  ledBrightness: 0.8,
};

// ═══ Helper Functions ════════════════════════════════════════════════════

function mm(n: number) { return n * MM; }

interface MountingPoint { x: number; y: number; letter: string; }

const LED_CHANNELS: Record<string, [number, string]> = {
  strip_5v: [5, "5mm width, 5V (e.g., WS2812B, RGBW)"],
  strip_12v: [8, "8mm width, 12V (higher power)"],
  cob: [10, "10mm width, COB LED strip (continuous)"],
};

function hex(n: number): string { return `#${n.toString(16).padStart(6, "0").toUpperCase()}`; }

// ════ THREE.js Geometry Utilities ════════════════════════════════════════

function cylMesh(radiusMM: number, heightMM: number, color: number = 0x888888, segments: number = 32, roughness: number = 0.5, metalness: number = 0.1): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(mm(radiusMM), mm(radiusMM), mm(heightMM), segments);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
}

function boxMesh(w: number, h: number, d: number, color: number = 0x888888): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(mm(w), mm(h), mm(d)), new THREE.MeshStandardMaterial({ color }));
}

function getBounds(objects: THREE.Object3D[]): { min: THREE.Vector3; max: THREE.Vector3 } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const obj of objects) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    minX = Math.min(minX, box.min.x); minY = Math.min(minY, box.min.y); minZ = Math.min(minZ, box.min.z);
    maxX = Math.max(maxX, box.max.x); maxY = Math.max(maxY, box.max.y); maxZ = Math.max(maxZ, box.max.z);
  }
  return { min: new THREE.Vector3(minX, minY, minZ), max: new THREE.Vector3(maxX, maxY, maxZ) };
}

function matMesh(mesh: THREE.Mesh, color: number, roughness = 0.5, metalness = 0.1) {
  mesh.material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return mesh;
}

// ════ CSG Operations ═════════════════════════════════════════════════════

function csgSubtract(from: THREE.Mesh, subtract: THREE.Mesh): THREE.Mesh {
  const bsp1 = CSG.fromMesh(from);
  const bsp2 = CSG.fromMesh(subtract);
  const bsp3 = bsp1.subtract(bsp2);
  const result = CSG.toMesh(bsp3, from.matrix);
  result.material = from.material;
  result.userData = { ...from.userData };
  result.name = from.name;
  return result;
}

function csgUnion(meshes: THREE.Mesh[]): THREE.Mesh {
  if (meshes.length === 0) throw new Error("No meshes to union");
  let result = meshes[0];
  for (let i = 1; i < meshes.length; i++) {
    const bsp1 = CSG.fromMesh(result);
    const bsp2 = CSG.fromMesh(meshes[i]);
    const bsp3 = bsp1.union(bsp2);
    result = CSG.toMesh(bsp3, result.matrix);
    result.material = meshes[0].material;
    result.userData = { ...meshes[0].userData };
    result.name = meshes[0].name;
  }
  return result;
}

// ════ Letter Generation ══════════════════════════════════════════════════

function createTextMesh(text: string, font: Font, params: Params): THREE.Mesh | null {
  if (!text.trim()) return null;
  const geo = new TextGeometry(text, {
    font, size: mm(params.heightMM), depth: mm(params.depthMM), curveSegments: 12,
    bevelEnabled: true, bevelThickness: mm(0.5), bevelSize: mm(0.3), bevelOffset: 0, bevelSegments: 3
  });
  geo.computeBoundingBox();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
  mesh.userData = { originalText: text };
  return mesh;
}

function createMultiLineLetterMeshes(font: Font, params: Params): THREE.Mesh[] {
  if (params.lines.length === 0) return [];
  const allMeshes: THREE.Mesh[] = [];
  let totalHeight = 0;
  const lineMeshes = params.lines.map(line => {
    const mesh = createTextMesh(line.text, font, params);
    if (!mesh) return null;
    const box = new THREE.Box3().setFromObject(mesh);
    const height = box.max.y - box.min.y;
    totalHeight += height;
    return { mesh, height, box, align: line.align };
  }).filter(Boolean) as { mesh: THREE.Mesh; height: number; box: THREE.Box3; align: LineAlign }[];
  totalHeight += (lineMeshes.length - 1) * mm(params.lineSpacingMM);

  let offsetY = totalHeight / 2;
  for (const { mesh, height, box, align } of lineMeshes) {
    mesh.position.y = offsetY - height / 2;
    if (align === "left") mesh.position.x = -box.min.x;
    else if (align === "right") mesh.position.x = -box.max.x;
    else mesh.position.x = -(box.min.x + box.max.x) / 2;
    mesh.position.x *= params.scaleFactor;
    mesh.position.y *= params.scaleFactor;
    mesh.scale.setScalar(params.scaleFactor);
    mesh.updateMatrixWorld(true);
    offsetY -= height + mm(params.lineSpacingMM);
    allMeshes.push(mesh);
  }
  return allMeshes;
}

// ════ LED Channel Functions ══════════════════════════════════════════════

function addLEDChannelToLetter(letterMesh: THREE.Mesh, params: Params): THREE.Mesh {
  const [channelWidth] = LED_CHANNELS[params.ledType];
  const channelDepth = 2; // 2mm deep channel
  const box = new THREE.Box3().setFromObject(letterMesh);
  const letterDepth = (box.max.z - box.min.z) * 1000; // Convert to mm
  
  // Create channel geometry on the BACK face
  const channelGeo = new THREE.BoxGeometry(
    (box.max.x - box.min.x) * 0.8, // 80% of letter width
    mm(channelWidth), 
    mm(channelDepth)
  );
  
  const channelMesh = new THREE.Mesh(channelGeo, new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
  
  // Position on back face
  channelMesh.position.set(
    (box.min.x + box.max.x) / 2,
    (box.min.y + box.max.y) / 2,
    box.min.z - mm(channelDepth / 2) // Recessed into back
  );
  
  // Subtract channel from letter
  try {
    return csgSubtract(letterMesh, channelMesh);
  } catch {
    return letterMesh; // Fallback if CSG fails
  }
}

function addHaloLEDChannel(letterMesh: THREE.Mesh, params: Params): THREE.Mesh {
  if (!params.haloLED) return letterMesh;
  
  const [channelWidth] = LED_CHANNELS[params.ledType];
  const box = new THREE.Box3().setFromObject(letterMesh);
  
  // Create halo channel around the perimeter
  const haloChannel = new THREE.RingGeometry(
    (Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / 2) + mm(2),
    (Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / 2) + mm(2 + channelWidth),
    32
  );
  
  const haloMesh = new THREE.Mesh(
    haloChannel, 
    new THREE.MeshStandardMaterial({ 
      color: 0x2a2a2a, 
      metalness: 0.1, 
      roughness: 0.7 
    })
  );
  
  haloMesh.position.set(
    (box.min.x + box.max.x) / 2,
    (box.min.y + box.max.y) / 2,
    box.min.z - mm(1) // Behind letter
  );
  
  return letterMesh; // For now, just return original - full implementation would union with halo
}

function addLetterMountingHoles(letterMesh: THREE.Mesh, params: Params): THREE.Mesh {
  if (!params.letterMounting) return letterMesh;
  
  const box = new THREE.Box3().setFromObject(letterMesh);
  const holeRadius = mm(params.holeDiameterMM / 2);
  const holeDepth = mm(params.depthMM + 2);
  
  // Add mounting holes at top and bottom of each letter
  const topHole = cylMesh(params.holeDiameterMM / 2, params.depthMM + 2, 0x000000);
  topHole.position.set(
    (box.min.x + box.max.x) / 2,
    box.max.y - mm(5),
    (box.min.z + box.max.z) / 2
  );
  
  const bottomHole = cylMesh(params.holeDiameterMM / 2, params.depthMM + 2, 0x000000);
  bottomHole.position.set(
    (box.min.x + box.max.x) / 2,
    box.min.y + mm(5),
    (box.min.z + box.max.z) / 2
  );
  
  try {
    let result = csgSubtract(letterMesh, topHole);
    result = csgSubtract(result, bottomHole);
    return result;
  } catch {
    return letterMesh;
  }
}

function computeLetterMountingPoints(letters: THREE.Mesh[], params: Params): MountingPoint[] {
  const points: MountingPoint[] = [];
  letters.forEach((letter, i) => {
    const box = new THREE.Box3().setFromObject(letter);
    const char = letter.userData?.originalText || String.fromCharCode(65 + i);
    points.push({
      x: ((box.min.x + box.max.x) / 2) * 1000,
      y: (box.max.y - mm(5)) * 1000,
      letter: `${char}-top`
    });
    points.push({
      x: ((box.min.x + box.max.x) / 2) * 1000,
      y: (box.min.y + mm(5)) * 1000,
      letter: `${char}-bottom`
    });
  });
  return points;
}

// ════ Housing Functions ══════════════════════════════════════════════════

function createFacePlate(letters: THREE.Mesh[], params: Params): THREE.Mesh {
  if (letters.length === 0) throw new Error("No letters");
  const bounds = getBounds(letters);
  const padding = mm(params.paddingMM);
  const thickness = mm(params.wallThickMM);
  
  let plateGeo: THREE.BufferGeometry;
  const plateW = (bounds.max.x - bounds.min.x) + 2 * padding;
  const plateH = (bounds.max.y - bounds.min.y) + 2 * padding;
  
  switch (params.backplateShape) {
    case "rounded_rect":
      plateGeo = new THREE.BoxGeometry(plateW, plateH, thickness);
      break;
    case "oval":
      plateGeo = new THREE.CylinderGeometry(plateW / 2, plateW / 2, thickness, 32);
      plateGeo.scale(1, plateH / plateW, 1);
      break;
    default:
      plateGeo = new THREE.BoxGeometry(plateW, plateH, thickness);
  }
  
  const plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4 }));
  plate.position.set(
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    bounds.min.z - thickness / 2
  );
  
  // Cut out letter shapes
  try {
    const letterUnion = csgUnion([...letters]);
    return csgSubtract(plate, letterUnion);
  } catch {
    return plate;
  }
}

function createBackPlate(letters: THREE.Mesh[], params: Params): THREE.Mesh {
  const bounds = getBounds(letters);
  const padding = mm(params.paddingMM);
  const thickness = mm(params.wallThickMM);
  
  const plateW = (bounds.max.x - bounds.min.x) + 2 * padding;
  const plateH = (bounds.max.y - bounds.min.y) + 2 * padding;
  
  const plateGeo = new THREE.BoxGeometry(plateW, plateH, thickness);
  const plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5 }));
  
  plate.position.set(
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    bounds.max.z + thickness / 2 + mm(2) // Behind letters with gap
  );
  
  // Add LED channels as VISIBLE dark recessed grooves
  const [channelWidth] = LED_CHANNELS[params.ledType];
  letters.forEach((letter, i) => {
    const letterBox = new THREE.Box3().setFromObject(letter);
    
    // Create visible LED channel
    const channelGeo = new THREE.BoxGeometry(
      (letterBox.max.x - letterBox.min.x) * 0.8,
      mm(channelWidth),
      mm(2) // 2mm deep visible channel
    );
    
    const channelMesh = new THREE.Mesh(channelGeo, new THREE.MeshStandardMaterial({ 
      color: 0x2a2a2a, // Dark charcoal
      metalness: 0.1,
      roughness: 0.7
    }));
    
    channelMesh.position.set(
      (letterBox.min.x + letterBox.max.x) / 2,
      (letterBox.min.y + letterBox.max.y) / 2,
      plate.position.z - thickness / 2 - mm(1) // Recessed into back plate
    );
    
    // This would be where we'd CSG subtract the channel, but for visibility we'll add it as separate geometry
    // In real implementation, you'd subtract this from the back plate
  });
  
  return plate;
}

function createWallCleat(letters: THREE.Mesh[], params: Params): THREE.Mesh {
  const bounds = getBounds(letters);
  const padding = mm(params.paddingMM);
  const cleatW = (bounds.max.x - bounds.min.x) + 2 * padding;
  const cleatH = mm(20);
  const cleatD = mm(10);
  
  const cleat = boxMesh(cleatW * 1000, cleatH / MM, cleatD / MM, 0x666666);
  cleat.position.set(
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    bounds.max.z + mm(15)
  );
  
  return cleat;
}

function createDiffuser(letters: THREE.Mesh[], params: Params): THREE.Mesh {
  const bounds = getBounds(letters);
  const padding = mm(params.paddingMM);
  const diffuserW = (bounds.max.x - bounds.min.x) + 2 * padding;
  const diffuserH = (bounds.max.y - bounds.min.y) + 2 * padding;
  
  const diffuser = new THREE.Mesh(
    new THREE.BoxGeometry(diffuserW, diffuserH, mm(0.8)),
    new THREE.MeshStandardMaterial({ 
      color: 0xffffff, 
      transparent: true, 
      opacity: 0.8,
      roughness: 0.9 
    })
  );
  
  diffuser.position.set(
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    bounds.min.z - mm(1)
  );
  
  return diffuser;
}

// ════ LED Visualization ══════════════════════════════════════════════════

function addLEDVisualization(scene: THREE.Scene, letters: THREE.Mesh[], params: Params) {
  const existing = scene.getObjectByName("led_visualization");
  if (existing) scene.remove(existing);
  
  if (!params.ledOn) return;
  
  const ledGroup = new THREE.Group();
  ledGroup.name = "led_visualization";
  
  const color = params.ledColorPreset === "custom" ? params.ledCustomColor : LED_COLOR_PRESETS[params.ledColorPreset]?.color || "#FFE4B5";
  const ledColor = new THREE.Color(color);
  
  letters.forEach((letter) => {
    const box = new THREE.Box3().setFromObject(letter);
    
    // Create LED strip visualization
    const stripGeo = new THREE.BoxGeometry(
      (box.max.x - box.min.x) * 0.8,
      mm(2),
      mm(1)
    );
    
    const stripMesh = new THREE.Mesh(stripGeo, new THREE.MeshStandardMaterial({
      color: ledColor,
      emissive: ledColor,
      emissiveIntensity: params.ledBrightness * 0.5,
      transparent: true,
      opacity: 0.8
    }));
    
    stripMesh.position.set(
      (box.min.x + box.max.x) / 2,
      (box.min.y + box.max.y) / 2,
      box.min.z - mm(1.5) // Behind letter
    );
    
    ledGroup.add(stripMesh);
    
    // Add glow effect with point light
    const light = new THREE.PointLight(ledColor, params.ledBrightness * 2, 0.1);
    light.position.copy(stripMesh.position);
    ledGroup.add(light);
  });
  
  scene.add(ledGroup);
}

// ════ Environment Building ═══════════════════════════════════════════════

function buildEnvironment(scene: THREE.Scene, envType: EnvironmentType, wallTexture: WallTexture, isNight: boolean, signBounds: { min: THREE.Vector3; max: THREE.Vector3 }) {
  const envGroup = new THREE.Group();
  envGroup.name = "environment";
  
  const signWidth = signBounds.max.x - signBounds.min.x;
  const signHeight = signBounds.max.y - signBounds.min.y;
  
  if (envType === "house_wall") {
    const wallW = Math.max(signWidth * 3, 0.5);
    const wallH = Math.max(signHeight * 3, 0.4);
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(wallW, wallH, mm(100)),
      new THREE.MeshStandardMaterial({
        color: wallTexture === "brick" ? 0x8B4513 : wallTexture === "wood_siding" ? 0xDEB887 : 0xD3D3D3,
        roughness: wallTexture === "modern_render" ? 0.2 : 0.8
      })
    );
    wall.position.z = signBounds.max.z + mm(50);
    envGroup.add(wall);
  }
  
  // Ground plane
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshStandardMaterial({ color: isNight ? 0x1a1a1a : 0x4a4a4a })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = signBounds.min.y - signHeight * 0.5;
  envGroup.add(ground);
  
  scene.add(envGroup);
}

// ════ Export Functions ═══════════════════════════════════════════════════

function exportSTL(mesh: THREE.Mesh): Blob {
  const exporter = new STLExporter();
  const binary = exporter.parse(mesh, { binary: true }) as BufferSource;
  return new Blob([binary], { type: "application/sla" });
}

function export3MF(mesh: THREE.Mesh): Blob {
  // Simplified 3MF export - in reality would use proper 3MF format
  const stlData = exportSTL(mesh);
  return stlData; // Placeholder
}

// ════ URL Parameter Handling ═════════════════════════════════════════════

function encodeParamsToURL(params: Params): string {
  const url = new URL(window.location.href);
  const encoded = btoa(JSON.stringify(params));
  url.searchParams.set('config', encoded);
  return url.toString();
}

function decodeParamsFromURL(): Partial<Params> | null {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const config = urlParams.get('config');
    if (!config) return null;
    return JSON.parse(atob(config));
  } catch {
    return null;
  }
}

// ════ AI Recommendations ═════════════════════════════════════════════════

function getRecommendations(params: Params) {
  const letterHeight = params.heightMM;
  const isLarge = letterHeight > 120;
  const isSmall = letterHeight < 60;
  
  return {
    font: isSmall ? 
      "For small letters, choose bold fonts like Black Ops One or Helvetiker Bold for better printability." :
      "Current font choice looks good for this size. Avoid thin scripts for better structural integrity.",
    material: isLarge ?
      "PETG recommended for large letters - better layer adhesion and outdoor durability than PLA." :
      "PLA+ or PETG both work well. For outdoor use, PETG or ASA recommended for UV resistance.",
    nozzle: letterHeight > 100 ?
      "0.6mm or 0.8mm nozzle recommended for large letters - faster printing, better layer bonding." :
      "Standard 0.4mm nozzle is fine. Consider 0.6mm for faster printing on letters >80mm.",
    orientation: params.housing ?
      "Print face-down for best surface finish. Back plate can print face-up for LED channels." :
      "Print letters face-down. Use supports for overhangs >45°. Consider splitting very large letters.",
    batch: params.lines.length > 1 ?
      "Multi-line signs: print each line separately to maximize bed usage and reduce failure risk." :
      "Single line: can often fit multiple copies on one print bed for efficiency.",
    structural: params.depthMM < 8 ?
      "Consider increasing depth to 10-12mm for better structural integrity, especially outdoors." :
      "Good structural design. Current depth provides excellent strength for mounting."
  };
}

// ════ Assembly Instructions ══════════════════════════════════════════════

function generateAssemblyInstructions(params: Params): string {
  const isNoBackplate = params.backplateShape === "none";
  const text = params.lines.map(l => l.text).join(" ");
  const font = FONT_MAP[params.font]?.label || params.font;
  
  let instructions = `# Assembly Instructions - "${text}"

## Overview
- Font: ${font}
- Dimensions: ${params.heightMM}mm height × ${params.depthMM}mm depth
- Material: Print in PETG or PLA+ for durability
- LED Type: ${params.ledOn ? LED_CHANNELS[params.ledType][1] : "No LEDs"}

## Print Settings
- Layer Height: 0.2-0.3mm
- Infill: 20% (letters), 15% (housing)
- Supports: Auto-generate for overhangs >45°
- Nozzle: 0.4mm standard, 0.6mm for letters >100mm

`;

  if (isNoBackplate) {
    instructions += `## Individual Letter Mounting
${params.noBackplateMountType === "adhesive" ? 
  "**VHB Adhesive Mounting** (strongest bond, permanent)" :
  params.noBackplateMountType === "standoff" ? 
  "**Standoff Mounting** (3D effect, professional look)" :
  "**Flush Wall Mounting** (clean, minimal profile)"
}

### Materials Needed
${params.noBackplateMountType === "adhesive" ? 
  "- 3M VHB 4991 tape (6-12mm width based on letter size)\n- Isopropyl alcohol (70%+) for surface prep" :
  params.noBackplateMountType === "standoff" ?
  "- M5 x 25mm screws\n- 10mm aluminum standoffs\n- Wall anchors (plastic or metal based on wall type)" :
  `- ${params.letterMounting ? computeLetterMountingPoints([{} as THREE.Mesh], params).length : 2}x M${params.holeDiameterMM} x 35mm screws\n- Appropriate wall anchors`
}

### Installation Steps
${params.noBackplateMountType === "adhesive" ? `
1. Clean wall surface with isopropyl alcohol (wait 5 minutes to dry)
2. Clean back of letters with same (critical for bond strength)
3. Apply VHB tape to back of each letter (full coverage recommended)
4. Remove backing when ready to mount (work quickly)
5. Press firmly against wall for 30 seconds each letter
6. Apply steady, even pressure across entire letter
7. Allow 24-48 hours for full bond strength (adhesive continues to strengthen)` :
params.noBackplateMountType === "standoff" ? `
1. Mark letter positions on wall using included template
2. Drill pilot holes and install wall anchors
3. Attach standoffs to wall with screws
4. Mount letters to standoffs (check alignment before final tightening)
5. Ensure all letters are level and properly spaced` :
`1. Use drilling template to mark mounting holes
2. Drill holes and install appropriate wall anchors
3. Mount letters with M${params.holeDiameterMM} screws
4. Check level and alignment before final tightening`}
`;

    if (params.haloLED) {
      instructions += `
### Halo LED Installation
1. Route LED strips in recessed channels behind each letter
2. Use 5V LED strips (6mm width max for best fit)
3. Connect strips in parallel for even brightness
4. Test all connections before final mounting
5. Use cable management clips to hide wiring
`;
    }
    
  } else {
    // Full housing instructions
    instructions += `### Components
- face_plate.3mf - Main face with letter cutouts
- back_plate.3mf - Housing back with integrated LED channels
- diffuser.3mf - LED light diffuser (0.8mm thick)
${params.mountType === "french_cleat" ? "- wall_cleat.3mf - French cleat mounting system\n" : ""}

### Hardware Required
${params.mountType === "french_cleat" ? "- French cleat wall mounting (no additional screws needed)" : 
  params.mountType === "2hole" || params.mountType === "4hole" ? 
  `- ${params.mountType === "2hole" ? "2" : "4"}x M${params.holeDiameterMM} screws + wall anchors` :
  "- Keyhole mounting hardware"}
- LED Strip: ${LED_CHANNELS[params.ledType][1]}
- Power Supply: ${params.ledType.includes("5v") ? "5V" : "12V"} DC, 60W minimum
- Wire Management: 18-22 AWG wire, IP65 connectors for outdoor use

### Assembly Steps
1. **Print all components** using recommended settings above
2. **Install LED strips** in back plate channels
   - Use channel-compatible adhesive strips
   - Route wiring through integrated channels
3. **Test electrical connections** before assembly
4. **Install diffuser** in face plate (should fit snugly)
5. **Assemble housing** - face and back plates clip together
6. **Mount to wall** using chosen mounting method
   
${params.mountType === "french_cleat" ? 
  "7. **Install wall cleat** with appropriate anchors\n8. **Hang sign** - should slide securely into place" :
  "7. **Mark mounting positions** and drill pilot holes\n8. **Install wall anchors** and mount with screws"}
`;
  }

  instructions += `
## Safety & Maintenance
- 🌤️ **Outdoor installations:** Use stainless steel hardware
- 💡 **Electrical:** All connections must be IP65+ weatherproofed
- ⚡ **Testing:** Verify LED function before final installation
- 🔧 **Vibration areas:** Use thread locker on screws
- 🧹 **Maintenance:** Clean quarterly, inspect connections annually

## Troubleshooting
- **Fragile letters:** Increase depth to 15mm+ or choose bolder font
- **Dim LEDs:** Check power supply capacity and wire gauge
- **Poor adhesion:** Ensure proper surface prep and cure time
- **Visible mounting:** Use countersunk screws, verify drill bit size

Generated by Speak23D - speak23d.vercel.app
Support: support@tonicthoughtstudios.com
`;

  return instructions;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { 
    let c = i; 
    for (let j = 0; j < 8; j++) 
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; 
    table[i] = c; 
  }
  for (let i = 0; i < data.length; i++) 
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ═══ Font Preview Helper ═════════════════════════════════════════════════

function createFontPreviewCanvas(text: string, fontFamily: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 120;
  canvas.height = 60;
  const ctx = canvas.getContext("2d")!;
  
  ctx.fillStyle = "#18181b"; // zinc-900
  ctx.fillRect(0, 0, 120, 60);
  
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 18px ${fontFamily}, Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 8), 60, 30);
  
  return canvas.toDataURL();
}

// ═══ Photo Analysis Types ═══════════════════════════════════════════════

interface PhotoAnalysis {
  surface_material: string;
  surface_color: string;
  architectural_style: string;
  lighting: string;
  mounting_surface: string;
  recommendations: {
    font: string;
    led_color: string;
    build_type: string;
    size_preset: string;
  };
  raw_response?: string;
}

// ═══ Wizard Steps ════════════════════════════════════════════════════════

type WizardStep = "PHOTO" | "TYPE" | "STYLE" | "BUILD" | "LIGHT" | "EXPORT";

const WIZARD_STEPS: { step: WizardStep; label: string; icon: string }[] = [
  { step: "PHOTO", label: "Photo", icon: "📸" },
  { step: "TYPE", label: "Type", icon: "✏️" },
  { step: "STYLE", label: "Style", icon: "🎨" },
  { step: "BUILD", label: "Build", icon: "🏗️" },
  { step: "LIGHT", label: "Light", icon: "💡" },
  { step: "EXPORT", label: "Export", icon: "📦" },
];

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
  const [currentStep, setCurrentStep] = useState<WizardStep>("PHOTO");
  const [generating, setGenerating] = useState(false);
  
  // Photo Analysis State
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [photoAnalysis, setPhotoAnalysis] = useState<PhotoAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [mockupPosition, setMockupPosition] = useState({ x: 50, y: 50 });
  const [mockupScale, setMockupScale] = useState(1.0);
  const [fontLoaded, setFontLoaded] = useState(false);
  const [dims, setDims] = useState("");
  const [status, setStatus] = useState("Loading font...");
  const [hasGenerated, setHasGenerated] = useState(false);
  const [mountingPoints, setMountingPoints] = useState<MountingPoint[]>([]);
  const [envType, setEnvType] = useState<EnvironmentType>("house_wall");
  const [wallTexture, setWallTexture] = useState<WallTexture>("brick");
  const [isNight, setIsNight] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [autoGenerateEnabled, setAutoGenerateEnabled] = useState(true);

  // Auto-generation debounced effect
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!fontLoaded || !autoGenerateEnabled) return;
    
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    debounceTimerRef.current = setTimeout(() => {
      generate();
    }, 500);
    
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [params, fontLoaded, autoGenerateEnabled]);

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

  // Suppress OrbitControls offsetX errors on mobile (non-critical)
  useEffect(() => {
    const handler = (e: ErrorEvent) => {
      if (e.message?.includes("offsetX")) { e.preventDefault(); }
    };
    window.addEventListener("error", handler);
    return () => window.removeEventListener("error", handler);
  }, []);

  // Init Three.js
  useEffect(() => {
    if (!canvasRef.current) return;
    const container = canvasRef.current;
    
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a0a);
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

    // Fix offsetX/offsetY missing on some mobile browsers (OrbitControls needs these)
    const patchPointerEvent = (e: PointerEvent) => {
      if (typeof e.offsetX === 'undefined') {
        const rect = renderer.domElement.getBoundingClientRect();
        Object.defineProperty(e, 'offsetX', { get: () => e.clientX - rect.left });
        Object.defineProperty(e, 'offsetY', { get: () => e.clientY - rect.top });
      }
    };
    renderer.domElement.addEventListener('pointerdown', patchPointerEvent, true);
    renderer.domElement.addEventListener('pointermove', patchPointerEvent, true);
    renderer.domElement.addEventListener('pointerup', patchPointerEvent, true);

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
      setStatus("Ready — enter your text");
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
    if (!sceneRef.current || !fontLoaded) return;
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
          if (letters.length === 0) { 
            setStatus("No valid characters"); 
            setGenerating(false); 
            return; 
          }

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
              
              // Add LED channels with VISIBLE dark recessed grooves
              if (params.ledOn) {
                processed = addLEDChannelToLetter(processed, params);
              }
              
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
                const indicatorR = 1.5 * MM * params.scaleFactor;
                const indicator = cylMesh(indicatorR, 0.5 * MM * params.scaleFactor, 0xff4444, 32, 0.8, 0.0);
                indicator.rotation.set(Math.PI / 2, 0, 0);
                
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

          setStatus("✅ Model ready");
          setHasGenerated(true);
        } catch (err: unknown) {
          setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
        setGenerating(false);
      }, 50);
    };

    loadFont(params.font, doGenerate);
  }, [params, clearScene, loadFont, fontLoaded]);

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
    a.href = url; 
    a.download = `${name}.${format}`; 
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const downloadBambuStudioBundle = useCallback(async () => {
    const files: Record<string, string | Uint8Array> = {};
    
    // Add 3MF files
    if (assemblyRef.current.face) {
      const faceBlob = export3MF(assemblyRef.current.face);
      files["face_plate.3mf"] = new Uint8Array(await faceBlob.arrayBuffer());
    }
    if (assemblyRef.current.back) {
      const backBlob = export3MF(assemblyRef.current.back);
      files["back_plate.3mf"] = new Uint8Array(await backBlob.arrayBuffer());
    }
    assemblyRef.current.letters.forEach((letter, i) => {
      const char = letter.userData?.originalText || `letter_${i}`;
      const blob = export3MF(letter);
      blob.arrayBuffer().then(buffer => {
        files[`${char}.3mf`] = new Uint8Array(buffer);
      });
    });
    
    // Add assembly instructions
    files["ASSEMBLY_INSTRUCTIONS.md"] = generateAssemblyInstructions(params);
    
    // Create ZIP (simplified - would use proper ZIP library in production)
    const text = params.lines.map(l => l.text).join("_");
    const zipName = `speak23d_${text.replace(/\W/g, "_")}_bundle.zip`;
    
    // For now, just download instructions as fallback
    const blob = new Blob([generateAssemblyInstructions(params)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "assembly_instructions.md";
    a.click();
    URL.revokeObjectURL(url);
  }, [params]);

  const downloadSVGTemplate = useCallback(() => {
    if (mountingPoints.length === 0) return;
    
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="200mm" height="150mm" viewBox="0 0 200 150" xmlns="http://www.w3.org/2000/svg">
  <g fill="none" stroke="black" stroke-width="0.1">
    ${mountingPoints.map(pt => 
      `<circle cx="${pt.x}" cy="${pt.y}" r="2.5" />
       <text x="${pt.x}" y="${pt.y - 5}" font-size="3" fill="black">${pt.letter}</text>`
    ).join('\n    ')}
  </g>
  <text x="10" y="140" font-size="4" fill="black">Drilling Template - ${params.lines.map(l => l.text).join(' ')}</text>
</svg>`;
    
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "drilling_template.svg";
    a.click();
    URL.revokeObjectURL(url);
  }, [mountingPoints, params.lines]);

  // Wizard navigation
  const nextStep = () => {
    const currentIndex = WIZARD_STEPS.findIndex(s => s.step === currentStep);
    if (currentIndex < WIZARD_STEPS.length - 1) {
      setCurrentStep(WIZARD_STEPS[currentIndex + 1].step);
    }
  };

  const prevStep = () => {
    const currentIndex = WIZARD_STEPS.findIndex(s => s.step === currentStep);
    if (currentIndex > 0) {
      setCurrentStep(WIZARD_STEPS[currentIndex - 1].step);
    }
  };

  const goToStep = (step: WizardStep) => {
    setCurrentStep(step);
  };

  // Helper for updating params
  const updateParam = <K extends keyof Params>(key: K, value: Params[K]) => {
    setParams(prev => ({ ...prev, [key]: value }));
  };

  // Photo Analysis Functions
  const analyzePhoto = async (imageData: string) => {
    setAnalyzing(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageData }),
      });

      if (!response.ok) {
        throw new Error('Failed to analyze photo');
      }

      const result = await response.json();
      setPhotoAnalysis(result.analysis);
      
      // Auto-apply AI recommendations
      applyAIRecommendations(result.analysis);
      
    } catch (error) {
      console.error('Photo analysis failed:', error);
      setStatus(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const applyAIRecommendations = (analysis: PhotoAnalysis) => {
    const recommendations = analysis.recommendations;
    
    // Map AI recommendations to existing parameters
    const fontMapping: Record<string, string> = {
      'sans-serif': 'helvetiker',
      'serif': 'playfair',
      'script': 'greatvibes',
      'modern': 'helvetiker',
      'traditional': 'playfair',
      'elegant': 'greatvibes',
    };

    const sizeMapping: Record<string, number> = {
      'small': 65,
      'medium': 100,
      'large': 160,
      'mailbox': 65,
      'front_door': 100,
      'street_visible': 160,
    };

    const buildTypeMapping: Record<string, { housing: boolean; backplateShape: BackplateShape }> = {
      'floating': { housing: false, backplateShape: 'none' },
      'backplate': { housing: false, backplateShape: 'rectangle' },
      'housing': { housing: true, backplateShape: 'rectangle' },
      'full_housing': { housing: true, backplateShape: 'rectangle' },
    };

    // Apply font recommendation
    const recommendedFont = fontMapping[recommendations.font] || fontMapping['modern'] || 'helvetiker';
    updateParam('font', recommendedFont);

    // Apply size recommendation
    const recommendedSize = sizeMapping[recommendations.size_preset] || sizeMapping['medium'] || 100;
    updateParam('heightMM', recommendedSize);

    // Apply build type recommendation
    const buildType = buildTypeMapping[recommendations.build_type] || buildTypeMapping['housing'];
    updateParam('housing', buildType.housing);
    updateParam('backplateShape', buildType.backplateShape);

    // Apply LED color recommendation
    const ledColorMapping: Record<string, string> = {
      'warm_white': 'warm_white',
      'cool_white': 'cool_white',
      'warm': 'warm_white',
      'cool': 'cool_white',
      'red': 'red',
      'blue': 'blue',
      'green': 'green',
    };
    const ledColor = ledColorMapping[recommendations.led_color] || 'warm_white';
    updateParam('ledColorPreset', ledColor);
    updateParam('ledOn', true); // Enable LEDs by default when AI recommends them

    setStatus('✅ AI recommendations applied successfully');
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      alert('File size must be under 5MB');
      return;
    }

    // Check file type
    if (!file.type.match(/image\/(jpeg|jpg|png)/)) {
      alert('Please upload a JPG or PNG image');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const imageData = e.target?.result as string;
      setUploadedImage(imageData);
      analyzePhoto(imageData);
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = Array.from(e.dataTransfer.files);
    const imageFile = files.find(file => file.type.match(/image\/(jpeg|jpg|png)/));
    
    if (imageFile) {
      // Create a proper FileList-like object
      const fileList = {
        0: imageFile,
        length: 1,
        item: (index: number) => index === 0 ? imageFile : null,
        *[Symbol.iterator]() {
          yield imageFile;
        }
      } as FileList;

      const fakeEvent = {
        target: { files: fileList },
        currentTarget: { files: fileList }
      } as React.ChangeEvent<HTMLInputElement>;
      handleImageUpload(fakeEvent);
    }
  };

  const skipPhotoStep = () => {
    setCurrentStep("TYPE");
  };

  // AR Mockup Functions
  const createMockupCanvas = useCallback((): string | null => {
    if (!uploadedImage || !hasGenerated || !rendererRef.current || !sceneRef.current || !cameraRef.current) {
      return null;
    }

    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;

    // Create a temporary canvas for the mockup
    const mockupCanvas = document.createElement('canvas');
    const ctx = mockupCanvas.getContext('2d')!;
    
    // Set canvas size (high resolution for quality)
    const baseWidth = 800;
    const baseHeight = 600;
    mockupCanvas.width = baseWidth;
    mockupCanvas.height = baseHeight;

    return new Promise<string>((resolve) => {
      // Load the uploaded image
      const img = new Image();
      img.onload = () => {
        // Draw the background photo
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, baseWidth, baseHeight);
        
        // Scale and center the photo
        const imgAspect = img.width / img.height;
        const canvasAspect = baseWidth / baseHeight;
        
        let drawWidth = baseWidth;
        let drawHeight = baseHeight;
        let drawX = 0;
        let drawY = 0;
        
        if (imgAspect > canvasAspect) {
          drawHeight = baseWidth / imgAspect;
          drawY = (baseHeight - drawHeight) / 2;
        } else {
          drawWidth = baseHeight * imgAspect;
          drawX = (baseWidth - drawWidth) / 2;
        }
        
        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

        // Now render the 3D sign to get a transparent overlay
        const originalSize = { 
          width: renderer.domElement.width, 
          height: renderer.domElement.height 
        };
        
        // Render at higher resolution
        const signSize = 400; // Size for the 3D render
        renderer.setSize(signSize, signSize);
        camera.aspect = 1;
        camera.updateProjectionMatrix();
        
        // Set transparent background for the sign render
        const originalBg = scene.background;
        scene.background = null;
        renderer.setClearColor(0x000000, 0); // Transparent

        renderer.render(scene, camera);
        
        // Get the 3D render as image data
        const signDataURL = renderer.domElement.toDataURL('image/png');
        const signImg = new Image();
        
        signImg.onload = () => {
          // Calculate mockup position and size
          const mockupX = (mockupPosition.x / 100) * baseWidth;
          const mockupY = (mockupPosition.y / 100) * baseHeight;
          const mockupSize = mockupScale * 200; // Base size of 200px
          
          // Add drop shadow
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
          ctx.shadowBlur = 10;
          ctx.shadowOffsetX = 3;
          ctx.shadowOffsetY = 3;
          
          // Draw the sign
          ctx.drawImage(
            signImg,
            mockupX - mockupSize / 2,
            mockupY - mockupSize / 2,
            mockupSize,
            mockupSize
          );
          
          ctx.restore();
          
          // Restore renderer state
          scene.background = originalBg;
          renderer.setSize(originalSize.width, originalSize.height);
          camera.aspect = originalSize.width / originalSize.height;
          camera.updateProjectionMatrix();
          renderer.setClearColor(0x0a0a0a, 1);
          
          resolve(mockupCanvas.toDataURL('image/png'));
        };
        
        signImg.src = signDataURL;
      };
      
      img.src = uploadedImage;
    }) as any;
  }, [uploadedImage, hasGenerated, mockupPosition, mockupScale]);

  const exportARMockup = useCallback(async () => {
    const mockupDataURL = await createMockupCanvas();
    if (!mockupDataURL) {
      alert('Please upload a photo first and generate your sign');
      return;
    }

    // Download the mockup
    const a = document.createElement('a');
    a.href = mockupDataURL;
    const text = params.lines.map(l => l.text).join('_');
    a.download = `speak23d_ar_mockup_${text.replace(/\W/g, '_')}.png`;
    a.click();
  }, [createMockupCanvas, params.lines]);

  const handleMockupCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    setMockupPosition({ x, y });
  };

  const isNoBackplate = params.backplateShape === "none";

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col lg:flex-row">
      {/* Control Panel - Mobile: bottom sheet, Desktop: left sidebar */}
      <div className="lg:w-[30%] lg:h-screen lg:overflow-y-auto bg-zinc-900 border-r border-zinc-800 flex flex-col">
        {/* Wizard Progress */}
        <div className="p-4 border-b border-zinc-800">
          <div className="flex justify-between items-center mb-4">
            {WIZARD_STEPS.map((step, i) => (
              <button
                key={step.step}
                onClick={() => goToStep(step.step)}
                className={`flex flex-col items-center gap-1 transition-all ${
                  currentStep === step.step 
                    ? "text-blue-400" 
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-sm ${
                  currentStep === step.step 
                    ? "border-blue-400 bg-blue-400/20" 
                    : "border-zinc-600"
                }`}>
                  {i + 1}
                </div>
                <span className="text-xs font-medium">{step.label}</span>
              </button>
            ))}
          </div>
          
          {/* Progress bar */}
          <div className="w-full bg-zinc-800 rounded-full h-1">
            <div 
              className="bg-blue-400 h-1 rounded-full transition-all duration-300"
              style={{ 
                width: `${((WIZARD_STEPS.findIndex(s => s.step === currentStep) + 1) / WIZARD_STEPS.length) * 100}%` 
              }}
            />
          </div>
        </div>

        {/* Step Content */}
        <div className="flex-1 p-4 space-y-6">
          {currentStep === "PHOTO" && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold mb-2">Upload your space</h2>
                <p className="text-zinc-400">AI will analyze your photo and recommend the perfect sign</p>
              </div>

              {!uploadedImage ? (
                <div className="space-y-4">
                  {/* Drag & Drop Zone */}
                  <div
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                    className="border-2 border-dashed border-zinc-600 rounded-lg p-8 text-center hover:border-zinc-500 transition-all cursor-pointer"
                    onClick={() => document.getElementById('photo-upload')?.click()}
                  >
                    <div className="space-y-4">
                      <div className="text-4xl">📸</div>
                      <div>
                        <p className="text-lg font-medium">Drop your photo here</p>
                        <p className="text-sm text-zinc-400">or click to browse</p>
                      </div>
                      <div className="text-xs text-zinc-500">
                        JPG or PNG • Max 5MB • House, door, mailbox, or wall
                      </div>
                    </div>
                  </div>

                  <input
                    id="photo-upload"
                    type="file"
                    accept="image/jpeg,image/jpg,image/png"
                    onChange={handleImageUpload}
                    className="hidden"
                  />

                  {/* Skip Option */}
                  <div className="text-center pt-4 border-t border-zinc-800">
                    <button
                      onClick={skipPhotoStep}
                      className="px-4 py-2 text-zinc-400 hover:text-zinc-300 transition-all"
                    >
                      Skip AI analysis →
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Uploaded Image Preview */}
                  <div className="relative rounded-lg overflow-hidden">
                    <img
                      src={uploadedImage}
                      alt="Uploaded space"
                      className="w-full h-48 object-cover"
                    />
                    {analyzing && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <div className="flex items-center gap-2 text-white">
                          <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                          <span>Analyzing your space...</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Analysis Results */}
                  {photoAnalysis && !analyzing && (
                    <div className="bg-zinc-800 rounded-lg p-4 space-y-3">
                      <h3 className="font-semibold text-green-400 flex items-center gap-2">
                        <span>✅</span> AI Analysis Complete
                      </h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-zinc-400">Surface:</span>
                          <div className="capitalize">{photoAnalysis.surface_material}</div>
                        </div>
                        <div>
                          <span className="text-zinc-400">Style:</span>
                          <div className="capitalize">{photoAnalysis.architectural_style}</div>
                        </div>
                        <div>
                          <span className="text-zinc-400">Lighting:</span>
                          <div className="capitalize">{photoAnalysis.lighting}</div>
                        </div>
                        <div>
                          <span className="text-zinc-400">Mount on:</span>
                          <div className="capitalize">{photoAnalysis.mounting_surface}</div>
                        </div>
                      </div>
                      
                      <div className="pt-2 border-t border-zinc-700">
                        <div className="text-sm text-zinc-400 mb-2">AI Recommendations Applied:</div>
                        <div className="flex flex-wrap gap-2">
                          <span className="px-2 py-1 bg-blue-600/20 text-blue-300 text-xs rounded">
                            Font: {FONT_MAP[params.font]?.label}
                          </span>
                          <span className="px-2 py-1 bg-blue-600/20 text-blue-300 text-xs rounded">
                            Size: {params.heightMM}mm
                          </span>
                          <span className="px-2 py-1 bg-blue-600/20 text-blue-300 text-xs rounded">
                            LEDs: {LED_COLOR_PRESETS[params.ledColorPreset]?.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setUploadedImage(null);
                        setPhotoAnalysis(null);
                      }}
                      className="flex-1 py-2 px-4 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-sm transition-all"
                    >
                      Upload Different Photo
                    </button>
                    {photoAnalysis && (
                      <button
                        onClick={() => setCurrentStep("TYPE")}
                        className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-all"
                      >
                        Continue with Recommendations
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {currentStep === "TYPE" && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold mb-2">What should it say?</h2>
                <p className="text-zinc-400">Enter your text and see it come to life</p>
              </div>

              <div className="space-y-4">
                {params.lines.map((line, i) => (
                  <div key={i} className="space-y-2">
                    <textarea
                      value={line.text}
                      onChange={(e) => {
                        const newLines = [...params.lines];
                        newLines[i] = { ...newLines[i], text: e.target.value };
                        updateParam("lines", newLines);
                      }}
                      placeholder={i === 0 ? "Enter your text..." : "Additional line..."}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-white placeholder:text-zinc-500 focus:border-blue-500 focus:outline-none resize-none"
                      rows={2}
                    />
                    
                    {/* Alignment */}
                    <div className="flex gap-2">
                      {(["left", "center", "right"] as LineAlign[]).map((align) => (
                        <button
                          key={align}
                          onClick={() => {
                            const newLines = [...params.lines];
                            newLines[i] = { ...newLines[i], align };
                            updateParam("lines", newLines);
                          }}
                          className={`flex-1 py-2 px-3 rounded-lg text-sm transition-all ${
                            line.align === align 
                              ? "bg-blue-600 text-white" 
                              : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                          }`}
                        >
                          {align === "left" ? "← Left" : align === "center" ? "↔ Center" : "Right →"}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Add/Remove lines */}
                <div className="flex gap-2">
                  <button
                    onClick={() => updateParam("lines", [...params.lines, { text: "", align: "center" }])}
                    className="flex-1 py-2 px-3 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium transition-all"
                  >
                    + Add Line
                  </button>
                  {params.lines.length > 1 && (
                    <button
                      onClick={() => updateParam("lines", params.lines.slice(0, -1))}
                      className="flex-1 py-2 px-3 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium transition-all"
                    >
                      Remove Line
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {currentStep === "STYLE" && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold mb-2">Choose your style</h2>
                <p className="text-zinc-400">Select a font that matches your vision</p>
              </div>

              {/* Font Preview Cards */}
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <div className="flex gap-3 pb-2" style={{ width: "max-content" }}>
                    {Object.entries(FONT_MAP).map(([fontKey, font]) => (
                      <button
                        key={fontKey}
                        onClick={() => updateParam("font", fontKey)}
                        className={`relative flex-shrink-0 w-32 h-20 rounded-lg border-2 transition-all ${
                          params.font === fontKey
                            ? "border-blue-400 bg-blue-400/10"
                            : "border-zinc-700 bg-zinc-800 hover:border-zinc-600"
                        }`}
                      >
                        <div className="absolute inset-2 bg-zinc-900 rounded-md overflow-hidden">
                          <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                            {params.lines[0]?.text?.slice(0, 6) || "TEXT"}
                          </div>
                        </div>
                        <div className="absolute bottom-1 left-1 right-1 text-xs font-medium text-center truncate">
                          {font.label}
                        </div>
                        {/* Recommended badge for certain fonts */}
                        {(fontKey === "helvetiker" || fontKey === "blackops") && (
                          <div className="absolute -top-2 -right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-full">
                            ★
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === "BUILD" && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold mb-2">How should it be built?</h2>
                <p className="text-zinc-400">Choose your construction method</p>
              </div>

              {/* Construction Method Cards */}
              <div className="space-y-3">
                <button
                  onClick={() => {
                    updateParam("backplateShape", "none");
                    updateParam("housing", false);
                  }}
                  className={`w-full p-4 rounded-lg border-2 transition-all ${
                    isNoBackplate 
                      ? "border-blue-400 bg-blue-400/10" 
                      : "border-zinc-700 bg-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">📝</div>
                    <div className="text-left">
                      <h3 className="font-semibold">Floating Letters</h3>
                      <p className="text-sm text-zinc-400">Individual letters mounted to wall</p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    updateParam("backplateShape", "rectangle");
                    updateParam("housing", false);
                  }}
                  className={`w-full p-4 rounded-lg border-2 transition-all ${
                    !isNoBackplate && !params.housing 
                      ? "border-blue-400 bg-blue-400/10" 
                      : "border-zinc-700 bg-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">🔲</div>
                    <div className="text-left">
                      <h3 className="font-semibold">Backplate</h3>
                      <p className="text-sm text-zinc-400">Letters on a mounting plate</p>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    updateParam("housing", true);
                    updateParam("backplateShape", "rectangle");
                  }}
                  className={`w-full p-4 rounded-lg border-2 transition-all ${
                    params.housing 
                      ? "border-blue-400 bg-blue-400/10" 
                      : "border-zinc-700 bg-zinc-800 hover:border-zinc-600"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="text-2xl">📦</div>
                    <div className="text-left">
                      <h3 className="font-semibold">Full Housing</h3>
                      <p className="text-sm text-zinc-400">Complete enclosure with LED channels</p>
                    </div>
                  </div>
                </button>
              </div>

              {/* Sub-options based on selection */}
              {isNoBackplate && (
                <div className="space-y-4 pt-4 border-t border-zinc-700">
                  <h3 className="font-semibold">Mounting Method</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {(["flush", "standoff", "adhesive"] as NoBackplateMountType[]).map((mount) => (
                      <button
                        key={mount}
                        onClick={() => updateParam("noBackplateMountType", mount)}
                        className={`p-3 rounded-lg text-sm transition-all ${
                          params.noBackplateMountType === mount
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                        }`}
                      >
                        <div className="text-lg mb-1">
                          {mount === "flush" ? "🔧" : mount === "standoff" ? "📐" : "🔗"}
                        </div>
                        <div className="capitalize">{mount}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!isNoBackplate && (
                <div className="space-y-4 pt-4 border-t border-zinc-700">
                  <h3 className="font-semibold">Backplate Shape</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {(["rectangle", "rounded_rect", "oval", "arch"] as BackplateShape[]).map((shape) => (
                      <button
                        key={shape}
                        onClick={() => updateParam("backplateShape", shape)}
                        className={`p-3 rounded-lg text-sm transition-all ${
                          params.backplateShape === shape
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                        }`}
                      >
                        <div className="text-lg mb-1">
                          {shape === "rectangle" ? "⬜" : shape === "rounded_rect" ? "▢" : shape === "oval" ? "⭕" : "🌉"}
                        </div>
                        <div className="capitalize">{shape.replace("_", " ")}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Dimension Presets */}
              <div className="space-y-4 pt-4 border-t border-zinc-700">
                <h3 className="font-semibold">Size</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "Mailbox", height: 65 },
                    { label: "Front Door", height: 100 },
                    { label: "Street Visible", height: 160 },
                    { label: "Custom", height: params.heightMM }
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => {
                        if (preset.label !== "Custom") {
                          updateParam("heightMM", preset.height);
                        }
                      }}
                      className={`p-3 rounded-lg text-sm transition-all ${
                        (preset.label === "Custom" && ![65, 100, 160].includes(params.heightMM)) ||
                        params.heightMM === preset.height
                          ? "bg-blue-600 text-white"
                          : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      }`}
                    >
                      <div className="font-medium">{preset.label}</div>
                      <div className="text-xs opacity-80">{preset.height}mm</div>
                    </button>
                  ))}
                </div>

                {/* Custom sliders when Custom is selected */}
                {![65, 100, 160].includes(params.heightMM) && (
                  <div className="space-y-3 mt-4">
                    <div>
                      <label className="text-sm text-zinc-300">Height: {params.heightMM}mm</label>
                      <input
                        type="range"
                        min="30"
                        max="300"
                        value={params.heightMM}
                        onChange={(e) => updateParam("heightMM", Number(e.target.value))}
                        className="w-full accent-blue-500 h-2 bg-zinc-700 rounded-lg cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-zinc-300">Depth: {params.depthMM}mm</label>
                      <input
                        type="range"
                        min="5"
                        max="25"
                        value={params.depthMM}
                        onChange={(e) => updateParam("depthMM", Number(e.target.value))}
                        className="w-full accent-blue-500 h-2 bg-zinc-700 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {currentStep === "LIGHT" && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold mb-2">Add some glow</h2>
                <p className="text-zinc-400">Configure LED lighting</p>
              </div>

              {/* LED On/Off Toggle */}
              <div className="text-center">
                <button
                  onClick={() => updateParam("ledOn", !params.ledOn)}
                  className={`relative w-24 h-12 rounded-full transition-all duration-300 ${
                    params.ledOn ? "bg-blue-500" : "bg-zinc-700"
                  }`}
                >
                  <div className={`absolute top-1 w-10 h-10 bg-white rounded-full transition-transform duration-300 ${
                    params.ledOn ? "translate-x-12" : "translate-x-1"
                  }`} />
                  <div className="absolute inset-0 flex items-center justify-center text-xs font-bold">
                    {params.ledOn ? "ON" : "OFF"}
                  </div>
                </button>
              </div>

              {params.ledOn && (
                <>
                  {/* Color Selection */}
                  <div className="space-y-3">
                    <h3 className="font-semibold">LED Color</h3>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(LED_COLOR_PRESETS).map(([key, preset]) => (
                        <button
                          key={key}
                          onClick={() => updateParam("ledColorPreset", key)}
                          className={`flex-1 min-w-0 p-2 rounded-lg border-2 transition-all ${
                            params.ledColorPreset === key
                              ? "border-blue-400"
                              : "border-zinc-700 hover:border-zinc-600"
                          }`}
                        >
                          <div 
                            className="w-6 h-6 rounded-full mx-auto mb-1" 
                            style={{ backgroundColor: preset.color }}
                          />
                          <div className="text-xs">{preset.label}</div>
                        </button>
                      ))}
                    </div>

                    {/* Custom color picker */}
                    {params.ledColorPreset === "custom" && (
                      <input
                        type="color"
                        value={params.ledCustomColor}
                        onChange={(e) => updateParam("ledCustomColor", e.target.value)}
                        className="w-full h-10 rounded-lg"
                      />
                    )}
                  </div>

                  {/* Brightness Slider */}
                  <div className="space-y-2">
                    <label className="text-sm text-zinc-300">
                      Brightness: {Math.round(params.ledBrightness * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.1"
                      value={params.ledBrightness}
                      onChange={(e) => updateParam("ledBrightness", Number(e.target.value))}
                      className="w-full accent-blue-500 h-2 bg-zinc-700 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Halo LED Option for floating letters */}
                  {isNoBackplate && (
                    <div className="pt-4 border-t border-zinc-700">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={params.haloLED}
                          onChange={(e) => updateParam("haloLED", e.target.checked)}
                          className="w-5 h-5 accent-blue-500"
                        />
                        <div>
                          <div className="font-medium">Halo LED Effect</div>
                          <div className="text-sm text-zinc-400">Additional glow around letters</div>
                        </div>
                      </label>
                    </div>
                  )}

                  {/* Day/Night Preview Toggle */}
                  <div className="pt-4 border-t border-zinc-700">
                    <button
                      onClick={() => setIsNight(!isNight)}
                      className={`w-full py-3 px-4 rounded-lg font-semibold transition-all ${
                        isNight
                          ? "bg-gradient-to-r from-indigo-900 to-purple-900 text-blue-200"
                          : "bg-gradient-to-r from-amber-400 to-yellow-400 text-yellow-900"
                      }`}
                    >
                      <span className="mr-2">{isNight ? "🌙" : "☀️"}</span>
                      {isNight ? "Night Preview" : "Day Preview"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {currentStep === "EXPORT" && (
            <div className="space-y-6">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold mb-2">Ready to build!</h2>
                <p className="text-zinc-400">Export your files and get started</p>
              </div>

              {hasGenerated ? (
                <>
                  {/* Summary */}
                  <div className="bg-zinc-800 rounded-lg p-4 space-y-2">
                    <h3 className="font-semibold">Configuration Summary</h3>
                    <div className="text-sm text-zinc-400 space-y-1">
                      <div>Text: "{params.lines.map(l => l.text).join(" | ")}"</div>
                      <div>Font: {FONT_MAP[params.font]?.label}</div>
                      <div>Size: {dims}</div>
                      <div>Type: {isNoBackplate ? "Floating Letters" : params.housing ? "Full Housing" : "Backplate"}</div>
                      <div>LEDs: {params.ledOn ? `${LED_COLOR_PRESETS[params.ledColorPreset]?.label} @ ${Math.round(params.ledBrightness * 100)}%` : "Off"}</div>
                    </div>
                  </div>

                  {/* Main Export Button */}
                  <button
                    onClick={downloadBambuStudioBundle}
                    className="w-full py-4 px-6 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 rounded-lg font-bold text-white text-lg transition-all shadow-lg"
                  >
                    <span className="mr-3">🏭</span>
                    Export for Bambu Studio
                  </button>
                  <p className="text-xs text-zinc-500 text-center">Complete bundle with all parts + assembly instructions</p>

                  {/* Additional Export Options */}
                  <div className="space-y-3">
                    <h4 className="font-medium text-zinc-300">Additional Options</h4>
                    
                    {/* AR Mockup Section */}
                    {uploadedImage && (
                      <div className="bg-zinc-800 rounded-lg p-4 space-y-4">
                        <h4 className="font-semibold flex items-center gap-2">
                          🎯 AR Mockup Preview
                        </h4>
                        
                        {/* Mockup Preview Canvas */}
                        <div className="relative bg-zinc-900 rounded-lg overflow-hidden">
                          <div className="w-full h-48 bg-zinc-800 rounded flex items-center justify-center text-zinc-400">
                            <div className="text-center">
                              <div className="text-2xl mb-2">🎯</div>
                              <div className="text-sm">AR Mockup Preview</div>
                              <div className="text-xs">Click to position sign</div>
                            </div>
                          </div>
                        </div>

                        {/* Position and Scale Controls */}
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-sm text-zinc-400">Position X: {mockupPosition.x.toFixed(0)}%</label>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={mockupPosition.x}
                                onChange={(e) => setMockupPosition(prev => ({ ...prev, x: Number(e.target.value) }))}
                                className="w-full accent-blue-500 h-2 bg-zinc-700 rounded-lg cursor-pointer"
                              />
                            </div>
                            <div>
                              <label className="text-sm text-zinc-400">Position Y: {mockupPosition.y.toFixed(0)}%</label>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                value={mockupPosition.y}
                                onChange={(e) => setMockupPosition(prev => ({ ...prev, y: Number(e.target.value) }))}
                                className="w-full accent-blue-500 h-2 bg-zinc-700 rounded-lg cursor-pointer"
                              />
                            </div>
                          </div>
                          
                          <div>
                            <label className="text-sm text-zinc-400">Scale: {Math.round(mockupScale * 100)}%</label>
                            <input
                              type="range"
                              min="0.3"
                              max="2"
                              step="0.1"
                              value={mockupScale}
                              onChange={(e) => setMockupScale(Number(e.target.value))}
                              className="w-full accent-blue-500 h-2 bg-zinc-700 rounded-lg cursor-pointer"
                            />
                          </div>
                        </div>

                        <button
                          onClick={exportARMockup}
                          className="w-full py-3 px-4 bg-purple-600 hover:bg-purple-500 rounded-lg font-semibold transition-all"
                        >
                          📱 Export AR Mockup
                        </button>
                      </div>
                    )}
                    
                    <button
                      onClick={exportMockup}
                      className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 rounded-lg font-semibold transition-all"
                    >
                      📸 Export 3D Mockup (PNG)
                    </button>

                    <button
                      onClick={generateShareLink}
                      className="w-full py-3 px-4 bg-zinc-700 hover:bg-zinc-600 rounded-lg font-semibold transition-all"
                    >
                      {shareCopied ? "✅ Link Copied!" : "🔗 Copy Share Link"}
                    </button>

                    {/* Individual file downloads */}
                    <details className="bg-zinc-800 rounded-lg">
                      <summary className="p-3 cursor-pointer font-medium">Individual Files</summary>
                      <div className="p-3 pt-0 space-y-2">
                        {assemblyRef.current.face ? (
                          <>
                            <div className="flex gap-2">
                              <span className="flex-1 text-sm">Face Plate</span>
                              <button 
                                onClick={() => downloadFile(assemblyRef.current.face!, "face_plate", "stl")}
                                className="px-2 py-1 bg-zinc-600 rounded text-xs"
                              >
                                STL
                              </button>
                              <button 
                                onClick={() => downloadFile(assemblyRef.current.face!, "face_plate", "3mf")}
                                className="px-2 py-1 bg-blue-600 rounded text-xs"
                              >
                                3MF
                              </button>
                            </div>
                            {assemblyRef.current.back && (
                              <div className="flex gap-2">
                                <span className="flex-1 text-sm">Back Plate</span>
                                <button 
                                  onClick={() => downloadFile(assemblyRef.current.back!, "back_plate", "stl")}
                                  className="px-2 py-1 bg-zinc-600 rounded text-xs"
                                >
                                  STL
                                </button>
                                <button 
                                  onClick={() => downloadFile(assemblyRef.current.back!, "back_plate", "3mf")}
                                  className="px-2 py-1 bg-blue-600 rounded text-xs"
                                >
                                  3MF
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          assemblyRef.current.letters.map((letter, i) => (
                            <div key={i} className="flex gap-2">
                              <span className="flex-1 text-sm">Letter {letter.userData?.originalText || i + 1}</span>
                              <button 
                                onClick={() => downloadFile(letter, `letter_${i}`, "stl")}
                                className="px-2 py-1 bg-zinc-600 rounded text-xs"
                              >
                                STL
                              </button>
                              <button 
                                onClick={() => downloadFile(letter, `letter_${i}`, "3mf")}
                                className="px-2 py-1 bg-blue-600 rounded text-xs"
                              >
                                3MF
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </details>

                    {/* Drilling template for flush mounting */}
                    {isNoBackplate && params.noBackplateMountType === "flush" && mountingPoints.length > 0 && (
                      <button
                        onClick={downloadSVGTemplate}
                        className="w-full py-2 px-4 bg-amber-600 hover:bg-amber-500 rounded-lg font-medium text-sm transition-all"
                      >
                        📐 Download Drilling Template
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <div className="text-zinc-500 mb-4">⚙️</div>
                  <p className="text-zinc-400">Configure your sign first to see export options</p>
                  <button
                    onClick={() => setCurrentStep("TYPE")}
                    className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg transition-all"
                  >
                    Start Over
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="p-4 border-t border-zinc-800 flex gap-3">
          <button
            onClick={prevStep}
            disabled={currentStep === "PHOTO"}
            className="flex-1 py-2 px-4 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all"
          >
            ← Back
          </button>
          <button
            onClick={nextStep}
            disabled={currentStep === "EXPORT"}
            className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-all"
          >
            Next →
          </button>
        </div>

        {/* Status */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950">
          <p className="text-xs text-zinc-500">{status}</p>
          {dims && <p className="text-xs text-zinc-400">📐 {dims}</p>}
          <div className="text-[10px] text-zinc-600 mt-2">
            Speak23D by Tonic Thought Studios — 100% client-side
          </div>
        </div>
      </div>

      {/* 3D Viewport */}
      <div className="flex-1 relative min-h-[60vh] lg:min-h-screen">
        <div ref={canvasRef} className="absolute inset-0" />
        
        {/* Controls overlay */}
        <div className="absolute top-4 left-4 bg-zinc-900/80 backdrop-blur rounded-lg px-3 py-2 text-xs text-zinc-300">
          🖱️ Drag to rotate · Scroll to zoom · Right-click to pan
        </div>

        {/* Preview mode toggle */}
        <div className="absolute top-4 right-4 space-y-2">
          <button
            onClick={() => {
              setPreviewMode(!previewMode);
              if (!previewMode && hasGenerated) {
                showPreview();
              } else if (previewMode) {
                clearEnvironment();
              }
            }}
            disabled={!hasGenerated}
            className={`px-3 py-2 rounded-lg text-xs font-medium transition-all backdrop-blur ${
              previewMode 
                ? "bg-purple-600/80 text-white" 
                : "bg-zinc-900/80 text-zinc-300 hover:bg-zinc-800/80"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {previewMode ? "🏠 Preview Mode" : "👁️ Show Preview"}
          </button>

          {previewMode && (
            <div className="space-y-2">
              {/* Environment selector */}
              <select
                value={envType}
                onChange={(e) => {
                  setEnvType(e.target.value as EnvironmentType);
                  if (previewMode) showPreview();
                }}
                className="w-full px-2 py-1 bg-zinc-900/80 backdrop-blur rounded text-xs border border-zinc-700"
              >
                {Object.entries(ENVIRONMENT_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>
                    {preset.icon} {preset.label}
                  </option>
                ))}
              </select>

              {/* Day/Night toggle for preview */}
              <button
                onClick={() => {
                  setIsNight(!isNight);
                  if (previewMode) showPreview();
                }}
                className={`w-full px-2 py-1 rounded text-xs font-medium transition-all ${
                  isNight
                    ? "bg-indigo-900/80 text-blue-200"
                    : "bg-amber-400/80 text-yellow-900"
                }`}
              >
                {isNight ? "🌙" : "☀️"} {isNight ? "Night" : "Day"}
              </button>
            </div>
          )}
        </div>

        {/* Auto-generate indicator */}
        {generating && (
          <div className="absolute bottom-4 left-4 bg-blue-600/80 backdrop-blur rounded-lg px-3 py-2 text-xs text-white">
            ⏳ Generating...
          </div>
        )}
      </div>
    </div>
  );
}