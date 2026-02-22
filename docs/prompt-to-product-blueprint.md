# Prompt-to-Product Blueprint — NotebookLM Export
## Source: Michael's research for Speak23D v1 — Democratizing Additive Manufacturing

### Directly Actionable for Speak23D NOW

#### Mesh Integrity (already partially implemented)
- Auto-triangulation (STL export already does this)
- Watertight/manifold validation — should add check before export
- Boolean Union for overlapping shapes (CSG already used for mounting holes)

#### Bambu X1 Carbon Hardware Intelligence
- **PA6-CF/ABS/PC**: Require 80°C drying for 8 hours — add to README in export bundle
- **CF/GF materials**: Recommend 0.6mm hardened steel nozzle (add to AI recommendations)
- **TPU/damp PVA**: Manual feed only, no AMS — add warning
- **Max nozzle 300°C, max bed 120°C** — safety info in export
- **Filament purge protocol**: When switching high-temp to low-temp materials
- **Print by Object**: For batches of small letters — prevents over-cooling between layers
- **Smart orientation**: Smallest dimension vertical for speed + Z-strength

#### AI Recommendations Enhancements
- Material-specific drying requirements
- Nozzle size recommendations based on material
- Print orientation guidance
- "Strength vs Cost" concept — could be a simple slider (lightweight vs max strength infill)

#### Shell/Hollow Logic
- 1.5mm shell thickness for hollowed parts — saves material on larger signs
- Could add "Hollow interior" toggle for big letters to save filament

### Future Features (Not Now)
- Generative design / topology optimization
- AI surrogate models for real-time FEA
- 4D printing (shape-memory, humidity response, photoresponsive)
- Multi-material metal printing
- Strength vs Cost slider with real-time geometry morphing
