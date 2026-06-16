/**
 * Sprite geometry builder.
 *
 * Sprites are vertical billboards in the map. Types:
 *   - Fix: placed at tile center, stays in place
 *   - Double: two sprites at 90° to each other (pop-up book look)
 *   - Quadra: four sprites at 0°, 90°, 45°, -45°
 *   - Face: always faces the camera (handled at render time, not geometry)
 *
 * Sprite MODEL is a unit quad: A(-0.5,1,0), B(0.5,1,0), C(0.5,0,0), D(-0.5,0,0)
 * Scaled by (texW * SQUARE_SIZE, texH * SQUARE_SIZE, 1) then positioned.
 *
 * Differences from RPM/THREE.js:
 *   - Babylon.js is left-handed; we negate Y-axis rotation angles.
 *   - Babylon.js invertY=true; we invert V coordinates.
 */

import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { SQUARE_SIZE, COEF_TEX } from "./Constants";

export type SpriteKind = "face" | "fix" | "double" | "quadra";

export interface SpriteData {
    /** Texture rect: [col, row, widthInTiles, heightInTiles] */
    t: number[];
    /** Sprite kind */
    k: SpriteKind;
    /** Tileset source path (each sprite remembers its tileset) */
    tex?: string;
}

function rotateY(px: number, py: number, pz: number,
    cx: number, cy: number, cz: number, angleDeg: number): [number, number, number] {
    const rad = -angleDeg * Math.PI / 180; // negate for LH
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = px - cx;
    const dz = pz - cz;
    return [cx + dx * cos - dz * sin, py, cz + dx * sin + dz * cos];
}

export class SpriteGeometryBuilder {
    private vertices: number[] = [];
    private indices: number[] = [];
    private uvs: number[] = [];
    private quadCount = 0;

    addSprite(
        tileX: number, tileY: number, tileZ: number,
        sprite: SpriteData,
        texWidth: number, texHeight: number,
        layer: number = 0
    ): void {
        const [col, row, tw, th] = sprite.t;
        const sizeX = tw * SQUARE_SIZE;
        const sizeY = th * SQUARE_SIZE;

        // Local position (center of tile)
        const lx = tileX * SQUARE_SIZE + SQUARE_SIZE / 2;
        const ly = tileY * SQUARE_SIZE;
        const lz = tileZ * SQUARE_SIZE + SQUARE_SIZE / 2;

        // Layer offset (RPM uses z offset for sprites, we use z offset in the
        // sprite's local frame which becomes different world axes after rotation)
        const layerOffset = layer * 0.05;

        // UV coordinates
        const coefX = COEF_TEX / texWidth;
        const coefY = COEF_TEX / texHeight;
        const u = (col * SQUARE_SIZE) / texWidth + coefX;
        const v = (row * SQUARE_SIZE) / texHeight + coefY;
        const w = (tw * SQUARE_SIZE) / texWidth - coefX * 2;
        const h = (th * SQUARE_SIZE) / texHeight - coefY * 2;

        // Invert V for Babylon.js invertY
        const v0 = 1.0 - v;
        const v1 = 1.0 - (v + h);

        // MODEL: A(-0.5,1,0), B(0.5,1,0), C(0.5,0,0), D(-0.5,0,0)
        // Scaled by (sizeX, sizeY, 1) then offset to local position
        const ax0 = -sizeX / 2 + lx;
        const bx0 = sizeX / 2 + lx;
        const ay0 = sizeY + ly;
        const by0 = ly;

        // Fix sprite: one quad at angle 0
        this.pushQuad(
            ax0, ay0, lz + layerOffset,
            bx0, ay0, lz + layerOffset,
            bx0, by0, lz + layerOffset,
            ax0, by0, lz + layerOffset,
            u, v0, u + w, v1
        );

        if (sprite.k === "double" || sprite.k === "quadra") {
            // Second quad rotated 90° around center
            const cx = lx, cy = ly + sizeY / 2, cz = lz;
            const [ax1, ay1, az1] = rotateY(ax0, ay0, lz + layerOffset, cx, cy, cz, 90);
            const [bx1, by1, bz1] = rotateY(bx0, ay0, lz + layerOffset, cx, cy, cz, 90);
            const [cx1, cy1, cz1] = rotateY(bx0, by0, lz + layerOffset, cx, cy, cz, 90);
            const [dx1, dy1, dz1] = rotateY(ax0, by0, lz + layerOffset, cx, cy, cz, 90);
            this.pushQuad(ax1, ay1, az1, bx1, by1, bz1, cx1, cy1, cz1, dx1, dy1, dz1,
                u, v0, u + w, v1);

            if (sprite.k === "quadra") {
                // Third quad rotated 45°
                const [ax2, ay2, az2] = rotateY(ax0, ay0, lz + layerOffset, cx, cy, cz, 45);
                const [bx2, by2, bz2] = rotateY(bx0, ay0, lz + layerOffset, cx, cy, cz, 45);
                const [cx2, cy2, cz2] = rotateY(bx0, by0, lz + layerOffset, cx, cy, cz, 45);
                const [dx2, dy2, dz2] = rotateY(ax0, by0, lz + layerOffset, cx, cy, cz, 45);
                this.pushQuad(ax2, ay2, az2, bx2, by2, bz2, cx2, cy2, cz2, dx2, dy2, dz2,
                    u, v0, u + w, v1);

                // Fourth quad rotated -45°
                const [ax3, ay3, az3] = rotateY(ax0, ay0, lz + layerOffset, cx, cy, cz, -45);
                const [bx3, by3, bz3] = rotateY(bx0, ay0, lz + layerOffset, cx, cy, cz, -45);
                const [cx3, cy3, cz3] = rotateY(bx0, by0, lz + layerOffset, cx, cy, cz, -45);
                const [dx3, dy3, dz3] = rotateY(ax0, by0, lz + layerOffset, cx, cy, cz, -45);
                this.pushQuad(ax3, ay3, az3, bx3, by3, bz3, cx3, cy3, cz3, dx3, dy3, dz3,
                    u, v0, u + w, v1);
            }
        }
    }

    private pushQuad(
        ax: number, ay: number, az: number,
        bx: number, by: number, bz: number,
        cx: number, cy: number, cz: number,
        dx: number, dy: number, dz: number,
        u0: number, v0: number, u1: number, v1: number
    ): void {
        const base = this.quadCount * 4;
        this.vertices.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        this.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
        this.quadCount++;
    }

    build(): VertexData | null {
        if (this.quadCount === 0) return null;
        const vertexData = new VertexData();
        vertexData.positions = new Float32Array(this.vertices);
        vertexData.indices = new Uint32Array(this.indices);
        vertexData.uvs = new Float32Array(this.uvs);
        const normals: number[] = [];
        VertexData.ComputeNormals(vertexData.positions, vertexData.indices, normals);
        vertexData.normals = new Float32Array(normals);
        return vertexData;
    }

    clear(): void {
        this.vertices = [];
        this.indices = [];
        this.uvs = [];
        this.quadCount = 0;
    }
}
