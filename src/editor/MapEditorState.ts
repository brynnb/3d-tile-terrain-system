/**
 * MapEditorState — manages the tile map data and editing operations.
 * Follows RPM's pattern: Position key → FloorData value in a portion.
 * On change, marks dirty and allows mesh rebuild.
 */

import { FloorData } from "../terrain/FloorGeometry";
import { MountainData } from "../terrain/MountainGeometry";
import { SpriteData, SpriteKind } from "../terrain/SpriteGeometry";
import { WallData, WallEdge } from "../terrain/WallGeometry";
import { TerrainTileData, TerrainKey, makeTerrainKey } from "../terrain/TerrainGeometry";
import { getAutotileTileID } from "../terrain/AutotileAtlas";
import { SQUARE_SIZE } from "../terrain/Constants";

/** Serializable key for a tile position (matches RPM array format). */
export type PositionKey = string; // "x,y,yPx,z,layer"

export function makePositionKey(x: number, y: number, yPx: number, z: number, layer: number): PositionKey {
    return `${x},${y},${yPx},${z},${layer}`;
}

export function parsePositionKey(key: PositionKey): number[] {
    // Returns [x, y, yPx, z, layer] — note RPM JSON array order is [x, y, yPx, z, layer]
    return key.split(",").map(Number);
}

/** Convert our key back to RPM JSON "k" array format: [x, y, yPixels, z, layer] */
export function positionKeyToArray(key: PositionKey): number[] {
    return parsePositionKey(key);
}

export interface SelectedTile {
    col: number;
    row: number;
}

export interface FloorEntry {
    k: number[];  // [x, y, yPixels, z, layer]
    v: FloorData;
}

export interface MountainEntry {
    k: number[];  // [x, y, yPixels, z, layer]
    v: MountainData;
}

export type EditorTool = "floor" | "mountain" | "sprite" | "wall" | "autotile" | "eraser" | "object3d" | "terrain";

export interface Object3DData {
    /** Mesh file name (without .obj) */
    mesh: string;
    /** Texture file name (without .png) */
    tex: string;
    /** Rotation in radians [x, y, z] */
    rot: [number, number, number];
}

export interface AutotileData {
    /** Autotile image name (e.g. "water", "general") */
    src: string;
    /** Autotile unit index within the image */
    idx: number;
    /** Computed tileID from neighbor configuration (0-624) */
    tid: number;
}

export interface AutotileEntry {
    k: number[];
    v: AutotileData;
}

export interface SpriteEntry {
    k: number[];  // [x, y, yPixels, z, layer]
    v: SpriteData;
}

export interface WallEntry {
    k: number[];  // [x, y, yPixels, z, layer]
    v: WallData;
}

export interface PortionData {
    lands: {
        floors: FloorEntry[];
    };
    moun?: MountainEntry[];
}

/** Snapshot of all map data for undo */
interface MapSnapshot {
    floors: Map<PositionKey, FloorData>;
    mountains: Map<PositionKey, MountainData>;
    sprites: Map<PositionKey, SpriteData>;
    walls: Map<string, WallData>;
    autotiles: Map<string, AutotileData>;
    objects3d: Map<string, Object3DData>;
    terrain: Map<TerrainKey, TerrainTileData>;
}

type ChangeListener = () => void;

export class MapEditorState {
    /** Map of position key → floor data */
    private floors: Map<PositionKey, FloorData> = new Map();

    /** Map of position key → mountain data */
    private mountains: Map<PositionKey, MountainData> = new Map();

    /** Map of position key → sprite data */
    private sprites: Map<PositionKey, SpriteData> = new Map();

    /** Map of "x,z,edge" → wall data */
    private walls: Map<string, WallData> = new Map();

    /** Map of "x,z" → autotile data */
    private autotiles: Map<string, AutotileData> = new Map();

    /** Map of "x,z" → placed 3D object data */
    private objects3d: Map<string, Object3DData> = new Map();

    /** Map of "x,z" → terrain tile data (height-based terrain system) */
    private terrain: Map<TerrainKey, TerrainTileData> = new Map();

    /** Currently selected tile in the tileset palette */
    public selectedTile: SelectedTile = { col: 0, row: 0 };

    /** Active editor tool */
    public activeTool: EditorTool = "floor";

    /** Mountain placement settings (matches RPM defaults: ws=0, wp=0, hs=1, hp=0) */
    public mountainWidthSquares = 0;
    public mountainWidthPixels = 0;
    public mountainHeightSquares = 1;
    public mountainHeightPixels = 0;
    /** If true, mountains are placed going downward (inverted/pit) */
    public mountainInverted = false;

    /** Grid overlay visibility */
    public showGrid = true;

    /** Current sprite kind for placement */
    public spriteKind: SpriteKind = "fix";

    /** Sprite texture rect size (in tiles) for multi-tile sprites */
    public spriteWidth = 1;
    public spriteHeight = 1;

    /** Current wall edge for placement */
    public wallEdge: WallEdge = "south";

    /** Wall texture source path */
    public wallTextureSrc = "/tilesets/walls/brick.png";

    /** Whether to place 3D (box) walls instead of 2D sprite walls */
    public wall3d = false;

    /** Current autotile source name */
    public autotileSrc = "water";
    /** Current autotile unit index */
    public autotileIdx = 0;
    /** Autotile brush size (NxN) */
    public autotileBrushSize = 1;

    /** Current 3D object selection */
    public object3dMesh = "barrel";
    public object3dTex = "barrel";
    public object3dRot: [number, number, number] = [0, 0, 0];

    /** Current tileset source path */
    public tilesetSrc = "/tilesets/plains-woods.png";

    /** Terrain tool settings */
    public terrainHeight = -1;        // height in tile units (negative = pit, positive = hill)
    public terrainSlopeWidth = 0;     // 0=vertical wall, 1+=angled slope (in tiles)
    public terrainBrushSize = 1;      // NxN brush

    /** Current mountain texture source path */
    public mountainTexSrc = "/tilesets/mountains/grass.png";

    /** Floor brush size (NxN) */
    public brushSize = 1;

    /** Eraser brush size (NxN) */
    public eraserBrushSize = 1;

    /** Floor paint mode: "brush", "fill", or "custom" (custom = drag-selected region) */
    public paintMode: "brush" | "fill" | "custom" = "brush";

    /** Custom floor region (col, row, w, h) for stamping a selected tileset region */
    public floorRect: { col: number; row: number; w: number; h: number } = { col: 0, row: 0, w: 1, h: 1 };

    /** Map dimensions (in tiles) */
    public mapWidth: number;
    public mapDepth: number;

    private listeners: ChangeListener[] = [];
    private _dirty = false;

    /** Undo history (max 5 snapshots) */
    private undoStack: MapSnapshot[] = [];
    private static MAX_UNDO = 5;

    constructor(mapWidth = 16, mapDepth = 16) {
        this.mapWidth = mapWidth;
        this.mapDepth = mapDepth;
    }

    // ── Undo ──

    private takeSnapshot(): MapSnapshot {
        return {
            floors: new Map(Array.from(this.floors, ([k, v]) => [k, { ...v, t: [...v.t] }])),
            mountains: new Map(Array.from(this.mountains, ([k, v]) => [k, { ...v }])),
            sprites: new Map(Array.from(this.sprites, ([k, v]) => [k, { ...v, t: [...v.t] }])),
            walls: new Map(Array.from(this.walls, ([k, v]) => [k, { ...v }])),
            autotiles: new Map(Array.from(this.autotiles, ([k, v]) => [k, { ...v }])),
            objects3d: new Map(Array.from(this.objects3d, ([k, v]) => [k, { ...v, rot: [...v.rot] as [number, number, number] }])),
            terrain: new Map(Array.from(this.terrain, ([k, v]) => [k, { ...v, t: [...v.t] }])),
        };
    }

    /** Push current state to undo stack before a destructive operation */
    pushUndo(): void {
        this.undoStack.push(this.takeSnapshot());
        if (this.undoStack.length > MapEditorState.MAX_UNDO) {
            this.undoStack.shift();
        }
    }

    /** Restore the last snapshot from the undo stack */
    undo(): boolean {
        const snap = this.undoStack.pop();
        if (!snap) return false;
        this.floors = snap.floors;
        this.mountains = snap.mountains;
        this.sprites = snap.sprites;
        this.walls = snap.walls;
        this.autotiles = snap.autotiles;
        this.objects3d = snap.objects3d;
        this.terrain = snap.terrain;
        this.notify();
        return true;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    onChange(fn: ChangeListener): () => void {
        this.listeners.push(fn);
        return () => {
            this.listeners = this.listeners.filter(l => l !== fn);
        };
    }

    private notify(): void {
        this._dirty = true;
        for (const fn of this.listeners) fn();
    }

    get dirty(): boolean { return this._dirty; }
    clearDirty(): void { this._dirty = false; }

    /**
     * Load from RPM-format portion JSON.
     */
    loadFromJSON(json: PortionData): void {
        this.floors.clear();
        if (json.lands?.floors) {
            for (const entry of json.lands.floors) {
                const k = entry.k;
                const key = makePositionKey(k[0], k[1], k[2], k[3], k[4] ?? 0);
                this.floors.set(key, entry.v);
            }
        }
        this.notify();
    }

    /**
     * Paint a floor tile at the given position.
     * Always replaces any existing tile — no layering.
     */
    paintFloor(x: number, z: number, tile: SelectedTile): void {
        const key = makePositionKey(x, 0, 0, z, 0);
        const existing = this.floors.get(key);
        if (existing && existing.t[0] === tile.col && existing.t[1] === tile.row
            && (existing.tex || this.tilesetSrc) === this.tilesetSrc) {
            return; // already there (same tile AND same tileset)
        }
        this.floors.set(key, {
            t: [tile.col, tile.row],
            tex: this.tilesetSrc,
        });
        this.notify();
    }

    /** Paint a floor using current brush size (NxN) centered on (cx,cz). Pushes undo. */
    paintFloorBrush(cx: number, cz: number, tile: SelectedTile): void {
        const half = Math.floor(this.brushSize / 2);
        for (let dx = -half; dx < this.brushSize - half; dx++) {
            for (let dz = -half; dz < this.brushSize - half; dz++) {
                const px = cx + dx, pz = cz + dz;
                if (px >= 0 && px < this.mapWidth && pz >= 0 && pz < this.mapDepth) {
                    const key = makePositionKey(px, 0, 0, pz, 0);
                    const existing = this.floors.get(key);
                    if (existing && existing.t[0] === tile.col && existing.t[1] === tile.row
                        && (existing.tex || this.tilesetSrc) === this.tilesetSrc) {
                        continue;
                    }
                    this.floors.set(key, { t: [tile.col, tile.row], tex: this.tilesetSrc });
                }
            }
        }
        this.notify();
    }

    /** Paint a custom rectangle region of tiles centered on (cx,cz). */
    paintFloorRect(cx: number, cz: number): void {
        const r = this.floorRect;
        const halfW = Math.floor(r.w / 2);
        const halfH = Math.floor(r.h / 2);
        for (let dx = 0; dx < r.w; dx++) {
            for (let dz = 0; dz < r.h; dz++) {
                const px = cx + dx - halfW, pz = cz + dz - halfH;
                if (px >= 0 && px < this.mapWidth && pz >= 0 && pz < this.mapDepth) {
                    const tileCol = r.col + dx;
                    const tileRow = r.row + dz;
                    const key = makePositionKey(px, 0, 0, pz, 0);
                    const existing = this.floors.get(key);
                    if (existing && existing.t[0] === tileCol && existing.t[1] === tileRow
                        && (existing.tex || this.tilesetSrc) === this.tilesetSrc) {
                        continue;
                    }
                    this.floors.set(key, { t: [tileCol, tileRow], tex: this.tilesetSrc });
                }
            }
        }
        this.notify();
    }

    /** Flood fill: replace all connected tiles matching the clicked tile with the new tile. Pushes undo. */
    floodFill(startX: number, startZ: number, tile: SelectedTile): void {
        // Get what's currently at the clicked position
        const startKey = makePositionKey(startX, 0, 0, startZ, 0);
        const startExisting = this.floors.get(startKey);
        let targetCol: number, targetRow: number;
        if (startExisting) {
            targetCol = startExisting.t[0];
            targetRow = startExisting.t[1];
        } else {
            targetCol = -1; // empty
            targetRow = -1;
        }
        // Don't fill if target equals replacement
        if (targetCol === tile.col && targetRow === tile.row) return;

        this.pushUndo();
        const visited = new Set<string>();
        const queue: [number, number][] = [[startX, startZ]];
        while (queue.length > 0) {
            const [x, z] = queue.shift()!;
            const vk = `${x},${z}`;
            if (visited.has(vk)) continue;
            visited.add(vk);
            if (x < 0 || x >= this.mapWidth || z < 0 || z >= this.mapDepth) continue;

            // Check if this tile matches the target
            const key = makePositionKey(x, 0, 0, z, 0);
            const cur = this.floors.get(key);
            let curCol: number, curRow: number;
            if (cur) {
                curCol = cur.t[0];
                curRow = cur.t[1];
            } else {
                curCol = -1;
                curRow = -1;
            }
            if (curCol !== targetCol || curRow !== targetRow) continue;

            // Replace at layer 0
            this.floors.set(key, { t: [tile.col, tile.row], tex: this.tilesetSrc });

            // Expand to 4 neighbors
            queue.push([x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]);
        }
        this.notify();
    }

    /**
     * Erase the floor tile at the given position.
     */
    eraseFloor(x: number, z: number): void {
        const key = makePositionKey(x, 0, 0, z, 0);
        if (this.floors.delete(key)) {
            this.notify();
        }
    }

    /**
     * Place a mountain at the given position (RPM addMountain pattern).
     * Also updates neighbor flags on adjacent mountains.
     */
    placeMountain(x: number, z: number): void {
        const key = makePositionKey(x, 0, 0, z, 0);
        const inv = this.mountainInverted;
        const mountain: MountainData = {
            sid: 1,
            ws: this.mountainWidthSquares,
            wp: this.mountainWidthPixels,
            hs: this.mountainHeightSquares,
            hp: this.mountainHeightPixels,
            t: false,
            b: false,
            l: false,
            r: false,
            tex: this.mountainTexSrc,
            inverted: inv,
        };
        this.mountains.set(key, mountain);
        this.updateMountainNeighbors(x, z);

        // Auto-place a floor tile at the mountain's end position.
        // Normal mountains: floor on top at positive Y.
        // Inverted mountains: floor at the bottom of the pit at negative Y.
        const hp = this.mountainHeightSquares * SQUARE_SIZE +
            Math.round(this.mountainHeightPixels * SQUARE_SIZE / 100);
        const ySq = Math.floor(hp / SQUARE_SIZE);
        const yPx = Math.round(((hp % SQUARE_SIZE) / SQUARE_SIZE) * 100);

        if (inv) {
            // For inverted: place floor tile at negative Y (bottom of pit)
            // We encode negative Y by using a special convention: negative ySq
            const bottomKey = makePositionKey(x, -ySq, yPx, z, 0);
            if (!this.floors.has(bottomKey)) {
                this.floors.set(bottomKey, { t: [this.selectedTile.col, this.selectedTile.row], tex: this.tilesetSrc });
            }
            // Also remove the surface-level floor tile so the pit opening is visible
            const surfaceKey = makePositionKey(x, 0, 0, z, 0);
            this.floors.delete(surfaceKey);
        } else {
            const topKey = makePositionKey(x, ySq, yPx, z, 0);
            if (!this.floors.has(topKey)) {
                this.floors.set(topKey, { t: [this.selectedTile.col, this.selectedTile.row], tex: this.tilesetSrc });
            }
        }

        this.notify();
    }

    /**
     * Remove a mountain at the given position.
     * Also removes the auto-placed floor tile on top of the mountain.
     */
    removeMountain(x: number, z: number): void {
        const key = makePositionKey(x, 0, 0, z, 0);
        const mtn = this.mountains.get(key);
        if (mtn) {
            const hp = mtn.hs * SQUARE_SIZE + Math.round(mtn.hp * SQUARE_SIZE / 100);
            const ySq = Math.floor(hp / SQUARE_SIZE);
            const yPx = Math.round(((hp % SQUARE_SIZE) / SQUARE_SIZE) * 100);
            if (mtn.inverted) {
                // Remove the auto-placed floor tile at the bottom of the pit
                for (let layer = 0; layer < 10; layer++) {
                    this.floors.delete(makePositionKey(x, -ySq, yPx, z, layer));
                }
                // Restore surface-level floor tile
                const surfaceKey = makePositionKey(x, 0, 0, z, 0);
                if (!this.floors.has(surfaceKey)) {
                    this.floors.set(surfaceKey, { t: [this.selectedTile.col, this.selectedTile.row], tex: this.tilesetSrc });
                }
            } else {
                // Remove the auto-placed floor tile on top
                for (let layer = 0; layer < 10; layer++) {
                    this.floors.delete(makePositionKey(x, ySq, yPx, z, layer));
                }
            }
            this.mountains.delete(key);
            this.updateMountainNeighbors(x, z);
            this.notify();
        }
    }

    /**
     * Update neighbor flags for a mountain and its 4+4 neighbors.
     * Follows RPM Mountains::tileOnLeft/Right/Top/Bottom pattern.
     * Also computes diagonal neighbor flags for inverted mountains (pits)
     * to handle concave corner geometry.
     */
    private updateMountainNeighbors(x: number, z: number): void {
        const positions = [
            [x, z], [x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1],
            // Include diagonals so they also get updated
            [x - 1, z - 1], [x + 1, z - 1], [x - 1, z + 1], [x + 1, z + 1],
        ];
        // Helper: check if neighbor at (nx,nz) is same type (inverted/normal)
        const hasSameType = (m: MountainData, nx: number, nz: number): boolean => {
            const nKey = makePositionKey(nx, 0, 0, nz, 0);
            const n = this.mountains.get(nKey);
            return !!n && !!n.inverted === !!m.inverted;
        };
        for (const [px, pz] of positions) {
            const key = makePositionKey(px, 0, 0, pz, 0);
            const m = this.mountains.get(key);
            if (!m) continue;
            // Cardinal neighbors
            m.l = hasSameType(m, px - 1, pz);
            m.r = hasSameType(m, px + 1, pz);
            m.t = hasSameType(m, px, pz - 1);
            m.b = hasSameType(m, px, pz + 1);
            // Diagonal neighbors (for concave corner detection in pits)
            if (m.inverted) {
                m.tl = hasSameType(m, px - 1, pz - 1);
                m.tr = hasSameType(m, px + 1, pz - 1);
                m.bl = hasSameType(m, px - 1, pz + 1);
                m.br = hasSameType(m, px + 1, pz + 1);
            }
        }
    }

    // ── Sprites ──

    placeSprite(x: number, z: number, tile: SelectedTile): void {
        // If there's a mountain at this position, place sprite on top of it
        const mtnKey = makePositionKey(x, 0, 0, z, 0);
        const mtn = this.mountains.get(mtnKey);
        let ySq = 0, yPx = 0;
        if (mtn) {
            const hp = mtn.hs * SQUARE_SIZE + Math.round(mtn.hp * SQUARE_SIZE / 100);
            ySq = Math.floor(hp / SQUARE_SIZE);
            yPx = Math.round(((hp % SQUARE_SIZE) / SQUARE_SIZE) * 100);
        }
        const key = makePositionKey(x, ySq, yPx, z, 0);
        const sprite: SpriteData = {
            t: [tile.col, tile.row, this.spriteWidth, this.spriteHeight],
            k: this.spriteKind,
            tex: this.tilesetSrc,
        };
        this.sprites.set(key, sprite);
        this.notify();
    }

    eraseSprite(x: number, z: number): void {
        // Search all sprites at this x,z regardless of Y
        let changed = false;
        for (const key of this.sprites.keys()) {
            const parts = parsePositionKey(key);
            if (parts[0] === x && parts[3] === z) {
                this.sprites.delete(key);
                changed = true;
            }
        }
        if (changed) this.notify();
    }

    getSpriteEntries(): SpriteEntry[] {
        const entries: SpriteEntry[] = [];
        for (const [key, v] of this.sprites) {
            entries.push({ k: parsePositionKey(key), v });
        }
        return entries;
    }

    // ── Walls ──

    private makeWallKey(x: number, z: number, edge: WallEdge): string {
        return `${x},${z},${edge}`;
    }

    placeWall(x: number, z: number, edge: WallEdge): void {
        const wKey = this.makeWallKey(x, z, edge);
        // Auto-detect wall kind based on neighbors on same edge axis
        const wall: WallData = { k: 1, edge, tex: this.wallTextureSrc, is3d: this.wall3d };
        this.walls.set(wKey, wall);
        this.updateWallNeighbors(x, z, edge);
        this.notify();
    }

    /** Place a line of walls from (x0,z0) to (x1,z1). Auto-detects edge from direction. */
    placeWallLine(x0: number, z0: number, x1: number, z1: number): void {
        const dx = x1 - x0;
        const dz = z1 - z0;
        // Determine primary direction and edge
        let edge: WallEdge;
        if (Math.abs(dx) >= Math.abs(dz)) {
            // Horizontal drag → south or north edge
            edge = dz >= 0 ? "south" : "north";
            const startX = Math.min(x0, x1);
            const endX = Math.max(x0, x1);
            for (let x = startX; x <= endX; x++) {
                const wKey = this.makeWallKey(x, z0, edge);
                this.walls.set(wKey, { k: 1, edge, tex: this.wallTextureSrc, is3d: this.wall3d });
            }
            // Update neighbors for all placed walls
            for (let x = startX; x <= endX; x++) {
                this.updateWallNeighbors(x, z0, edge);
            }
        } else {
            // Vertical drag → east or west edge
            edge = dx >= 0 ? "east" : "west";
            const startZ = Math.min(z0, z1);
            const endZ = Math.max(z0, z1);
            for (let z = startZ; z <= endZ; z++) {
                const wKey = this.makeWallKey(x0, z, edge);
                this.walls.set(wKey, { k: 1, edge, tex: this.wallTextureSrc, is3d: this.wall3d });
            }
            for (let z = startZ; z <= endZ; z++) {
                this.updateWallNeighbors(x0, z, edge);
            }
        }
        this.notify();
    }

    eraseWall(x: number, z: number, edge: WallEdge): void {
        const wKey = this.makeWallKey(x, z, edge);
        if (this.walls.delete(wKey)) {
            this.updateWallNeighbors(x, z, edge);
            this.notify();
        }
    }

    /** Erase all walls at a tile position (all 4 edges + adjacent tiles' bordering edges) */
    eraseAllWalls(x: number, z: number): void {
        let changed = false;
        // Walls directly on this tile
        for (const edge of ["south", "east", "north", "west"] as WallEdge[]) {
            if (this.walls.delete(this.makeWallKey(x, z, edge))) changed = true;
        }
        // Adjacent tiles' edges that visually border this tile
        if (this.walls.delete(this.makeWallKey(x, z - 1, "south"))) changed = true; // south edge of tile above = north border of (x,z)
        if (this.walls.delete(this.makeWallKey(x - 1, z, "east"))) changed = true;  // east edge of tile to the left = west border of (x,z)
        if (this.walls.delete(this.makeWallKey(x, z + 1, "north"))) changed = true; // north edge of tile below = south border of (x,z)
        if (this.walls.delete(this.makeWallKey(x + 1, z, "west"))) changed = true;  // west edge of tile to the right = east border of (x,z)
        if (changed) this.notify();
    }

    private updateWallNeighbors(x: number, z: number, edge: WallEdge): void {
        // For horizontal walls (south/north), check left/right neighbors
        // For vertical walls (east/west), check up/down neighbors
        const isHoriz = edge === "south" || edge === "north";
        const positions = isHoriz
            ? [[x - 1, z], [x, z], [x + 1, z]]
            : [[x, z - 1], [x, z], [x, z + 1]];
        for (const [px, pz] of positions) {
            const wKey = this.makeWallKey(px, pz, edge);
            const w = this.walls.get(wKey);
            if (!w) continue;
            const hasLeft = isHoriz
                ? this.walls.has(this.makeWallKey(px - 1, pz, edge))
                : this.walls.has(this.makeWallKey(px, pz - 1, edge));
            const hasRight = isHoriz
                ? this.walls.has(this.makeWallKey(px + 1, pz, edge))
                : this.walls.has(this.makeWallKey(px, pz + 1, edge));
            if (!hasLeft && !hasRight) w.k = 1; // isolated: use middle
            else if (!hasLeft && hasRight) w.k = 0; // left end
            else if (hasLeft && hasRight) w.k = 1; // middle
            else if (hasLeft && !hasRight) w.k = 2; // right end
        }
    }

    getWallEntries(): WallEntry[] {
        const entries: WallEntry[] = [];
        for (const [, v] of this.walls) {
            entries.push({ k: [0, 0, 0, 0, 0], v });
        }
        return entries;
    }

    getWallEntriesWithPos(): { x: number; z: number; v: WallData }[] {
        const entries: { x: number; z: number; v: WallData }[] = [];
        for (const [key, v] of this.walls) {
            const [xs, zs] = key.split(",");
            entries.push({ x: parseInt(xs), z: parseInt(zs), v });
        }
        return entries;
    }

    /**
     * Get all floors as RPM JSON entries (for geometry builder).
     */
    getFloorEntries(): FloorEntry[] {
        const entries: FloorEntry[] = [];
        for (const [key, v] of this.floors) {
            const parts = parsePositionKey(key);
            entries.push({ k: parts, v });
        }
        return entries;
    }

    /**
     * Get all mountains as entries (for geometry builder).
     */
    getMountainEntries(): MountainEntry[] {
        const entries: MountainEntry[] = [];
        for (const [key, v] of this.mountains) {
            const parts = parsePositionKey(key);
            entries.push({ k: parts, v });
        }
        return entries;
    }

    // ── Autotiles ──

    private makeAutotileKey(x: number, z: number): string {
        return `${x},${z}`;
    }

    placeAutotile(x: number, z: number): void {
        const half = Math.floor(this.autotileBrushSize / 2);
        for (let dx = -half; dx < this.autotileBrushSize - half; dx++) {
            for (let dz = -half; dz < this.autotileBrushSize - half; dz++) {
                const px = x + dx, pz = z + dz;
                if (px >= 0 && px < this.mapWidth && pz >= 0 && pz < this.mapDepth) {
                    this.autotiles.set(this.makeAutotileKey(px, pz), { src: this.autotileSrc, idx: this.autotileIdx, tid: 0 });
                    // Remove floor tiles underneath to prevent z-fighting
                    for (let l = 0; l < 10; l++) {
                        this.floors.delete(makePositionKey(px, 0, 0, pz, l));
                    }
                }
            }
        }
        // Update neighbors for the whole brush area
        for (let dx = -half - 1; dx <= this.autotileBrushSize - half; dx++) {
            for (let dz = -half - 1; dz <= this.autotileBrushSize - half; dz++) {
                const px = x + dx, pz = z + dz;
                const at = this.autotiles.get(this.makeAutotileKey(px, pz));
                if (at) this.recomputeAutotileTid(px, pz);
            }
        }
        this.notify();
    }

    eraseAutotile(x: number, z: number): void {
        const key = this.makeAutotileKey(x, z);
        if (this.autotiles.delete(key)) {
            this.updateAutotileNeighbors(x, z);
            this.notify();
        }
    }

    /** Recompute tileID for a single autotile at (px,pz). */
    private recomputeAutotileTid(px: number, pz: number): void {
        const at = this.autotiles.get(this.makeAutotileKey(px, pz));
        if (!at) return;
        const same = (nx: number, nz: number) => {
            const n = this.autotiles.get(this.makeAutotileKey(nx, nz));
            return !!n && n.src === at.src && n.idx === at.idx;
        };
        const neighbors: boolean[] = [
            same(px, pz - 1),     // top (z-1)
            same(px + 1, pz),     // right
            same(px, pz + 1),     // bottom (z+1)
            same(px - 1, pz),     // left
            same(px - 1, pz - 1), // topLeft
            same(px + 1, pz - 1), // topRight
            same(px + 1, pz + 1), // bottomRight
            same(px - 1, pz + 1), // bottomLeft
        ];
        at.tid = getAutotileTileID(neighbors);
    }

    /** Recompute tileID for autotile at (cx,cz) and its 8 neighbors. */
    private updateAutotileNeighbors(cx: number, cz: number): void {
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                this.recomputeAutotileTid(cx + dx, cz + dz);
            }
        }
    }

    getAutotileEntries(): AutotileEntry[] {
        const entries: AutotileEntry[] = [];
        for (const [key, v] of this.autotiles) {
            const [xs, zs] = key.split(",");
            entries.push({ k: [parseInt(xs), 0, 0, parseInt(zs), 0], v });
        }
        return entries;
    }

    // ── 3D Objects ──

    private makeObj3dKey(x: number, z: number): string {
        return `${x},${z}`;
    }

    placeObject3d(x: number, z: number): void {
        if (x < 0 || x >= this.mapWidth || z < 0 || z >= this.mapDepth) return;
        this.objects3d.set(this.makeObj3dKey(x, z), {
            mesh: this.object3dMesh,
            tex: this.object3dTex,
            rot: [...this.object3dRot] as [number, number, number],
        });
        this.notify();
    }

    eraseObject3d(x: number, z: number): void {
        if (this.objects3d.delete(this.makeObj3dKey(x, z))) {
            this.notify();
        }
    }

    getObject3dEntries(): { x: number; z: number; v: Object3DData }[] {
        const entries: { x: number; z: number; v: Object3DData }[] = [];
        for (const [key, v] of this.objects3d) {
            const [xs, zs] = key.split(",");
            entries.push({ x: parseInt(xs), z: parseInt(zs), v });
        }
        return entries;
    }

    // ── Terrain (height-based system) ──

    /** Place a terrain tile at (x,z) with the current height and texture settings. */
    placeTerrain(x: number, z: number): void {
        const bs = this.terrainBrushSize;
        const half = Math.floor(bs / 2);
        for (let dx = -half; dx < bs - half; dx++) {
            for (let dz = -half; dz < bs - half; dz++) {
                const px = x + dx, pz = z + dz;
                if (px >= 0 && px < this.mapWidth && pz >= 0 && pz < this.mapDepth) {
                    const key = makeTerrainKey(px, pz);
                    this.terrain.set(key, {
                        height: this.terrainHeight,
                        slopeWidth: this.terrainSlopeWidth,
                        t: [this.selectedTile.col, this.selectedTile.row],
                        tex: this.tilesetSrc,
                    });
                    // Remove floor tile at ground level to avoid z-fighting
                    this.floors.delete(makePositionKey(px, 0, 0, pz, 0));
                }
            }
        }
        this.notify();
    }

    /** Remove a terrain tile at (x,z). */
    removeTerrain(x: number, z: number): void {
        const key = makeTerrainKey(x, z);
        if (this.terrain.delete(key)) {
            this.notify();
        }
    }

    /** Get the full terrain map (for the geometry builder). */
    getTerrainMap(): Map<TerrainKey, TerrainTileData> {
        return this.terrain;
    }

    /**
     * Export to RPM-format portion JSON.
     */
    toJSON(): PortionData {
        return {
            lands: {
                floors: this.getFloorEntries(),
            },
            moun: this.getMountainEntries(),
        };
    }

    /**
     * Generate a default map filled with a single tile from the top row.
     */
    generateDefaultMap(tile: SelectedTile = { col: 0, row: 0 }): void {
        this.floors.clear();
        for (let x = 0; x < this.mapWidth; x++) {
            for (let z = 0; z < this.mapDepth; z++) {
                const key = makePositionKey(x, 0, 0, z, 0);
                this.floors.set(key, { t: [tile.col, tile.row], tex: this.tilesetSrc });
            }
        }
        this.notify();
    }
}
