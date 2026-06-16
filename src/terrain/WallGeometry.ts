/**
 * Wall sprite geometry builder.
 *
 * Wall sprites are vertical quads placed on the edges of squares.
 * They use a separate wall texture (not the tileset).
 * The wall texture has 4 columns: Left, Middle, Right, LeftRight (auto-tile style).
 * Height = full texture height (each column is 1 tile wide, N tiles tall).
 *
 * Wall placement: walls sit on the edge between two tiles, oriented by angleY.
 *   - 0°   = south edge (front, +Z face)
 *   - 90°  = east edge (+X face)
 *   - 180° = north edge (-Z face)
 *   - 270° = west edge (-X face)
 *
 * Differences from RPM/THREE.js:
 *   - Babylon.js is left-handed; we negate Y-axis rotation angles.
 *   - Babylon.js invertY=true; we invert V coordinates.
 */

import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { SQUARE_SIZE, COEF_TEX } from "./Constants";

/** Which edge of the tile the wall sits on */
export type WallEdge = "south" | "east" | "north" | "west";

export interface WallData {
    /** Wall texture column kind (0=left, 1=middle, 2=right) */
    k: number;
    /** Wall edge */
    edge: WallEdge;
    /** Wall texture source path (each wall remembers its texture) */
    tex?: string;
    /** If true, wall is rendered as a 3D box (1 tile thick) */
    is3d?: boolean;
}

function edgeToAngle(edge: WallEdge): number {
    switch (edge) {
        case "south": return 0;
        case "east": return 90;
        case "north": return 180;
        case "west": return 270;
    }
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

export class WallGeometryBuilder {
    private vertices: number[] = [];
    private indices: number[] = [];
    private uvs: number[] = [];
    private quadCount = 0;

    /**
     * Add a wall sprite at a tile position on a specific edge.
     * texWidth/texHeight = wall texture dimensions.
     * wallHeightTiles = how many tiles tall the wall texture is (texHeight / SQUARE_SIZE).
     */
    addWall(
        tileX: number, tileY: number, tileZ: number,
        wall: WallData,
        texWidth: number, texHeight: number
    ): void {
        const wallHeightTiles = Math.floor(texHeight / SQUARE_SIZE);
        const wallHeightPx = wallHeightTiles * SQUARE_SIZE;
        const angle = edgeToAngle(wall.edge);

        // Center of tile
        const cx = tileX * SQUARE_SIZE + SQUARE_SIZE / 2;
        const cy = tileY * SQUARE_SIZE;
        const cz = tileZ * SQUARE_SIZE + SQUARE_SIZE / 2;

        // Wall quad before rotation: centered on south edge of tile
        // A=topLeft, B=topRight, C=botRight, D=botLeft
        const halfW = SQUARE_SIZE / 2;
        let ax = cx - halfW, ay = cy + wallHeightPx, az = cz + halfW;
        let bx = cx + halfW, by = cy + wallHeightPx, bz = cz + halfW;
        let cxx = cx + halfW, cyy = cy, czz = cz + halfW;
        let dx = cx - halfW, dy = cy, dz = cz + halfW;

        // Rotate around tile center
        if (angle !== 0) {
            [ax, ay, az] = rotateY(ax, ay, az, cx, cy + wallHeightPx / 2, cz, angle);
            [bx, by, bz] = rotateY(bx, by, bz, cx, cy + wallHeightPx / 2, cz, angle);
            [cxx, cyy, czz] = rotateY(cxx, cyy, czz, cx, cy + wallHeightPx / 2, cz, angle);
            [dx, dy, dz] = rotateY(dx, dy, dz, cx, cy + wallHeightPx / 2, cz, angle);
        }

        // UV coordinates
        const coefX = COEF_TEX / texWidth;
        const coefY = COEF_TEX / texHeight;
        const u0 = (wall.k * SQUARE_SIZE) / texWidth + coefX;
        const u1 = ((wall.k + 1) * SQUARE_SIZE) / texWidth - coefX;
        // Full height of texture
        const v0 = 1.0 - coefY;       // top (inverted for Babylon invertY)
        const v1 = coefY;             // bottom

        const base = this.quadCount * 4;
        this.vertices.push(
            ax, ay, az,
            bx, by, bz,
            cxx, cyy, czz,
            dx, dy, dz
        );
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        this.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
        this.quadCount++;
    }

    /**
     * Add a 3D wall box at a tile position. The box is 1 tile wide along the edge,
     * 1 tile deep perpendicular to the edge, and wallHeight tall.
     * Side faces use the wall texture column. Top/bottom use a cropped square from the same column.
     */
    addWall3D(
        tileX: number, tileY: number, tileZ: number,
        wall: WallData,
        texWidth: number, texHeight: number
    ): void {
        const wallHeightTiles = Math.floor(texHeight / SQUARE_SIZE);
        const wallHeightPx = wallHeightTiles * SQUARE_SIZE;
        const angle = edgeToAngle(wall.edge);

        const cx = tileX * SQUARE_SIZE + SQUARE_SIZE / 2;
        const cy = tileY * SQUARE_SIZE;
        const cz = tileZ * SQUARE_SIZE + SQUARE_SIZE / 2;

        const halfW = SQUARE_SIZE / 2;
        const depth = SQUARE_SIZE; // 1 tile thick

        // UV for side faces (same as 2D wall)
        const coefX = COEF_TEX / texWidth;
        const coefY = COEF_TEX / texHeight;
        const sideU0 = (wall.k * SQUARE_SIZE) / texWidth + coefX;
        const sideU1 = ((wall.k + 1) * SQUARE_SIZE) / texWidth - coefX;
        const sideVTop = 1.0 - coefY;
        const sideVBot = coefY;

        // UV for top/bottom — crop a SQUARE_SIZE×SQUARE_SIZE region from column k, center of texture
        const capU0 = sideU0;
        const capU1 = sideU1;
        const centerV = 0.5; // vertical center of texture
        const halfCapV = (SQUARE_SIZE / texHeight) / 2;
        const capV0 = centerV + halfCapV - coefY; // top of cap region
        const capV1 = centerV - halfCapV + coefY; // bottom of cap region

        // 8 corners of the box before rotation:
        // Front face (south): z = cz + halfW
        // Back face: z = cz + halfW - depth
        const yBot = cy;
        const yTop = cy + wallHeightPx;
        const z0 = cz + halfW; // front
        const z1 = z0 - depth; // back
        const x0 = cx - halfW; // left
        const x1 = cx + halfW; // right

        // Helper: add a quad with 4 corners
        const addQuad = (
            p0: [number, number, number], p1: [number, number, number],
            p2: [number, number, number], p3: [number, number, number],
            u0: number, v0: number, u1: number, v1: number
        ) => {
            let [ax, ay, az] = p0;
            let [bx, by, bz] = p1;
            let [cxx, cyy, czz] = p2;
            let [dx, dy, dz] = p3;
            if (angle !== 0) {
                const rcy = (yBot + yTop) / 2;
                [ax, ay, az] = rotateY(ax, ay, az, cx, rcy, cz, angle);
                [bx, by, bz] = rotateY(bx, by, bz, cx, rcy, cz, angle);
                [cxx, cyy, czz] = rotateY(cxx, cyy, czz, cx, rcy, cz, angle);
                [dx, dy, dz] = rotateY(dx, dy, dz, cx, rcy, cz, angle);
            }
            const base = this.quadCount * 4;
            this.vertices.push(ax, ay, az, bx, by, bz, cxx, cyy, czz, dx, dy, dz);
            this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
            this.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
            this.quadCount++;
        };

        // Front face (south, visible from +Z)
        addQuad([x0, yTop, z0], [x1, yTop, z0], [x1, yBot, z0], [x0, yBot, z0],
            sideU0, sideVTop, sideU1, sideVBot);
        // Back face (north, visible from -Z)
        addQuad([x1, yTop, z1], [x0, yTop, z1], [x0, yBot, z1], [x1, yBot, z1],
            sideU0, sideVTop, sideU1, sideVBot);
        // Left face (west, visible from -X)
        addQuad([x0, yTop, z1], [x0, yTop, z0], [x0, yBot, z0], [x0, yBot, z1],
            sideU0, sideVTop, sideU1, sideVBot);
        // Right face (east, visible from +X)
        addQuad([x1, yTop, z0], [x1, yTop, z1], [x1, yBot, z1], [x1, yBot, z0],
            sideU0, sideVTop, sideU1, sideVBot);
        // Top face
        addQuad([x0, yTop, z1], [x1, yTop, z1], [x1, yTop, z0], [x0, yTop, z0],
            capU0, capV0, capU1, capV1);
        // Bottom face
        addQuad([x0, yBot, z0], [x1, yBot, z0], [x1, yBot, z1], [x0, yBot, z1],
            capU0, capV0, capU1, capV1);
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
