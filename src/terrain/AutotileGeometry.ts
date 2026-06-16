/**
 * AutotileGeometry — builds floor-like quads for autotiles with UVs
 * pointing into the pre-generated autotile atlas.
 *
 * Atlas layout: 64 tiles per row, ceil(625/64) = 10 rows.
 * Each tile is SQUARE_SIZE × SQUARE_SIZE in the atlas.
 */

import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { SQUARE_SIZE, COEF_TEX } from "./Constants";
import { AutotileData } from "../editor/MapEditorState";

const ATLAS_COLS = 64;

export class AutotileGeometryBuilder {
    private vertices: number[] = [];
    private indices: number[] = [];
    private uvs: number[] = [];
    private quadCount = 0;

    /**
     * Add an autotile quad at the given tile position.
     * @param tileX - tile X coordinate
     * @param tileZ - tile Z coordinate
     * @param data - autotile data with tileID
     * @param atlasWidth - atlas texture width in pixels
     * @param atlasHeight - atlas texture height in pixels
     */
    addAutotile(tileX: number, tileZ: number, data: AutotileData, atlasWidth: number, atlasHeight: number): void {
        const tid = data.tid;
        const atlasCol = tid % ATLAS_COLS;
        const atlasRow = Math.floor(tid / ATLAS_COLS);

        const coefX = COEF_TEX / atlasWidth;
        const coefY = COEF_TEX / atlasHeight;

        const u0 = (atlasCol * SQUARE_SIZE) / atlasWidth + coefX;
        const v0 = (atlasRow * SQUARE_SIZE) / atlasHeight + coefY;
        const u1 = ((atlasCol + 1) * SQUARE_SIZE) / atlasWidth - coefX;
        const v1 = ((atlasRow + 1) * SQUARE_SIZE) / atlasHeight - coefY;

        // Invert V for Babylon.js
        const vTop = 1.0 - v0;
        const vBot = 1.0 - v1;

        // Floor quad at y=0.05 (slightly above base floor to avoid z-fighting)
        const x0 = tileX * SQUARE_SIZE;
        const x1 = x0 + SQUARE_SIZE;
        const z0 = tileZ * SQUARE_SIZE;
        const z1 = z0 + SQUARE_SIZE;
        const y = 0.05;

        const base = this.quadCount * 4;
        this.vertices.push(
            x0, y, z0,
            x1, y, z0,
            x1, y, z1,
            x0, y, z1
        );
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        this.uvs.push(
            u0, vTop,
            u1, vTop,
            u1, vBot,
            u0, vBot
        );
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
}
