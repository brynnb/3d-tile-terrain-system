/**
 * TerrainGeometry — builds mesh geometry for the height-based terrain system.
 *
 * Each terrain tile is a flat floor at its height. The builder auto-generates
 * wall/slope faces between tiles at different heights, and fills corners.
 *
 * slopeWidth controls the transition style:
 *   0  = vertical walls between height levels
 *   >0 = angled slopes extending slopeWidth tiles into the higher side
 */

import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { SQUARE_SIZE, COEF_TEX } from "./Constants";

/** Terrain tile data: just a height and texture. */
export interface TerrainTileData {
    /** Height in SQUARE_SIZE units. Negative = below ground, positive = above. */
    height: number;
    /** Slope width in tiles (0 = vertical wall, >0 = angled slope). Stored per-tile. */
    slopeWidth: number;
    /** Floor texture tile coords [col, row] from the tileset. */
    t: number[];
    /** Tileset source path. */
    tex?: string;
}

/** Key for terrain tile: "x,z" */
export type TerrainKey = string;

export function makeTerrainKey(x: number, z: number): TerrainKey {
    return `${x},${z}`;
}

export function parseTerrainKey(key: TerrainKey): [number, number] {
    const parts = key.split(",").map(Number);
    return [parts[0], parts[1]];
}

/**
 * Builds all terrain geometry from a heightmap.
 *
 * Call setHeightmap() with the full terrain data, then build() to get VertexData.
 * The builder generates:
 *   1. Flat floor quads for each terrain tile at its height
 *   2. Edge transition faces (walls or slopes) between different heights
 *   3. Corner fill pieces where 3-4 different heights meet
 */
export class TerrainGeometryBuilder {
    private vertices: number[] = [];
    private indices: number[] = [];
    private uvs: number[] = [];
    private vertCount = 0;

    /** The heightmap: terrain key → tile data. */
    private terrain: Map<TerrainKey, TerrainTileData> = new Map();
    /** Tileset dimensions for UV computation. */
    private texWidth = 128;
    private texHeight = 256;

    /**
     * Configure the builder with terrain data and settings.
     */
    configure(
        terrain: Map<TerrainKey, TerrainTileData>,
        texWidth: number,
        texHeight: number,
    ): void {
        this.terrain = terrain;
        this.texWidth = texWidth;
        this.texHeight = texHeight;
    }

    /** Get the height of a tile. Non-terrain tiles are at height 0 (ground level). */
    private getHeight(x: number, z: number): number {
        const key = makeTerrainKey(x, z);
        const tile = this.terrain.get(key);
        return tile ? tile.height : 0;
    }

    /** Get the slopeWidth for a tile. Non-terrain tiles return 0. */
    private getSlopeWidth(x: number, z: number): number {
        const key = makeTerrainKey(x, z);
        const tile = this.terrain.get(key);
        return tile ? tile.slopeWidth : 0;
    }

    /**
     * For an edge between two tiles, compute the effective slopeWidth.
     * Use max of both sides' slopeWidth.
     */
    private getEdgeSlopeWidth(x1: number, z1: number, x2: number, z2: number): number {
        return Math.max(this.getSlopeWidth(x1, z1), this.getSlopeWidth(x2, z2));
    }

    /** Get the texture coords for a tile (or default [0,0]). */
    private getTexCoords(x: number, z: number): number[] {
        const key = makeTerrainKey(x, z);
        const tile = this.terrain.get(key);
        return tile ? tile.t : [0, 0];
    }

    /**
     * Build all terrain geometry.
     * Returns separate VertexData for floors and walls (walls may use a different texture).
     */
    buildFloors(): VertexData | null {
        this.clear();

        const s = SQUARE_SIZE;

        // Phase 1: Flat floor quads for each terrain tile
        for (const [key, tile] of this.terrain) {
            const [tx, tz] = parseTerrainKey(key);
            const y = tile.height * s;
            const x0 = tx * s;
            const x1 = x0 + s;
            const z0 = tz * s;
            const z1 = z0 + s;

            this.addFloorQuad(x0, y, z0, x1, y, z1, tile.t);
        }

        return this.buildVertexData();
    }

    /**
     * Build wall/slope geometry between height transitions.
     * Returns VertexData for the wall faces.
     */
    buildWalls(): VertexData | null {
        this.clear();

        const s = SQUARE_SIZE;

        // For each terrain tile, check each cardinal edge for height transitions.
        // We also need to check ground-level tiles adjacent to terrain tiles.
        // Strategy: collect all unique edges and process each once.
        const processedEdges = new Set<string>();

        // Collect all x,z positions that matter: terrain tiles + their neighbors
        // Include diagonal neighbors so corner triangles at all 4 pit corners
        // are discovered (each position generates its SE corner).
        const relevantPositions = new Set<string>();
        for (const key of this.terrain.keys()) {
            const [tx, tz] = parseTerrainKey(key);
            relevantPositions.add(key);
            // Cardinal neighbors
            relevantPositions.add(makeTerrainKey(tx - 1, tz));
            relevantPositions.add(makeTerrainKey(tx + 1, tz));
            relevantPositions.add(makeTerrainKey(tx, tz - 1));
            relevantPositions.add(makeTerrainKey(tx, tz + 1));
            // Diagonal neighbors (needed for corner triangle generation)
            relevantPositions.add(makeTerrainKey(tx - 1, tz - 1));
            relevantPositions.add(makeTerrainKey(tx + 1, tz - 1));
            relevantPositions.add(makeTerrainKey(tx - 1, tz + 1));
            relevantPositions.add(makeTerrainKey(tx + 1, tz + 1));
        }

        for (const posKey of relevantPositions) {
            const [tx, tz] = parseTerrainKey(posKey);
            const h = this.getHeight(tx, tz);

            // Check each cardinal neighbor
            const neighbors: [number, number, string][] = [
                [tx + 1, tz, "E"],  // east
                [tx, tz + 1, "S"],  // south
            ];

            for (const [nx, nz, dir] of neighbors) {
                const edgeKey = dir === "E"
                    ? `${tx},${tz}-${nx},${nz}-E`
                    : `${tx},${tz}-${nx},${nz}-S`;
                if (processedEdges.has(edgeKey)) continue;
                processedEdges.add(edgeKey);

                const nh = this.getHeight(nx, nz);
                if (h === nh) continue; // same height, no transition

                const highH = Math.max(h, nh);
                const lowH = Math.min(h, nh);
                const yHigh = highH * s;
                const yLow = lowH * s;
                const sw = this.getEdgeSlopeWidth(tx, tz, nx, nz);

                // Determine which direction the slope extends.
                // Slopes should extend AWAY from the terrain tile, into
                // the ground area. For edges between two terrain tiles,
                // extend toward the lower one.
                const thisIsTerrain = this.terrain.has(makeTerrainKey(tx, tz));
                const neighborIsTerrain = this.terrain.has(makeTerrainKey(nx, nz));
                let slopeTowardNeighbor: boolean;
                if (thisIsTerrain && !neighborIsTerrain) {
                    slopeTowardNeighbor = true;   // away from this terrain tile
                } else if (!thisIsTerrain && neighborIsTerrain) {
                    slopeTowardNeighbor = false;  // away from neighbor terrain tile
                } else {
                    // Both terrain or both ground: extend toward lower side
                    slopeTowardNeighbor = h > nh;
                }

                // yEdge = height at the terrain tile's edge
                // yFar  = height at slopeWidth distance (ground level)
                const yEdge = slopeTowardNeighbor ? h * s : nh * s;
                const yFar = slopeTowardNeighbor ? nh * s : h * s;

                if (dir === "E") {
                    // East edge: x boundary at (tx+1)*s
                    const edgeX = (tx + 1) * s;
                    const edgeZ0 = tz * s;
                    const edgeZ1 = edgeZ0 + s;

                    if (sw === 0) {
                        // Vertical wall — face normal points toward lower side
                        if (h > nh) {
                            this.addWallQuad(
                                edgeX, yHigh, edgeZ0,
                                edgeX, yHigh, edgeZ1,
                                edgeX, yLow, edgeZ1,
                                edgeX, yLow, edgeZ0,
                            );
                        } else {
                            this.addWallQuad(
                                edgeX, yHigh, edgeZ1,
                                edgeX, yHigh, edgeZ0,
                                edgeX, yLow, edgeZ0,
                                edgeX, yLow, edgeZ1,
                            );
                        }
                    } else {
                        const slopeLen = sw * s;
                        const gtx = slopeTowardNeighbor ? nx : tx;
                        const gtz = slopeTowardNeighbor ? nz : tz;
                        // Height at one tile distance: where perpendicular trimmed triangles meet
                        const yMeet = yEdge + (yFar - yEdge) * s / slopeLen;

                        if (slopeTowardNeighbor) {
                            // Slope extends EAST into ground tile (gtx, gtz)
                            const diagN = this.terrain.has(makeTerrainKey(gtx, gtz - 1));
                            const diagS = this.terrain.has(makeTerrainKey(gtx, gtz + 1));
                            if (diagN && diagS) continue;
                            if (diagS) {
                                // Diagonal to south: tip at far NORTH corner
                                this.addWallTriangle(
                                    edgeX, yEdge, edgeZ0,
                                    edgeX, yEdge, edgeZ1,
                                    edgeX + s, yMeet, edgeZ0,
                                );
                            } else if (diagN) {
                                // Diagonal to north: tip at far SOUTH corner
                                this.addWallTriangle(
                                    edgeX, yEdge, edgeZ0,
                                    edgeX, yEdge, edgeZ1,
                                    edgeX + s, yMeet, edgeZ1,
                                );
                            } else {
                                this.addWallQuad(
                                    edgeX, yEdge, edgeZ0,
                                    edgeX, yEdge, edgeZ1,
                                    edgeX + slopeLen, yFar, edgeZ1,
                                    edgeX + slopeLen, yFar, edgeZ0,
                                );
                            }
                        } else {
                            // Slope extends WEST into ground tile (gtx, gtz)
                            const diagN = this.terrain.has(makeTerrainKey(gtx, gtz - 1));
                            const diagS = this.terrain.has(makeTerrainKey(gtx, gtz + 1));
                            if (diagN && diagS) continue;
                            if (diagS) {
                                this.addWallTriangle(
                                    edgeX, yEdge, edgeZ1,
                                    edgeX, yEdge, edgeZ0,
                                    edgeX - s, yMeet, edgeZ0,
                                );
                            } else if (diagN) {
                                this.addWallTriangle(
                                    edgeX, yEdge, edgeZ1,
                                    edgeX, yEdge, edgeZ0,
                                    edgeX - s, yMeet, edgeZ1,
                                );
                            } else {
                                this.addWallQuad(
                                    edgeX, yEdge, edgeZ1,
                                    edgeX, yEdge, edgeZ0,
                                    edgeX - slopeLen, yFar, edgeZ0,
                                    edgeX - slopeLen, yFar, edgeZ1,
                                );
                            }
                        }
                    }
                } else {
                    // South edge: z boundary at (tz+1)*s
                    const edgeZ = (tz + 1) * s;
                    const edgeX0 = tx * s;
                    const edgeX1 = edgeX0 + s;

                    if (sw === 0) {
                        if (h > nh) {
                            this.addWallQuad(
                                edgeX1, yHigh, edgeZ,
                                edgeX0, yHigh, edgeZ,
                                edgeX0, yLow, edgeZ,
                                edgeX1, yLow, edgeZ,
                            );
                        } else {
                            this.addWallQuad(
                                edgeX0, yHigh, edgeZ,
                                edgeX1, yHigh, edgeZ,
                                edgeX1, yLow, edgeZ,
                                edgeX0, yLow, edgeZ,
                            );
                        }
                    } else {
                        const slopeLen = sw * s;
                        const gtx = slopeTowardNeighbor ? nx : tx;
                        const gtz = slopeTowardNeighbor ? nz : tz;
                        const yMeet = yEdge + (yFar - yEdge) * s / slopeLen;

                        if (slopeTowardNeighbor) {
                            // Slope extends SOUTH into ground tile (gtx, gtz)
                            const diagW = this.terrain.has(makeTerrainKey(gtx - 1, gtz));
                            const diagE = this.terrain.has(makeTerrainKey(gtx + 1, gtz));
                            if (diagW && diagE) continue;
                            if (diagE) {
                                this.addWallTriangle(
                                    edgeX1, yEdge, edgeZ,
                                    edgeX0, yEdge, edgeZ,
                                    edgeX0, yMeet, edgeZ + s,
                                );
                            } else if (diagW) {
                                this.addWallTriangle(
                                    edgeX1, yEdge, edgeZ,
                                    edgeX0, yEdge, edgeZ,
                                    edgeX1, yMeet, edgeZ + s,
                                );
                            } else {
                                this.addWallQuad(
                                    edgeX1, yEdge, edgeZ,
                                    edgeX0, yEdge, edgeZ,
                                    edgeX0, yFar, edgeZ + slopeLen,
                                    edgeX1, yFar, edgeZ + slopeLen,
                                );
                            }
                        } else {
                            // Slope extends NORTH into ground tile (gtx, gtz)
                            const diagW = this.terrain.has(makeTerrainKey(gtx - 1, gtz));
                            const diagE = this.terrain.has(makeTerrainKey(gtx + 1, gtz));
                            if (diagW && diagE) continue;
                            if (diagE) {
                                this.addWallTriangle(
                                    edgeX0, yEdge, edgeZ,
                                    edgeX1, yEdge, edgeZ,
                                    edgeX0, yMeet, edgeZ - s,
                                );
                            } else if (diagW) {
                                this.addWallTriangle(
                                    edgeX0, yEdge, edgeZ,
                                    edgeX1, yEdge, edgeZ,
                                    edgeX1, yMeet, edgeZ - s,
                                );
                            } else {
                                this.addWallQuad(
                                    edgeX0, yEdge, edgeZ,
                                    edgeX1, yEdge, edgeZ,
                                    edgeX1, yFar, edgeZ - slopeLen,
                                    edgeX0, yFar, edgeZ - slopeLen,
                                );
                            }
                        }
                    }
                }
            }
        }

        // Phase 2: Corner fill pieces
        // At each grid corner (intersection of 4 tiles), if not all at the same
        // height, we may need a triangular fill piece.
        const processedCorners = new Set<string>();
        for (const posKey of relevantPositions) {
            const [tx, tz] = parseTerrainKey(posKey);
            // Each position contributes to the corner at its SE (tx+1, tz+1)
            const cornerKey = `${tx + 1},${tz + 1}`;
            if (processedCorners.has(cornerKey)) continue;
            processedCorners.add(cornerKey);

            // Four tiles sharing this corner
            const hNW = this.getHeight(tx, tz);      // NW
            const hNE = this.getHeight(tx + 1, tz);  // NE
            const hSW = this.getHeight(tx, tz + 1);  // SW
            const hSE = this.getHeight(tx + 1, tz + 1); // SE

            // If all same, nothing to do
            if (hNW === hNE && hNE === hSW && hSW === hSE) continue;

            const cx = (tx + 1) * s;  // corner world X
            const cz = (tz + 1) * s;  // corner world Z

            // Compute max slopeWidth of the 4 tiles at this corner
            const cornerSW = Math.max(
                this.getSlopeWidth(tx, tz),
                this.getSlopeWidth(tx + 1, tz),
                this.getSlopeWidth(tx, tz + 1),
                this.getSlopeWidth(tx + 1, tz + 1),
            );

            if (cornerSW === 0) {
                // Vertical corner fills: triangles connecting the wall edges
                // For V1 with vertical walls, the walls meet cleanly at corners
                // in most cases. Skip complex corner fills for now.
            } else {
                // Slope corners: fill the diagonal gap between two perpendicular slopes.
                const slopeLen = cornerSW * s;
                const heights = [
                    { h: hNW, dx: -1, dz: -1 },
                    { h: hNE, dx: 1, dz: -1 },
                    { h: hSW, dx: -1, dz: 1 },
                    { h: hSE, dx: 1, dz: 1 },
                ];

                // Find the highest and check if corner needs a fill
                const maxH = Math.max(hNW, hNE, hSW, hSE);
                const minH = Math.min(hNW, hNE, hSW, hSE);
                if (maxH === minH) continue;

                const yMax = maxH * s;
                const yMin = minH * s;

                const atMax = heights.filter(h => h.h === maxH);
                const atMin = heights.filter(h => h.h === minH);

                if (atMin.length === 1) {
                    const low = atMin[0];
                    // Check if either cardinal neighbor at this corner is also
                    // at minH — if so, the adjacent slopes are trimmed and the
                    // corner fill should only extend one tile (s) at yMeet to
                    // match. If neither cardinal is at minH (isolated corner),
                    // extend full slopeLen so the fill reaches ground level.
                    const cardX = heights.find(h => h.dx === low.dx && h.dz !== low.dz);
                    const cardZ = heights.find(h => h.dz === low.dz && h.dx !== low.dx);
                    const trimmed = (cardX && cardX.h === minH) || (cardZ && cardZ.h === minH);
                    const tipDist = trimmed ? s : slopeLen;
                    const yTip = trimmed
                        ? yMin + (yMax - yMin) * s / slopeLen
                        : yMax;
                    const tipX = cx - low.dx * tipDist;
                    const tipZ = cz - low.dz * tipDist;
                    if (low.dx * low.dz > 0) {
                        this.addCornerTriangle(
                            cx, yTip, cz,
                            cx, yTip, tipZ,
                            tipX, yTip, cz,
                            yMin,
                        );
                    } else {
                        this.addCornerTriangle(
                            cx, yTip, cz,
                            tipX, yTip, cz,
                            cx, yTip, tipZ,
                            yMin,
                        );
                    }
                } else if (atMax.length === 1) {
                    const high = atMax[0];
                    // Skip when outlier is adjacent to corner (not diagonal NW tile).
                    // Adjacent tiles' slopes cover the corner area via trimmed triangles.
                    const isDiagonal = (high.dx === -1 && high.dz === -1);
                    if (isDiagonal) {
                        const cardX = heights.find(h => h.dx === high.dx && h.dz !== high.dz);
                        const cardZ = heights.find(h => h.dz === high.dz && h.dx !== high.dx);
                        const trimmed = (cardX && cardX.h === maxH) || (cardZ && cardZ.h === maxH);
                        const tipDist = trimmed ? s : slopeLen;
                        const yTip = trimmed
                            ? yMax + (yMin - yMax) * s / slopeLen
                            : yMin;
                        const tipX = cx - high.dx * tipDist;
                        const tipZ = cz - high.dz * tipDist;
                        if (high.dx * high.dz > 0) {
                            this.addCornerTriangle(
                                cx, yTip, cz,
                                cx, yTip, tipZ,
                                tipX, yTip, cz,
                                yMax,
                            );
                        } else {
                            this.addCornerTriangle(
                                cx, yTip, cz,
                                tipX, yTip, cz,
                                cx, yTip, tipZ,
                                yMax,
                            );
                        }
                    }
                }
            }
        }

        return this.buildVertexData();
    }

    // ── Primitive helpers ──

    /** Add a flat floor quad at the given position with texture from tileset. */
    private addFloorQuad(
        x0: number, y: number, z0: number,
        x1: number, _y: number, z1: number,
        texCoords: number[],
    ): void {
        const texCol = texCoords[0];
        const texRow = texCoords[1];

        const coefX = COEF_TEX / this.texWidth;
        const coefY = COEF_TEX / this.texHeight;
        const u = (texCol * SQUARE_SIZE) / this.texWidth + coefX;
        const w = SQUARE_SIZE / this.texWidth - coefX * 2;
        const h = SQUARE_SIZE / this.texHeight - coefY * 2;
        const v = 1.0 - (texRow * SQUARE_SIZE) / this.texHeight - SQUARE_SIZE / this.texHeight + coefY;

        const base = this.vertCount;
        // A=NW, B=NE, C=SE, D=SW
        this.vertices.push(
            x0, y, z0,  // A
            x1, y, z0,  // B
            x1, y, z1,  // C
            x0, y, z1,  // D
        );
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        this.uvs.push(
            u, v + h,       // A
            u + w, v + h,   // B
            u + w, v,       // C
            u, v,           // D
        );
        this.vertCount += 4;
    }

    /** Add a wall quad (4 vertices, 2 triangles). Winding determines face direction. */
    private addWallQuad(
        x0: number, y0: number, z0: number,  // top-left
        x1: number, y1: number, z1: number,  // top-right
        x2: number, y2: number, z2: number,  // bottom-right
        x3: number, y3: number, z3: number,  // bottom-left
    ): void {
        const base = this.vertCount;
        this.vertices.push(
            x0, y0, z0,
            x1, y1, z1,
            x2, y2, z2,
            x3, y3, z3,
        );
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        // Simple UV mapping: stretch across the quad
        // U: 0→1 across width, V: 0→1 across height
        this.uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
        this.vertCount += 4;
    }

    /** Add a wall triangle (3 vertices, 1 triangle). */
    private addWallTriangle(
        x0: number, y0: number, z0: number,
        x1: number, y1: number, z1: number,
        x2: number, y2: number, z2: number,
    ): void {
        const base = this.vertCount;
        this.vertices.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);
        this.indices.push(base, base + 1, base + 2);
        this.uvs.push(0, 1, 1, 1, 0.5, 0);
        this.vertCount += 3;
    }

    /** Add a corner fill triangle. */
    private addCornerTriangle(
        cx: number, _cy: number, cz: number,
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        yLow: number,
    ): void {
        const base = this.vertCount;
        this.vertices.push(
            cx, yLow, cz,  // corner point at low height
            ax, ay, az,      // slope tip A
            bx, by, bz,     // slope tip B
        );
        this.indices.push(base, base + 1, base + 2);
        this.uvs.push(0.5, 0, 0, 1, 1, 1);
        this.vertCount += 3;
    }

    /** Build VertexData from accumulated geometry. */
    private buildVertexData(): VertexData | null {
        if (this.vertCount === 0) return null;

        const vertexData = new VertexData();
        vertexData.positions = new Float32Array(this.vertices);
        vertexData.indices = new Uint32Array(this.indices);
        vertexData.uvs = new Float32Array(this.uvs);

        const normals: number[] = [];
        VertexData.ComputeNormals(
            vertexData.positions,
            vertexData.indices,
            normals,
        );
        vertexData.normals = new Float32Array(normals);

        return vertexData;
    }

    /** Reset state for reuse. */
    private clear(): void {
        this.vertices = [];
        this.indices = [];
        this.uvs = [];
        this.vertCount = 0;
    }
}
