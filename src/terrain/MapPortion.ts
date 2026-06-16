/**
 * MapPortion — reads a portion JSON and builds floor geometry.
 */

import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scene } from "@babylonjs/core/scene";

import { Position } from "./Position";
import { FloorGeometryBuilder, FloorData } from "./FloorGeometry";

/** Shape of RPM portion JSON (only the parts we use so far). */
export interface PortionJSON {
    lands?: {
        floors?: Array<{ k: number[]; v: FloorData }>;
        autotiles?: unknown[];
    };
    sprites?: unknown;
    moun?: unknown;
    objs3d?: unknown;
    objs?: unknown;
}

/**
 * Read portion JSON and create a Babylon mesh for the floor tiles.
 */
export function createFloorMeshFromPortion(
    json: PortionJSON,
    tilesetMaterial: StandardMaterial,
    texWidth: number,
    texHeight: number,
    scene: Scene
): Mesh | null {
    const floors = json.lands?.floors;
    if (!floors || floors.length === 0) return null;

    const builder = new FloorGeometryBuilder();

    for (const entry of floors) {
        const position = Position.createFromArray(entry.k);
        builder.addFloor(position, entry.v, texWidth, texHeight);
    }

    const vertexData = builder.build();
    if (!vertexData) return null;

    const mesh = new Mesh("floors", scene);
    vertexData.applyToMesh(mesh);
    mesh.material = tilesetMaterial;
    return mesh;
}
