/**
 * Lightweight OBJ parser — parses vertices, UVs, normals, and faces from .obj text.
 * Returns Babylon.js-compatible arrays for VertexData.
 */

import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";

export function parseOBJ(objText: string): VertexData | null {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    const rawV: number[][] = [];
    const rawVt: number[][] = [];
    const rawVn: number[][] = [];
    const indices: number[] = [];

    // Map of "v/vt/vn" → vertex index
    const vertexMap = new Map<string, number>();
    let nextIdx = 0;

    for (const line of objText.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("v ")) {
            const parts = trimmed.split(/\s+/);
            rawV.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        } else if (trimmed.startsWith("vt ")) {
            const parts = trimmed.split(/\s+/);
            rawVt.push([parseFloat(parts[1]), parseFloat(parts[2])]);
        } else if (trimmed.startsWith("vn ")) {
            const parts = trimmed.split(/\s+/);
            rawVn.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        } else if (trimmed.startsWith("f ")) {
            const parts = trimmed.split(/\s+/).slice(1);
            // Triangulate polygon faces (fan triangulation)
            const faceIndices: number[] = [];
            for (const part of parts) {
                if (vertexMap.has(part)) {
                    faceIndices.push(vertexMap.get(part)!);
                } else {
                    const segs = part.split("/");
                    const vi = parseInt(segs[0]) - 1;
                    const ti = segs[1] ? parseInt(segs[1]) - 1 : -1;
                    const ni = segs[2] ? parseInt(segs[2]) - 1 : -1;

                    const v = rawV[vi] || [0, 0, 0];
                    positions.push(v[0], v[1], v[2]);

                    if (ti >= 0 && rawVt[ti]) {
                        uvs.push(rawVt[ti][0], rawVt[ti][1]);
                    } else {
                        uvs.push(0, 0);
                    }

                    if (ni >= 0 && rawVn[ni]) {
                        normals.push(rawVn[ni][0], rawVn[ni][1], rawVn[ni][2]);
                    } else {
                        normals.push(0, 1, 0);
                    }

                    vertexMap.set(part, nextIdx);
                    faceIndices.push(nextIdx);
                    nextIdx++;
                }
            }
            // Fan triangulate
            for (let i = 1; i < faceIndices.length - 1; i++) {
                indices.push(faceIndices[0], faceIndices[i], faceIndices[i + 1]);
            }
        }
    }

    if (positions.length === 0) return null;

    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    vd.uvs = uvs;
    return vd;
}
