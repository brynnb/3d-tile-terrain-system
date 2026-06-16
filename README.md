# 3D Tile Terrain System

A standalone 3D tile-based terrain editor demo built with React + Babylon.js. Very much a WIP with bugs and half-baked features. 


---

## Running Locally

```bash
npm install
npm run dev
```

For a production build:

```bash
npm run build
```

---

## Tech Stack

- **React** — UI (sidebar, toolbars, palette)
- **Babylon.js** — 3D rendering, scene, materials, meshes
- **TypeScript** — fully typed throughout
- **Vite** — dev server and build

---

## Features

### Tools

| Tool                  | Description                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Floor**       | Paint floor tiles from a tileset. Supports NxN brush size, fill mode, and custom rect selection.                                                   |
| **Wall**        | Click-drag to place walls. Walls have their own texture library (brick, stone, cave, etc.) and can be toggled between flat and 3D billboard modes. |
| **Mountain**    | Place upward terrain elevations. See[Mountains](#mountains) below.                                                                                    |
| **Autotile**    | Paint autotiles (water, lava, snow, etc.) that automatically connect to neighbours. Animated autotiles (water, lava) cycle through frames.         |
| **Sprite**      | Place 2D billboard sprites from the tileset, with fix/face/fixed orientations.                                                                     |
| **Object (3D)** | Place OBJ mesh objects with texture variants. Preview appears at cursor before placement. Rotate with keys 1/2/3/4.                                |
| **Eraser**      | NxN eraser that removes floors, walls, mountains, autotiles, sprites, and 3D objects.                                                              |

### Camera

- **Default** — orbit camera: right-drag to rotate, scroll to zoom
- **FPS** — first-person camera: WASD + mouse look (pointer lock)
- Toggle via buttons in the top-left corner of the viewport

### Scene

- **Skybox** — choose from day, evening-sun, and night skyboxes with per-skybox tint controls
- **Fog** — linear fog with configurable start distance and render distance
- **Grid** — toggleable grid overlay on the floor plane
- **Undo** — Ctrl+Z to undo any placement or erase action

### Sidebar Tabs

- **Tools** — main editor tools and their settings
- **Skybox** — skybox selection and tint adjustment
- **Objects** — 3D object browser with live Babylon.js thumbnail previews

---

## Mountains

Mountains are terrain elevations placed on a tile grid. They are generated procedurally from a texture atlas (`/tilesets/mountains/*.png`) and parameterised by border width and height.

### Texture Atlas Layout

Mountain textures use a **4×4 sprite atlas** (each cell is `SQUARE_SIZE` pixels):

```
Col:  LEFT   MID   RIGHT   MIX
Row 0 (TOP):   top-edge sections
Row 1 (MID):   middle sections
Row 2 (BOT):   bottom-edge sections
Row 3 (MIX):   single-tile mix (used for simple faces)
```

- **TOP / BOT** — used at the top and bottom of tall mountains (> 1 tile high)
- **MID** — repeated for mountains taller than 2 tiles
- **MIX** — used when the face fits in a single tile
- **LEFT / MID / RIGHT** columns handle corner and side variations based on neighbours

### Parameters

| Parameter                                | Description                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Width Squares / Width Pixels**   | How far the mountain slopes outward from the tile edge. Width in whole tiles or sub-pixel percentage. These are mutually exclusive — setting one clears the other. |
| **Height Squares / Height Pixels** | How tall the mountain rises. Same mutual-exclusion rule.                                                                                                            |
| **Texture**                        | The mountain texture atlas to use (grass, snow, sand, cave, etc.)                                                                                                   |
| **Inverted**                       | If checked, creates an inverted mountain (pit). See below.                                                                                                          |

### Neighbour Awareness

When multiple mountains of the same type are placed adjacent to each other, they detect neighbours (top/bottom/left/right) and merge their geometry — shared edges are omitted and slopes blend seamlessly.

Normal and inverted mountains are treated as separate types and do not neighbour-merge with each other.

### Geometry Generation

Each exposed side of a mountain generates:

- A **slope face** — a quad angled from the outer floor level up to the mountain peak, with texture UVs mapped to the appropriate atlas column (LEFT/MID/RIGHT) and row (TOP/MID/BOT/MIX) based on height
- **Corner pieces** — triangle or quad fills between adjacent slope faces

---

## Inverted Mountains (Pits)

An inverted mountain is the exact opposite of a normal mountain — terrain that goes **downward** into the ground, creating a pit or crater.

### Geometry

Each exposed side generates a face that slopes **from the outer floor level down to the pit bottom**:

- **Width = 0** — a straight vertical wall from surface level down to pit bottom
- **Width > 0** — an angled slope quad, with the outer edge sitting at surface level (displaced outward by the border width) and the inner edge at the pit bottom

Corner triangles fill the diagonal gaps between adjacent slope faces (only when width > 0).

The texture is applied the same as regular mountains using the MIX atlas section, but with **V coordinates flipped** so the grass-border blending is at the **bottom** (lowest level) rather than the top — matching the visual expectation of the pit's bottom (which is a grass tile).

### Floor Tile Removal

When a pit is placed, surrounding floor tiles are automatically removed or cut in the render pass:

| Tile position relative to pit                            | Action                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| Width = 0                                                | No floor tiles affected                                             |
| On a cardinal axis (N/S/E/W), within border reach        | **Removed entirely**                                          |
| On a diagonal, Manhattan distance = reach (interior)     | **Removed entirely**                                          |
| On the diagonal cut line, Manhattan distance = reach + 1 | **Diagonally cut** (half-triangle kept, facing away from pit) |
| Beyond that                                              | Untouched                                                           |

**Example with border width = 2 (reach = 2):**

- 8 cardinal tiles removed (2 in each of N/S/E/W)
- 4 diagonal interior tiles removed
- 8 diagonal boundary tiles half-cut

The reach is computed as `ceil(borderWidthPixels / SQUARE_SIZE)`.

### Floor Tile Placement

When an inverted mountain is placed:

- The surface floor tile at the mountain's position is removed
- A floor tile is placed at the **pit bottom** (`y = -height`) so the pit has a visible floor

---

## Project Structure

```
src/
  components/
    App.tsx              — Main UI: sidebar, tool controls, state management
    BabylonCanvas.tsx    — Babylon.js scene, mesh building, input handling
    TilesetPalette.tsx   — Tileset picker panel
  editor/
    MapEditorState.ts    — Map data store: floors, walls, mountains, sprites, objects
  terrain/
    Constants.ts         — SQUARE_SIZE and shared constants
    Position.ts          — Tile coordinate class (supports negative Y)
    MapPortion.ts        — Tile data storage
    FloorGeometry.ts     — Floor tile mesh builder (with diagonal cut support)
    WallGeometry.ts      — Wall mesh builder
    MountainGeometry.ts  — Mountain + inverted mountain mesh builder
    MountainAtlas.ts     — Mountain texture atlas utilities
    AutotileAtlas.ts     — Autotile atlas layout and animation
    AutotileGeometry.ts  — Autotile mesh builder
    SpriteGeometry.ts    — 2D billboard sprite mesh builder
    ObjLoader.ts         — Lightweight OBJ mesh parser
  data/
    objects3d-catalog.ts — 3D object mesh + texture variant catalog
public/
  tilesets/              — Floor tilesets and mountain texture atlases
  walls/                 — Wall textures
  autotiles/             — Autotile texture sets
  objects3d/
    meshes/              — OBJ mesh files
    textures/            — Object textures
```
