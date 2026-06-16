/**
 * Floor geometry builder.
 *
 * Builds batched quad geometry for all floor tiles in a portion.
 * Each floor tile is a flat horizontal quad at its tile position,
 * textured from a UV rect in the tileset.
 */

import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { SQUARE_SIZE, COEF_TEX } from "./Constants";
import { Position } from "./Position";

/** Raw floor data from RPM JSON: { t: [texX, texY, texW?, texH?], up?: boolean } */
export interface FloorData {
    t: number[];   // texture rect in tileset grid: [col, row] or [col, row, width, height]
    up?: boolean;
    /** Tileset source path (each tile remembers its tileset) */
    tex?: string;
}

/**
 * Accumulates floor quads into flat arrays, then produces a Babylon VertexData.
 */
export class FloorGeometryBuilder {
    private vertices: number[] = [];
    private indices: number[] = [];
    private uvs: number[] = [];
    private quadCount = 0;

    /**
     * Diagonal cut flags for floor tiles adjacent to inverted mountain pits.
     * Each flag indicates an inverted mountain is on that side.
     */
    static CUT_NONE  = 0;
    static CUT_TOP   = 1;  // pit at z-1 (north)
    static CUT_BOT   = 2;  // pit at z+1 (south)
    static CUT_LEFT  = 4;  // pit at x-1 (west)
    static CUT_RIGHT = 8;  // pit at x+1 (east)

    /**
     * Add a floor tile quad, optionally with diagonal cuts for adjacent pits.
     * @param position  Tile position (from RPM JSON key array)
     * @param floor     Floor value data (texture rect, orientation)
     * @param texWidth  Tileset image width in pixels
     * @param texHeight Tileset image height in pixels
     * @param cutFlags  Bitmask of CUT_* flags for diagonal cutting (default 0 = no cut)
     */
    addFloor(position: Position, floor: FloorData, texWidth: number, texHeight: number, cutFlags = 0): void {
        const texture = floor.t;
        // Normalize texture array — short form [col, row] implies 1×1 tile
        const texCol = texture[0];
        const texRow = texture[1];
        const texW = texture[2] ?? 1;
        const texH = texture[3] ?? 1;

        const up = floor.up !== false; // default true

        // World-space position of tile corner (no center offset for floors)
        const localPos = position.toVector3(false);
        const a = localPos.x;
        const b = localPos.y;
        const c = localPos.z;

        // UV coordinates — map from tileset grid to normalized [0,1]
        // Apply small inset (COEF_TEX) to prevent bleeding
        const coefX = COEF_TEX / texWidth;
        const coefY = COEF_TEX / texHeight;
        const u = (texCol * SQUARE_SIZE) / texWidth + coefX;
        const w = (texW * SQUARE_SIZE) / texWidth - coefX * 2;
        const h = (texH * SQUARE_SIZE) / texHeight - coefY * 2;
        // Babylon.js invertY flips the texture so V=0 is at the bottom of the
        // original image. Invert V so palette row 0 (visual top) maps correctly.
        const v = 1.0 - (texRow * SQUARE_SIZE) / texHeight - (texH * SQUARE_SIZE) / texHeight + coefY;

        // Four corners of the floor quad (flat on XZ plane)
        // RPM winding: A(x,z) B(x+s,z) C(x+s,z+s) D(x,z+s)
        //   A --- B     A = top-left (x, z)
        //   |     |     B = top-right (x+s, z)
        //   D --- C     C = bottom-right (x+s, z+s)
        //                D = bottom-left (x, z+s)
        const s = SQUARE_SIZE;
        const ax = a,     ay = b, az = c;        // A
        const bx = a + s, by = b, bz = c;        // B
        const cx = a + s, cy = b, cz = c + s;    // C
        const dx = a,     dy = b, dz = c + s;    // D

        const uA = u,     vA = v + h;   // A
        const uB = u + w, vB = v + h;   // B
        const uC = u + w, vC = v;       // C
        const uD = u,     vD = v;       // D

        if (cutFlags === 0) {
            // Normal full quad — two triangles: ABC, ACD
            const base = this.quadCount * 4;
            this.vertices.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
            this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            this.uvs.push(uA, vA, uB, vB, uC, vC, uD, vD);
            this.quadCount++;
        } else {
            // Diagonal cut: emit only the triangle(s) that don't face the pit.
            // Standard quad is ABC + ACD. When cutting:
            //   CUT_BOT (pit at z+1): remove triangle ACD (bottom), keep ABC (top)
            //   CUT_TOP (pit at z-1): remove triangle ABC (top), keep ACD (bottom)
            //   CUT_RIGHT (pit at x+1): diagonal BD — keep ABD (left), remove BCD (right)
            //   CUT_LEFT (pit at x-1): diagonal BD — keep BCD (right), remove ABD (left)
            // For multiple flags, we keep only the safe corner(s).
            const CUT_TOP = FloorGeometryBuilder.CUT_TOP;
            const CUT_BOT = FloorGeometryBuilder.CUT_BOT;
            const CUT_LEFT = FloorGeometryBuilder.CUT_LEFT;
            const CUT_RIGHT = FloorGeometryBuilder.CUT_RIGHT;

            //   A(NW)---B(NE)      Diagonal AC: triangles ABC(NE) + ACD(SW)
            //   |       |         Diagonal BD: triangles ABD(NW) + BCD(SE)
            //   D(SW)---C(SE)
            //
            // Single-side cuts — keep the half away from the pit:
            if (cutFlags === CUT_BOT) {
                // Pit south: diagonal A→C, keep north triangle ABx = ABC
                this.addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz, uA, vA, uB, vB, uC, vC);
            } else if (cutFlags === CUT_TOP) {
                // Pit north: diagonal A→C, keep south triangle = ACD
                // (diagonal runs NW→SE, south half is below it)
                this.addTriangle(ax, ay, az, cx, cy, cz, dx, dy, dz, uA, vA, uC, vC, uD, vD);
            } else if (cutFlags === CUT_RIGHT) {
                // Pit east: diagonal B→D, keep west triangle = ABD
                this.addTriangle(ax, ay, az, bx, by, bz, dx, dy, dz, uA, vA, uB, vB, uD, vD);
            } else if (cutFlags === CUT_LEFT) {
                // Pit west: diagonal B→D, keep east triangle = BCD
                this.addTriangle(bx, by, bz, cx, cy, cz, dx, dy, dz, uB, vB, uC, vC, uD, vD);
            } else if (cutFlags === (CUT_BOT | CUT_RIGHT)) {
                // Pits south+east: keep only corner A (NW). Triangle = ABD
                this.addTriangle(ax, ay, az, bx, by, bz, dx, dy, dz, uA, vA, uB, vB, uD, vD);
            } else if (cutFlags === (CUT_BOT | CUT_LEFT)) {
                // Pits south+west: keep only corner B (NE). Triangle = ABC
                this.addTriangle(ax, ay, az, bx, by, bz, cx, cy, cz, uA, vA, uB, vB, uC, vC);
            } else if (cutFlags === (CUT_TOP | CUT_RIGHT)) {
                // Pits north+east: keep only corner D (SW). Triangle = ACD
                this.addTriangle(ax, ay, az, cx, cy, cz, dx, dy, dz, uA, vA, uC, vC, uD, vD);
            } else if (cutFlags === (CUT_TOP | CUT_LEFT)) {
                // Pits north+west: keep only corner C (SE). Triangle = BCD
                this.addTriangle(bx, by, bz, cx, cy, cz, dx, dy, dz, uB, vB, uC, vC, uD, vD);
            }
            // 3+ sides with pits: tile is surrounded, omit entirely (no geometry emitted)
        }
    }

    /** Helper: push a single triangle (3 verts, 3 UVs, 1 face). */
    private addTriangle(
        x0: number, y0: number, z0: number,
        x1: number, y1: number, z1: number,
        x2: number, y2: number, z2: number,
        u0: number, v0: number,
        u1: number, v1: number,
        u2: number, v2: number,
    ): void {
        // We still allocate 4 verts per "quad slot" for consistent indexing,
        // but only use 3. Duplicate the third vertex to fill the slot.
        const base = this.quadCount * 4;
        this.vertices.push(x0, y0, z0, x1, y1, z1, x2, y2, z2, x2, y2, z2);
        this.indices.push(base, base + 1, base + 2); // single triangle
        this.uvs.push(u0, v0, u1, v1, u2, v2, u2, v2);
        this.quadCount++;
    }

    /** Build final Babylon.js VertexData from accumulated quads. */
    build(): VertexData | null {
        if (this.quadCount === 0) return null;

        const vertexData = new VertexData();
        vertexData.positions = new Float32Array(this.vertices);
        vertexData.indices = new Uint32Array(this.indices);
        vertexData.uvs = new Float32Array(this.uvs);

        // Compute normals (all floors face up, but let Babylon compute for correctness)
        const normals: number[] = [];
        VertexData.ComputeNormals(
            vertexData.positions,
            vertexData.indices,
            normals
        );
        vertexData.normals = new Float32Array(normals);

        return vertexData;
    }

    /** Reset for reuse. */
    clear(): void {
        this.vertices = [];
        this.indices = [];
        this.uvs = [];
        this.quadCount = 0;
    }
}
