# Engraving Table - Project Context

## Overview
This is a Next.js application for visualizing and generating 3D meshes from Signed Distance Functions (SDFs). The primary use case is creating engraved signet rings with planetary ephemeris data and custom date text.

## Key Components

### 1. Web Viewer (`src/app/page.tsx`)
- Real-time raymarching visualization using Three.js and custom GLSL shaders
- Combines ephemeris ring SDF with MSDF text rendering
- Text is wrapped around the inner cylinder of the ring and subtracted (engraved)
- Interactive: drag to rotate, scroll to zoom, text input to change engraved text

### 2. Text Mesh Generator (`generate-text-mesh.js`)
Generates standalone text SDFs for mesh generation.
```bash
node generate-text-mesh.js "Hello" --depth 0.15
```
Output goes to `../sdfs/text-<name>/`

### 3. Engraved Ephemeris Generator (`generate-engraved-ephemeris.js`)
Creates combined ring + engraved date SDFs.
```bash
node generate-engraved-ephemeris.js 07-04-1776
node generate-engraved-ephemeris.js 01-15-2024 --resolution 400 --name my-ring
```
- Takes date in `mm-dd-yyyy` format
- Converts to display text with centered dots: `07·04·1776`
- Sets planetary positions to that Unix timestamp
- Output goes to `../sdfs/<name>/`

## SDF Output Structure
Each generated SDF folder contains:
- `sdf.txt` - GLSL shader code with `mapDistance(vec3 p)` function
- `params.json` - Size, resolution, texture flag, metadata
- `texture-declarations.txt` - Uniform declarations for textures
- `msdf.png` - Multi-channel signed distance field font texture

## Mesh Generation Workflow
1. Generate SDF: `node generate-engraved-ephemeris.js <date>`
2. Start mesher server: `cd ../sdf-mesher && python3 -m http.server 8000`
3. Run automation: `cd ../sdf-mesher && node auto-mesh.js <sdf-name>`
4. STL downloads to browser's download folder

## Key Technical Details

### Ephemeris Ring Geometry
- Located at `public/sdfs/ephemeris.glsl`
- Inner cylinder radius: 3.9 (defined in `drillHole` function)
- Band position Y offset: 3.7 (`bandPosY`)
- Signet offset: 0.8
- `targetDate` variable controls planetary positions (Unix timestamp)

### Text Cylinder Wrapping
Text is wrapped onto the inner cylinder surface using cylindrical coordinate transformation:
```glsl
// Transform to match drill hole coordinates
q.y += 0.8;   // signet offset
q.y += 3.7;   // bandPosY offset
q.xy = Rot2D(PI/2.0) * q.xy;  // Rotate to align with cylinder axis

// Map to text coordinates (flipped 180 degrees)
float textX = -angle * cylinderRadius / textScale;
float textY = -(h + 0.3) / textScale;
```

### MSDF Font
- Font: PPRightSerifMono
- Atlas: 344x344 pixels
- Located at `public/fonts/PPRightSerifMono-msdf.{json,png}`
- Middle dot (·) is rendered using period glyph with vertical offset

## Common Issues

### Empty text causes shader error
The viewer handles this with `hasText` flag - when no glyphs, text functions return large distance and uniforms are omitted.

### Duplicate uniform declarations
The mesher injects `texture-declarations.txt` at runtime, so don't include `uniform sampler2D uMsdfTexture;` in `sdf.txt`.

### Historical dates (before 1970)
Script supports negative Unix timestamps for dates like 1776.

## Dependencies
- Next.js, React, Three.js (viewer)
- pngjs (font texture loading in scripts)
- puppeteer (mesh generation automation in sdf-mesher)

## Related Directories
- `../sdf-mesher/` - WebGL marching cubes mesh generator
- `../sdfs/` - Generated SDF output folders
- `../meshes/` - Final STL output
- `../factory.py` - Post-processing pipeline (decimate, manifold, resize)
