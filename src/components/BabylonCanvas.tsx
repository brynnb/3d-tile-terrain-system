/**
 * BabylonCanvas — manages the Babylon.js scene, renders floor mesh,
 * and handles click-to-paint via ground plane ray picking.
 */

import React, { useRef, useEffect, useCallback } from "react";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/groundBuilder";
import "@babylonjs/core/Meshes/Builders/linesBuilder";

import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { MapEditorState } from "../editor/MapEditorState";
import { parseOBJ } from "../terrain/ObjLoader";
import { FloorGeometryBuilder } from "../terrain/FloorGeometry";
import { MountainGeometryBuilder } from "../terrain/MountainGeometry";
import { SpriteGeometryBuilder } from "../terrain/SpriteGeometry";
import { WallGeometryBuilder } from "../terrain/WallGeometry";
import { AutotileGeometryBuilder } from "../terrain/AutotileGeometry";
import { TerrainGeometryBuilder } from "../terrain/TerrainGeometry";
import { generateAutotileAtlas } from "../terrain/AutotileAtlas";
import { generateMountainAtlas } from "../terrain/MountainAtlas";
import { Position } from "../terrain/Position";
import { SQUARE_SIZE } from "../terrain/Constants";

interface BabylonCanvasProps {
    editorState: MapEditorState;
    tilesetSrc: string;
    mountainTexSrc: string;
    showGrid?: boolean;
    skybox?: string;
    cameraMode?: "default" | "fps";
}

export const BabylonCanvas: React.FC<BabylonCanvasProps> = ({ editorState, tilesetSrc, mountainTexSrc, skybox, cameraMode = "default" }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sceneRef = useRef<Scene | null>(null);
    const floorMeshRef = useRef<Mesh | null>(null);
    const floorMeshesRef = useRef<Map<string, Mesh>>(new Map());
    const floorMatsRef = useRef<Map<string, { mat: StandardMaterial; texSize: { width: number; height: number } }>>(new Map());
    const mountainMeshRef = useRef<Mesh | null>(null);
    const previewMeshRef = useRef<Mesh | null>(null);
    const tilesetMatRef = useRef<StandardMaterial | null>(null);
    const mountainMatRef = useRef<StandardMaterial | null>(null);
    const previewFloorMatRef = useRef<StandardMaterial | null>(null);
    const previewMtnMatRef = useRef<StandardMaterial | null>(null);
    const eraserMatRef = useRef<StandardMaterial | null>(null);
    const texSizeRef = useRef<{ width: number; height: number }>({ width: 128, height: 256 });
    const mtnTexSizeRef = useRef<{ width: number; height: number }>({ width: 48, height: 48 });
    const groundRef = useRef<Mesh | null>(null);
    const gridMeshRef = useRef<Mesh | null>(null);
    const spriteMeshRef = useRef<Mesh | null>(null);
    const spriteMeshesRef = useRef<Map<string, Mesh>>(new Map());
    const wallMeshesRef = useRef<Map<string, Mesh>>(new Map());
    const wallMatsRef = useRef<Map<string, { mat: StandardMaterial; texSize: { width: number; height: number } }>>(new Map());
    const wallTexSizeRef = useRef<{ width: number; height: number }>({ width: 64, height: 48 });
    const wallMatRef = useRef<StandardMaterial | null>(null);
    const faceMeshesRef = useRef<Mesh[]>([]);
    const cameraRef = useRef<ArcRotateCamera | null>(null);
    const fpsCameraRef = useRef<UniversalCamera | null>(null);
    const autotileMeshesRef = useRef<Map<string, Mesh>>(new Map());
    const autotileMatsRef = useRef<Map<string, { mat: StandardMaterial; atlasSize: { width: number; height: number } }>>(new Map());
    // Animated autotile tracking: maps a base key (src:baseIdx) to array of 4 frame keys
    const animatedAutotilesRef = useRef<Map<string, string[]>>(new Map());
    const autotileAnimFrameRef = useRef(0);
    const mountainMatsRef = useRef<Map<string, { mat: StandardMaterial; texSize: { width: number; height: number } }>>(new Map());
    const mountainMeshesRef = useRef<Map<string, Mesh>>(new Map());
    const skyboxMeshRef = useRef<Mesh | null>(null);
    const tilesetTexRef = useRef<Texture | null>(null);
    const lightRef = useRef<HemisphericLight | null>(null);
    // 3D objects: cached VertexData per mesh name, materials per texture, placed meshes
    const obj3dVDCache = useRef<Map<string, VertexData>>(new Map());
    const obj3dMatCache = useRef<Map<string, StandardMaterial>>(new Map());
    const obj3dPlacedRef = useRef<Mesh[]>([]);
    const obj3dPreviewRef = useRef<Mesh | null>(null);
    const terrainFloorMeshRef = useRef<Mesh | null>(null);
    const terrainWallMeshRef = useRef<Mesh | null>(null);

    /** Rebuild all meshes from current editor state. */
    const rebuildMeshes = useCallback(() => {
        const scene = sceneRef.current;
        const floorMat = tilesetMatRef.current;
        const mtnMat = mountainMatRef.current;
        if (!scene || !floorMat) return;

        // Rebuild floors (grouped by tileset source)
        if (floorMeshRef.current) { floorMeshRef.current.dispose(); floorMeshRef.current = null; }
        for (const m of floorMeshesRef.current.values()) m.dispose();
        floorMeshesRef.current.clear();
        const floorEntries = editorState.getFloorEntries();
        // Build list of inverted pits with their reach in tiles.
        // Reach = ceil(borderWidthPixels / SQUARE_SIZE). Tiles within reach
        // on cardinal directions are removed; the tile at the reach boundary
        // on diagonals gets a diagonal cut.
        const invertedPits: { px: number; pz: number; reach: number }[] = [];
        for (const mtnEntry of editorState.getMountainEntries()) {
            if (mtnEntry.v.inverted) {
                const wpPx = mtnEntry.v.ws * SQUARE_SIZE + Math.round(mtnEntry.v.wp * SQUARE_SIZE / 100);
                if (wpPx > 0) {
                    const reach = Math.ceil(wpPx / SQUARE_SIZE);
                    invertedPits.push({ px: mtnEntry.k[0], pz: mtnEntry.k[3], reach });
                }
            }
        }
        // Build set of floor positions that fall in terrain slope zones.
        // When terrain tiles have slopeWidth > 0, floors within slopeWidth tiles
        // of the terrain edge must be removed. Uses manhattan distance — same
        // pattern as the inverted pit floor removal:
        //   Cardinal (one axis=0, within reach): REMOVE
        //   Diagonal interior (both>0, manhattan<=reach): REMOVE
        //   Diagonal boundary (both>0, manhattan=reach+1): CUT (triangle)
        //   Beyond: untouched
        const terrainSlopeRemovals = new Set<string>();
        const terrainSlopeCuts = new Map<string, number>(); // key -> cut flags
        const terrainMapForFloors = editorState.getTerrainMap();
        if (terrainMapForFloors.size > 0) {
            for (const [tKey, tData] of terrainMapForFloors) {
                const reach = tData.slopeWidth;
                if (reach <= 0) continue;
                const [tx, tz] = tKey.split(",").map(Number);
                // Scan neighbors within reach+1 range
                for (let dx = -(reach + 1); dx <= reach + 1; dx++) {
                    for (let dz = -(reach + 1); dz <= reach + 1; dz++) {
                        if (dx === 0 && dz === 0) continue;
                        const nx = tx + dx;
                        const nz = tz + dz;
                        const nKey = `${nx},${nz}`;
                        // Skip if the neighbor IS a terrain tile
                        if (terrainMapForFloors.has(nKey)) continue;
                        const adx = Math.abs(dx);
                        const adz = Math.abs(dz);
                        const manhattan = adx + adz;
                        // Cardinal (one axis=0) within reach: REMOVE
                        if ((adx === 0 || adz === 0) && manhattan <= reach) {
                            terrainSlopeRemovals.add(nKey);
                            continue;
                        }
                        // Diagonal interior (both>0, manhattan<=reach): REMOVE
                        if (adx > 0 && adz > 0 && manhattan <= reach) {
                            terrainSlopeRemovals.add(nKey);
                            continue;
                        }
                        // Diagonal cut line (both>0, manhattan=reach+1): CUT
                        if (adx > 0 && adz > 0 && manhattan === reach + 1) {
                            let flags = terrainSlopeCuts.get(nKey) || 0;
                            // Cut the corner facing the terrain tile
                            if (dx > 0) flags |= FloorGeometryBuilder.CUT_LEFT;
                            if (dx < 0) flags |= FloorGeometryBuilder.CUT_RIGHT;
                            if (dz > 0) flags |= FloorGeometryBuilder.CUT_TOP;
                            if (dz < 0) flags |= FloorGeometryBuilder.CUT_BOT;
                            terrainSlopeCuts.set(nKey, flags);
                        }
                    }
                }
            }
        }
        // Also skip floors directly under terrain tiles (they have their own geometry)
        for (const tKey of terrainMapForFloors.keys()) {
            terrainSlopeRemovals.add(tKey);
        }
        if (floorEntries.length > 0) {
            const groups = new Map<string, typeof floorEntries>();
            for (const entry of floorEntries) {
                const tex = entry.v.tex || editorState.tilesetSrc;
                let arr = groups.get(tex);
                if (!arr) { arr = []; groups.set(tex, arr); }
                arr.push(entry);
            }
            for (const [texPath, entries] of groups) {
                const cached = floorMatsRef.current.get(texPath);
                if (!cached) continue;
                const builder = new FloorGeometryBuilder();
                for (const entry of entries) {
                    const position = Position.createFromArray(entry.k);
                    const [fx, fy, , fz] = entry.k;

                    if (fy === 0) {
                        const fKey = `${fx},${fz}`;
                        // Skip floor tiles in terrain slope zones
                        if (terrainSlopeRemovals.has(fKey)) continue;

                        let skip = false;
                        let cutFlags = 0;

                        // Apply diagonal triangle cuts for terrain slopes
                        const terrainCut = terrainSlopeCuts.get(fKey);
                        if (terrainCut) {
                            cutFlags |= terrainCut;
                        }

                        // Floor removal around inverted pits
                        if (invertedPits.length > 0) {
                            for (const pit of invertedPits) {
                                const dx = fx - pit.px;
                                const dz = fz - pit.pz;
                                const adx = Math.abs(dx);
                                const adz = Math.abs(dz);
                                if (adx === 0 && adz === 0) continue;
                                const manhattan = adx + adz;
                                if ((adx === 0 || adz === 0) && manhattan <= pit.reach) {
                                    skip = true; break;
                                }
                                if (adx > 0 && adz > 0 && manhattan <= pit.reach) {
                                    skip = true; break;
                                }
                                if (adx > 0 && adz > 0 && manhattan === pit.reach + 1) {
                                    if (dx < 0) cutFlags |= FloorGeometryBuilder.CUT_RIGHT;
                                    if (dx > 0) cutFlags |= FloorGeometryBuilder.CUT_LEFT;
                                    if (dz < 0) cutFlags |= FloorGeometryBuilder.CUT_BOT;
                                    if (dz > 0) cutFlags |= FloorGeometryBuilder.CUT_TOP;
                                }
                            }
                        }
                        if (skip) continue;
                        builder.addFloor(position, entry.v, cached.texSize.width, cached.texSize.height, cutFlags);
                    } else {
                        builder.addFloor(position, entry.v, cached.texSize.width, cached.texSize.height);
                    }
                }
                const vertexData = builder.build();
                if (vertexData) {
                    const mesh = new Mesh("floors_" + texPath, scene);
                    vertexData.applyToMesh(mesh);
                    mesh.material = cached.mat;
                    floorMeshesRef.current.set(texPath, mesh);
                }
            }
        }

        // Rebuild mountains (grouped by per-tile texture)
        if (mountainMeshRef.current) {
            mountainMeshRef.current.dispose();
            mountainMeshRef.current = null;
        }
        for (const m of mountainMeshesRef.current.values()) m.dispose();
        mountainMeshesRef.current.clear();
        const mtnEntries = editorState.getMountainEntries();
        if (mtnEntries.length > 0) {
            const mtnGroups = new Map<string, typeof mtnEntries>();
            for (const entry of mtnEntries) {
                const tex = entry.v.tex || mountainTexSrc;
                let arr = mtnGroups.get(tex);
                if (!arr) { arr = []; mtnGroups.set(tex, arr); }
                arr.push(entry);
            }
            for (const [texPath, entries] of mtnGroups) {
                const cached = mountainMatsRef.current.get(texPath);
                if (!cached) continue;
                const mtnBuilder = new MountainGeometryBuilder();
                for (const entry of entries) {
                    const [x, y, , z] = entry.k;
                    mtnBuilder.addMountain(x, y, z, entry.v, cached.texSize.width, cached.texSize.height);
                }
                const mtnVD = mtnBuilder.build();
                if (mtnVD) {
                    const mesh = new Mesh("mountains_" + texPath, scene);
                    mtnVD.applyToMesh(mesh);
                    mesh.material = cached.mat;
                    mountainMeshesRef.current.set(texPath, mesh);
                }
            }
        }

        // Rebuild sprites (grouped by texture, separate static and face sprites)
        if (spriteMeshRef.current) {
            spriteMeshRef.current.dispose();
            spriteMeshRef.current = null;
        }
        for (const m of spriteMeshesRef.current.values()) m.dispose();
        spriteMeshesRef.current.clear();
        for (const fm of faceMeshesRef.current) fm.dispose();
        faceMeshesRef.current = [];
        const spriteEntries = editorState.getSpriteEntries();
        if (spriteEntries.length > 0) {
            // Group by texture
            const sprGroups = new Map<string, typeof spriteEntries>();
            const faceEntries: typeof spriteEntries = [];
            for (const entry of spriteEntries) {
                if (entry.v.k === "face") {
                    faceEntries.push(entry);
                } else {
                    const tex = entry.v.tex || editorState.tilesetSrc;
                    let arr = sprGroups.get(tex);
                    if (!arr) { arr = []; sprGroups.set(tex, arr); }
                    arr.push(entry);
                }
            }
            for (const [texPath, entries] of sprGroups) {
                const cached = floorMatsRef.current.get(texPath);
                if (!cached) continue;
                const builder = new SpriteGeometryBuilder();
                for (const entry of entries) {
                    const [x, y, yPx, z, layer] = entry.k;
                    const fullY = y + (yPx * SQUARE_SIZE / 100) / SQUARE_SIZE;
                    builder.addSprite(x, fullY, z, entry.v, cached.texSize.width, cached.texSize.height, layer);
                }
                const sprVD = builder.build();
                if (sprVD) {
                    const mesh = new Mesh("sprites_" + texPath, scene);
                    sprVD.applyToMesh(mesh);
                    mesh.material = cached.mat;
                    spriteMeshesRef.current.set(texPath, mesh);
                }
            }
            // Face sprites — each gets own mesh for billboard
            for (const entry of faceEntries) {
                const tex = entry.v.tex || editorState.tilesetSrc;
                const cached = floorMatsRef.current.get(tex);
                if (!cached) continue;
                const [x, y, yPx, z, layer] = entry.k;
                const fullY = y + (yPx * SQUARE_SIZE / 100) / SQUARE_SIZE;
                const fb = new SpriteGeometryBuilder();
                const faceAsFixed = { ...entry.v, k: "fix" as const };
                fb.addSprite(0, 0, 0, faceAsFixed, cached.texSize.width, cached.texSize.height, layer);
                const fvd = fb.build();
                if (fvd) {
                    const fm = new Mesh("faceSprite", scene);
                    fvd.applyToMesh(fm);
                    fm.material = cached.mat;
                    fm.position.x = x * SQUARE_SIZE;
                    fm.position.y = fullY * SQUARE_SIZE;
                    fm.position.z = z * SQUARE_SIZE;
                    fm.billboardMode = Mesh.BILLBOARDMODE_Y;
                    faceMeshesRef.current.push(fm);
                }
            }
        }

        // Rebuild walls (grouped by texture)
        for (const m of wallMeshesRef.current.values()) m.dispose();
        wallMeshesRef.current.clear();
        const wallEntries = editorState.getWallEntriesWithPos();
        if (wallEntries.length > 0) {
            // Group by texture path
            const groups = new Map<string, typeof wallEntries>();
            for (const entry of wallEntries) {
                const tex = entry.v.tex || editorState.wallTextureSrc;
                let arr = groups.get(tex);
                if (!arr) { arr = []; groups.set(tex, arr); }
                arr.push(entry);
            }
            for (const [texPath, entries] of groups) {
                const cached = wallMatsRef.current.get(texPath);
                if (!cached) continue; // texture not loaded yet
                const wallBuilder = new WallGeometryBuilder();
                for (const entry of entries) {
                    if (entry.v.is3d) {
                        wallBuilder.addWall3D(entry.x, 0, entry.z, entry.v, cached.texSize.width, cached.texSize.height);
                    } else {
                        wallBuilder.addWall(entry.x, 0, entry.z, entry.v, cached.texSize.width, cached.texSize.height);
                    }
                }
                const wallVD = wallBuilder.build();
                if (wallVD) {
                    const mesh = new Mesh("walls_" + texPath, scene);
                    wallVD.applyToMesh(mesh);
                    mesh.material = cached.mat;
                    wallMeshesRef.current.set(texPath, mesh);
                }
            }
        }

        // Rebuild autotiles (grouped by src:idx)
        // Animated autotile sources: each row has 4 animation frame columns
        const ANIMATED_AUTOTILE_COLS: Record<string, number> = { water: 4, lava: 4 };
        for (const m of autotileMeshesRef.current.values()) m.dispose();
        autotileMeshesRef.current.clear();
        animatedAutotilesRef.current.clear();
        const atEntries = editorState.getAutotileEntries();
        if (atEntries.length > 0) {
            const groups = new Map<string, typeof atEntries>();
            for (const entry of atEntries) {
                const key = `${entry.v.src}:${entry.v.idx}`;
                let arr = groups.get(key);
                if (!arr) { arr = []; groups.set(key, arr); }
                arr.push(entry);
            }
            for (const [atKey, entries] of groups) {
                const cached = autotileMatsRef.current.get(atKey);
                if (!cached) continue; // atlas not generated yet
                const atBuilder = new AutotileGeometryBuilder();
                for (const entry of entries) {
                    const [x, , , z] = entry.k;
                    atBuilder.addAutotile(x, z, entry.v, cached.atlasSize.width, cached.atlasSize.height);
                }
                const atVD = atBuilder.build();
                if (atVD) {
                    const mesh = new Mesh("autotiles_" + atKey, scene);
                    atVD.applyToMesh(mesh);
                    mesh.material = cached.mat;
                    autotileMeshesRef.current.set(atKey, mesh);

                    // Register animated autotile frame siblings
                    const src = entries[0].v.src;
                    const animCols = ANIMATED_AUTOTILE_COLS[src];
                    if (animCols) {
                        const idx = entries[0].v.idx;
                        const baseIdx = Math.floor(idx / animCols) * animCols; // first frame in row
                        const frameKeys = Array.from({ length: animCols }, (_, f) => `${src}:${baseIdx + f}`);
                        animatedAutotilesRef.current.set(atKey, frameKeys);
                    }
                }
            }
        }

        // Rebuild placed 3D objects
        for (const m of obj3dPlacedRef.current) m.dispose();
        obj3dPlacedRef.current = [];
        const obj3dEntries = editorState.getObject3dEntries();
        for (const entry of obj3dEntries) {
            const vd = obj3dVDCache.current.get(entry.v.mesh);
            const mat = obj3dMatCache.current.get(entry.v.tex);
            if (!vd || !mat || !scene) continue;
            const mesh = new Mesh("obj3d_" + entry.x + "_" + entry.z, scene);
            vd.applyToMesh(mesh);
            mesh.material = mat;
            mesh.position.set(
                (entry.x + 0.5) * SQUARE_SIZE,
                0,
                (entry.z + 0.5) * SQUARE_SIZE,
            );
            mesh.rotation.set(entry.v.rot[0], entry.v.rot[1], entry.v.rot[2]);
            mesh.scaling.setAll(SQUARE_SIZE);
            obj3dPlacedRef.current.push(mesh);
        }

        // Rebuild terrain (height-based system)
        if (terrainFloorMeshRef.current) {
            terrainFloorMeshRef.current.dispose();
            terrainFloorMeshRef.current = null;
        }
        if (terrainWallMeshRef.current) {
            terrainWallMeshRef.current.dispose();
            terrainWallMeshRef.current = null;
        }
        const terrainMap = editorState.getTerrainMap();
        if (terrainMap.size > 0) {
            // Use the first cached floor material for terrain floors
            const firstFloorMat = floorMatsRef.current.values().next().value;
            if (firstFloorMat) {
                const terrainBuilder = new TerrainGeometryBuilder();
                terrainBuilder.configure(
                    terrainMap,
                    firstFloorMat.texSize.width,
                    firstFloorMat.texSize.height,
                );

                // Terrain floors
                const terrainFloorVD = terrainBuilder.buildFloors();
                if (terrainFloorVD) {
                    const mesh = new Mesh("terrainFloors", scene);
                    terrainFloorVD.applyToMesh(mesh);
                    mesh.material = firstFloorMat.mat;
                    terrainFloorMeshRef.current = mesh;
                }

                // Terrain walls/slopes — use grass-noborders texture
                const terrainWallVD = terrainBuilder.buildWalls();
                if (terrainWallVD) {
                    const mesh = new Mesh("terrainWalls", scene);
                    terrainWallVD.applyToMesh(mesh);
                    // Get or create grass-noborders material for terrain walls
                    const terrainWallTexPath = "/tilesets/mountains/grass-noborders.png";
                    let terrainWallMat = mountainMatsRef.current.get(terrainWallTexPath);
                    if (!terrainWallMat) {
                        // Create material for grass-noborders
                        const mat = new StandardMaterial("terrainWallMat", scene);
                        const tex = new Texture(terrainWallTexPath, scene, false, true, Texture.NEAREST_SAMPLINGMODE);
                        mat.diffuseTexture = tex;
                        mat.specularColor = new Color3(0, 0, 0);
                        mat.backFaceCulling = false;
                        mat.twoSidedLighting = true;
                        terrainWallMat = { mat, texSize: { width: 16, height: 16 } };
                        mountainMatsRef.current.set(terrainWallTexPath, terrainWallMat);
                    }
                    mesh.material = terrainWallMat.mat;
                    terrainWallMeshRef.current = mesh;
                }
            }
        }

        // Grid overlay
        if (gridMeshRef.current) {
            gridMeshRef.current.dispose();
            gridMeshRef.current = null;
        }
        if (editorState.showGrid && scene) {
            const lines: Vector3[][] = [];
            const w = editorState.mapWidth;
            const d = editorState.mapDepth;
            for (let x = 0; x <= w; x++) {
                lines.push([
                    new Vector3(x * SQUARE_SIZE, 0.05, 0),
                    new Vector3(x * SQUARE_SIZE, 0.05, d * SQUARE_SIZE),
                ]);
            }
            for (let z = 0; z <= d; z++) {
                lines.push([
                    new Vector3(0, 0.05, z * SQUARE_SIZE),
                    new Vector3(w * SQUARE_SIZE, 0.05, z * SQUARE_SIZE),
                ]);
            }
            const gridMesh = MeshBuilder.CreateLineSystem("grid", { lines }, scene);
            gridMesh.color = new Color3(0.4, 0.4, 0.4);
            gridMesh.isPickable = false;
            gridMeshRef.current = gridMesh;
        }

        editorState.clearDirty();
    }, [editorState]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
        const scene = new Scene(engine);
        sceneRef.current = scene;
        scene.clearColor = new Color4(0.4, 0.6, 0.85, 1.0);

        // Camera targeting center of map
        const centerX = (editorState.mapWidth / 2) * SQUARE_SIZE;
        const centerZ = (editorState.mapDepth / 2) * SQUARE_SIZE;
        const camera = new ArcRotateCamera(
            "camera",
            -Math.PI / 2,
            Math.PI / 4,
            200,
            new Vector3(centerX, 0, centerZ),
            scene
        );
        camera.lowerBetaLimit = 0.1;
        camera.upperBetaLimit = Math.PI / 2.2;
        camera.lowerRadiusLimit = 30;
        camera.upperRadiusLimit = 10000;
        camera.wheelPrecision = 1; // ~50x more sensitive zoom (default ~50)
        camera.pinchPrecision = 5;
        camera.panningSensibility = 2.5; // 20x faster panning (default 50)
        // ArcRotateCamera buttons: [rotate, zoom, pan]
        // Right-click = rotate (2), no zoom button (-1, use scroll), middle = pan (1)
        camera.attachControl(canvas, true);
        (camera.inputs.attached.pointers as unknown as { buttons: number[] }).buttons = [2, -1, 1];

        // FPS-style WASD + Space/Shift movement (handled in beforeRender)
        // Arrow keys use built-in ArcRotateCamera panning
        camera.keysUp = [38];    // ↑
        camera.keysDown = [40];  // ↓
        camera.keysLeft = [37];  // ←
        camera.keysRight = [39]; // →
        const keysHeld = new Set<number>();
        const onCamKeyDown = (e: KeyboardEvent) => { keysHeld.add(e.keyCode); };
        const onCamKeyUp = (e: KeyboardEvent) => { keysHeld.delete(e.keyCode); };
        canvas.addEventListener("keydown", onCamKeyDown);
        canvas.addEventListener("keyup", onCamKeyUp);
        scene.registerBeforeRender(() => {
            const speed = 2;
            // Forward = camera→target direction projected onto XZ plane
            const forward = camera.target.subtract(camera.position);
            forward.y = 0;
            forward.normalize().scaleInPlace(speed);
            // Right = cross product of forward and up
            const right = Vector3.Cross(forward, Vector3.Up()).normalize().scaleInPlace(speed);

            const move = Vector3.Zero();
            if (keysHeld.has(87)) move.addInPlace(forward);   // W
            if (keysHeld.has(83)) move.subtractInPlace(forward); // S
            if (keysHeld.has(65)) move.addInPlace(right);     // A
            if (keysHeld.has(68)) move.subtractInPlace(right); // D
            if (keysHeld.has(32)) move.y += speed;             // Space — up
            if (keysHeld.has(16)) move.y -= speed;             // Shift — down

            if (move.lengthSquared() > 0) {
                camera.target.addInPlace(move);
                camera.position.addInPlace(move);
            }
        });

        // Cmd+drag (macOS) to orbit — simulate right-click behavior
        let cmdDragging = false;
        const onCmdPointerDown = (evt: PointerEvent) => {
            if (evt.button === 0 && evt.metaKey) {
                cmdDragging = true;
                (camera.inputs.attached.pointers as unknown as { buttons: number[] }).buttons = [0, -1, 1];
            }
        };
        const onCmdPointerUp = (evt: PointerEvent) => {
            if (cmdDragging) {
                cmdDragging = false;
                // Detach and reattach to force a clean input reset
                camera.detachControl();
                camera.attachControl(canvas, true);
                (camera.inputs.attached.pointers as unknown as { buttons: number[] }).buttons = [2, -1, 1];
            }
        };
        canvas.addEventListener("pointerdown", onCmdPointerDown, true);
        canvas.addEventListener("pointerup", onCmdPointerUp, true);

        // FPS fly camera (created but not active by default)
        const fpsCamera = new UniversalCamera(
            "fpsCamera",
            new Vector3(centerX, 100, centerZ),
            scene
        );
        fpsCamera.speed = 5;
        fpsCamera.keysUp = [87]; // W
        fpsCamera.keysDown = [83]; // S
        fpsCamera.keysLeft = [65]; // A
        fpsCamera.keysRight = [68]; // D
        fpsCamera.keysUpward = [32]; // Space
        fpsCamera.keysDownward = [16]; // Shift
        fpsCamera.minZ = 0.1;
        fpsCamera.angularSensibility = 800;
        fpsCameraRef.current = fpsCamera;

        // Camera switching with pointer lock for FPS mode
        let currentCameraMode = "default";
        const switchCamera = (mode: string) => {
            currentCameraMode = mode;
            if (mode === "fps") {
                camera.detachControl();
                // Position FPS camera where ArcRotate is looking from
                fpsCamera.position = camera.position.clone();
                fpsCamera.setTarget(camera.target.clone());
                fpsCamera.attachControl(canvas, true);
                scene.activeCamera = fpsCamera;
                // Request pointer lock for mouse look
                canvas.requestPointerLock();
            } else {
                fpsCamera.detachControl();
                // Exit pointer lock if active
                if (document.pointerLockElement === canvas) {
                    document.exitPointerLock();
                }
                camera.attachControl(canvas, true);
                (camera.inputs.attached.pointers as unknown as { buttons: number[] }).buttons = [2, -1, 1];
                scene.activeCamera = camera;
            }
        };
        (editorState as unknown as Record<string, unknown>)._switchCamera = switchCamera;

        // ESC exits FPS mode → switch back to default
        const onKeyDownEsc = (e: KeyboardEvent) => {
            if (e.key === "Escape" && currentCameraMode === "fps") {
                // Trigger the React state change via exposed callback
                const cb = (editorState as unknown as Record<string, unknown>)._onCameraModeChange;
                if (typeof cb === "function") (cb as (mode: string) => void)("default");
                else switchCamera("default");
            }
        };
        canvas.addEventListener("keydown", onKeyDownEsc);

        // Re-lock pointer when clicking canvas in FPS mode (after ESC unlocks)
        const onCanvasClickFps = () => {
            if (currentCameraMode === "fps" && document.pointerLockElement !== canvas) {
                canvas.requestPointerLock();
            }
        };
        canvas.addEventListener("click", onCanvasClickFps);

        // Light
        const light = new HemisphericLight("light", new Vector3(0.5, 1, 0.3), scene);
        light.intensity = 1.0;
        lightRef.current = light;

        // Expose ambient tint setter — modulates emissiveColor on all content materials
        // Since materials use disableLighting + emissiveTexture, emissiveColor acts as a tint multiplier.
        // Color3(1,1,1) = no tint (full brightness). Color3(0.5,0.5,0.7) = darker blue tint, etc.
        (editorState as unknown as Record<string, unknown>)._setAmbientTint = (r: number, g: number, b: number) => {
            const tint = new Color3(r, g, b);
            // Apply tint to all cached content materials
            for (const { mat } of floorMatsRef.current.values()) mat.emissiveColor = tint;
            for (const { mat } of mountainMatsRef.current.values()) mat.emissiveColor = tint;
            for (const { mat } of wallMatsRef.current.values()) mat.emissiveColor = tint;
            for (const { mat } of autotileMatsRef.current.values()) mat.emissiveColor = tint;
            for (const mat of obj3dMatCache.current.values()) mat.emissiveColor = tint;
            if (tilesetMatRef.current) tilesetMatRef.current.emissiveColor = tint;
        };
        (editorState as unknown as Record<string, unknown>)._setFog = (fogStart: number, renderDist: number) => {
            if (fogStart <= 0 || fogStart >= renderDist) {
                scene.fogMode = 0; // NONE
            } else {
                scene.fogMode = 3; // LINEAR — only fogs between fogStart and fogEnd
                scene.fogStart = fogStart;
                scene.fogEnd = renderDist;
                scene.fogColor = new Color3(0.7, 0.75, 0.85);
            }
        };
        (editorState as unknown as Record<string, unknown>)._setRenderDistance = (dist: number) => {
            if (cameraRef.current) cameraRef.current.maxZ = dist;
            if (fpsCameraRef.current) fpsCameraRef.current.maxZ = dist;
            // Resize skybox to fit within new render distance
            if (skyboxMeshRef.current) {
                const s = dist * 0.9;
                skyboxMeshRef.current.scaling.setAll(s / 5000);
            }
        };

        // Skybox
        const setupSkybox = (skyboxName: string) => {
            if (skyboxMeshRef.current) {
                skyboxMeshRef.current.material?.dispose();
                skyboxMeshRef.current.dispose();
                skyboxMeshRef.current = null;
            }
            const skyboxMesh = MeshBuilder.CreateBox("skybox", { size: 5000 }, scene);
            const skyboxMat = new StandardMaterial("skyboxMat", scene);
            skyboxMat.backFaceCulling = false;
            skyboxMat.disableLighting = true;
            skyboxMat.diffuseColor = new Color3(0, 0, 0);
            skyboxMat.specularColor = new Color3(0, 0, 0);
            // CubeTexture.CreateFromImages order: px, py, pz, nx, ny, nz
            // Babylon LH skybox: px=right, py=top, pz=back, nx=left, ny=bottom, nz=front
            const cubeTex = CubeTexture.CreateFromImages(
                [
                    `/skyboxes/${skyboxName}-right.png`,   // px (+X)
                    `/skyboxes/${skyboxName}-top.png`,     // py (+Y)
                    `/skyboxes/${skyboxName}-front.png`,   // pz (+Z = front in LH skybox)
                    `/skyboxes/${skyboxName}-left.png`,    // nx (-X)
                    `/skyboxes/${skyboxName}-bottom.png`,  // ny (-Y)
                    `/skyboxes/${skyboxName}-back.png`,    // nz (-Z = back in LH skybox)
                ],
                scene
            );
            cubeTex.coordinatesMode = Texture.SKYBOX_MODE;
            skyboxMat.reflectionTexture = cubeTex;
            skyboxMesh.material = skyboxMat;
            skyboxMesh.infiniteDistance = true;
            skyboxMesh.isPickable = false;
            skyboxMesh.applyFog = false;
            skyboxMesh.renderingGroupId = 0;
            // Scale skybox to fit within current camera maxZ
            const curMaxZ = cameraRef.current?.maxZ ?? fpsCameraRef.current?.maxZ ?? 5000;
            skyboxMesh.scaling.setAll((curMaxZ * 0.9) / 5000);
            skyboxMeshRef.current = skyboxMesh;
        };
        // Expose skybox setup for prop changes
        (editorState as unknown as Record<string, unknown>)._setupSkybox = setupSkybox;
        // Set up initial skybox
        if (skybox) setupSkybox(skybox);

        // Invisible ground plane for ray picking (covers map area)
        const groundSize = Math.max(editorState.mapWidth, editorState.mapDepth) * SQUARE_SIZE * 2;
        const ground = MeshBuilder.CreateGround("ground", {
            width: groundSize,
            height: groundSize,
        }, scene);
        ground.position.x = centerX;
        ground.position.z = centerZ;
        ground.isPickable = true;
        ground.visibility = 0; // invisible
        groundRef.current = ground;

        // Floor tileset material cache — creates/caches a material per tileset path
        const ensureFloorMaterial = (texPath: string, onReady?: () => void) => {
            if (floorMatsRef.current.has(texPath)) {
                onReady?.();
                return;
            }
            const tex = new Texture(texPath, scene, false, true, Texture.NEAREST_SAMPLINGMODE);
            tex.hasAlpha = true;
            tex.wrapU = Texture.CLAMP_ADDRESSMODE;
            tex.wrapV = Texture.CLAMP_ADDRESSMODE;
            const mat = new StandardMaterial("floorMat_" + texPath, scene);
            mat.diffuseTexture = tex;
            mat.specularPower = 0;
            mat.backFaceCulling = false;
            mat.emissiveTexture = tex;
            mat.disableLighting = true;
            tex.onLoadObservable.addOnce(() => {
                const sz = tex.getSize();
                floorMatsRef.current.set(texPath, { mat, texSize: { width: sz.width, height: sz.height } });
                onReady?.();
            });
        };
        (editorState as unknown as Record<string, unknown>)._ensureFloorMaterial = ensureFloorMaterial;

        // Tileset texture + material — for preview and sprites (current tileset)
        const loadTilesetTexture = (src: string) => {
            const newTex = new Texture(src, scene, false, true, Texture.NEAREST_SAMPLINGMODE);
            newTex.hasAlpha = true;
            newTex.wrapU = Texture.CLAMP_ADDRESSMODE;
            newTex.wrapV = Texture.CLAMP_ADDRESSMODE;
            newTex.onLoadObservable.addOnce(() => {
                const size = newTex.getSize();
                texSizeRef.current = { width: size.width, height: size.height };
                // Update preview + sprite materials
                if (tilesetMatRef.current) {
                    tilesetMatRef.current.diffuseTexture = newTex;
                    tilesetMatRef.current.emissiveTexture = newTex;
                }
                if (previewFloorMatRef.current) {
                    previewFloorMatRef.current.diffuseTexture = newTex;
                    previewFloorMatRef.current.emissiveTexture = newTex;
                }
                if (tilesetTexRef.current && tilesetTexRef.current !== newTex) {
                    tilesetTexRef.current.dispose();
                }
                tilesetTexRef.current = newTex;
                // Also ensure floor material cache has this tileset
                ensureFloorMaterial(src, () => rebuildMeshes());
            });
            return newTex;
        };
        (editorState as unknown as Record<string, unknown>)._loadTilesetTexture = loadTilesetTexture;

        const tilesetTex = loadTilesetTexture(tilesetSrc);
        tilesetTexRef.current = tilesetTex;

        const tilesetMat = new StandardMaterial("tilesetMat", scene);
        tilesetMat.diffuseTexture = tilesetTex;
        tilesetMat.specularPower = 0;
        tilesetMat.backFaceCulling = false;
        tilesetMat.emissiveTexture = tilesetTex;
        tilesetMat.disableLighting = true;
        tilesetMatRef.current = tilesetMat;

        // Preview materials (semi-transparent versions)
        const previewFloorMat = new StandardMaterial("previewFloorMat", scene);
        previewFloorMat.diffuseTexture = tilesetTex;
        previewFloorMat.specularPower = 0;
        previewFloorMat.backFaceCulling = false;
        previewFloorMat.emissiveTexture = tilesetTex;
        previewFloorMat.disableLighting = true;
        previewFloorMat.alpha = 0.5;
        previewFloorMatRef.current = previewFloorMat;

        const eraserMat = new StandardMaterial("eraserPrevMat", scene);
        eraserMat.diffuseColor.set(1, 0.2, 0.2);
        eraserMat.emissiveColor.set(1, 0.2, 0.2);
        eraserMat.alpha = 0.3;
        eraserMat.disableLighting = true;
        eraserMatRef.current = eraserMat;

        // Mountain texture cache — creates/caches a material per mountain texture path
        const ensureMountainMaterial = (texPath: string, onReady?: () => void) => {
            if (mountainMatsRef.current.has(texPath)) {
                onReady?.();
                return;
            }
            const img = new Image();
            img.onload = () => {
                const atlasCanvas = generateMountainAtlas(img);
                const atlasDataUrl = atlasCanvas.toDataURL();
                const mtnTex = new Texture(atlasDataUrl, scene, false, true, Texture.NEAREST_SAMPLINGMODE);
                mtnTex.hasAlpha = true;
                mtnTex.wrapU = Texture.CLAMP_ADDRESSMODE;
                mtnTex.wrapV = Texture.CLAMP_ADDRESSMODE;

                const mtnMat = new StandardMaterial("mountainMat_" + texPath, scene);
                mtnMat.diffuseTexture = mtnTex;
                mtnMat.specularPower = 0;
                mtnMat.backFaceCulling = false;
                mtnMat.emissiveTexture = mtnTex;
                mtnMat.disableLighting = true;

                mountainMatsRef.current.set(texPath, {
                    mat: mtnMat,
                    texSize: { width: atlasCanvas.width, height: atlasCanvas.height },
                });

                // Update preview + current material refs for the currently selected texture
                mountainMatRef.current = mtnMat;
                mtnTexSizeRef.current = { width: atlasCanvas.width, height: atlasCanvas.height };

                const previewMtnMat = new StandardMaterial("previewMtnMat_" + texPath, scene);
                previewMtnMat.diffuseTexture = mtnTex;
                previewMtnMat.specularPower = 0;
                previewMtnMat.backFaceCulling = false;
                previewMtnMat.emissiveTexture = mtnTex;
                previewMtnMat.disableLighting = true;
                previewMtnMat.alpha = 0.5;
                previewMtnMatRef.current = previewMtnMat;

                onReady?.();
            };
            img.src = texPath;
        };
        (editorState as unknown as Record<string, unknown>)._ensureMountainMaterial = ensureMountainMaterial;

        const setupMountainMaterial = () => {
            ensureMountainMaterial(mountainTexSrc, () => checkAllReady());
        };

        // When mountain texture changes, ensure material is cached and update preview refs
        const loadMountainTexture = (src: string) => {
            ensureMountainMaterial(src, () => {
                const cached = mountainMatsRef.current.get(src);
                if (cached) {
                    mountainMatRef.current = cached.mat;
                    mtnTexSizeRef.current = cached.texSize;
                }
                rebuildMeshes();
            });
        };
        (editorState as unknown as Record<string, unknown>)._loadMountainTexture = loadMountainTexture;

        // Wall texture — creates/caches a material for a given texture path
        const ensureWallMaterial = (texPath: string, onReady?: () => void) => {
            if (wallMatsRef.current.has(texPath)) {
                onReady?.();
                return;
            }
            const wallTex = new Texture(texPath, scene, false, true, Texture.NEAREST_SAMPLINGMODE);
            wallTex.hasAlpha = true;
            wallTex.wrapU = Texture.CLAMP_ADDRESSMODE;
            wallTex.wrapV = Texture.CLAMP_ADDRESSMODE;
            const wMat = new StandardMaterial("wallMat_" + texPath, scene);
            wMat.diffuseTexture = wallTex;
            wMat.specularPower = 0;
            wMat.backFaceCulling = false;
            wMat.emissiveTexture = wallTex;
            wMat.disableLighting = true;
            wallTex.onLoadObservable.addOnce(() => {
                const sz = wallTex.getSize();
                wallMatsRef.current.set(texPath, { mat: wMat, texSize: { width: sz.width, height: sz.height } });
                wallTexSizeRef.current = { width: sz.width, height: sz.height };
                wallMatRef.current = wMat;
                console.log(`Wall texture loaded: ${texPath} ${sz.width}x${sz.height}`);
                onReady?.();
            });
        };
        const setupWallMaterial = () => {
            ensureWallMaterial(editorState.wallTextureSrc, () => checkAllReady());
        };

        // Autotile atlas — per src:idx caching. Generates atlas on demand.
        const ensureAutotileAtlas = (src: string, idx: number, onReady?: () => void) => {
            const cacheKey = `${src}:${idx}`;
            if (autotileMatsRef.current.has(cacheKey)) {
                onReady?.();
                return;
            }
            const atImg = new Image();
            atImg.onload = () => {
                const atlasCanvas = generateAutotileAtlas(atImg, idx);
                const atlasDataUrl = atlasCanvas.toDataURL();
                const atTex = new Texture(atlasDataUrl, scene, false, true, Texture.NEAREST_SAMPLINGMODE);
                atTex.hasAlpha = true;
                atTex.wrapU = Texture.CLAMP_ADDRESSMODE;
                atTex.wrapV = Texture.CLAMP_ADDRESSMODE;
                const atMat = new StandardMaterial("autotileMat_" + cacheKey, scene);
                atMat.diffuseTexture = atTex;
                atMat.specularPower = 0;
                atMat.backFaceCulling = false;
                atMat.emissiveTexture = atTex;
                atMat.disableLighting = true;
                autotileMatsRef.current.set(cacheKey, {
                    mat: atMat,
                    atlasSize: { width: atlasCanvas.width, height: atlasCanvas.height },
                });
                onReady?.();
            };
            atImg.src = `/tilesets/autotiles/${src}.png`;
        };
        (editorState as unknown as Record<string, unknown>)._ensureAutotileAtlas = ensureAutotileAtlas;
        const setupAutotileMaterial = () => {
            ensureAutotileAtlas(editorState.autotileSrc, editorState.autotileIdx, () => checkAllReady());
        };

        // 3D object loading — fetch OBJ, parse, cache VertexData
        const ensureObj3dMesh = (meshName: string, onReady?: () => void) => {
            if (obj3dVDCache.current.has(meshName)) { onReady?.(); return; }
            if (meshName.startsWith("_box")) {
                // Parse dimensions from key: _box_ws_wp_hs_hp_ds_dp
                const parts = meshName.split("_");
                const ws = parseInt(parts[2] || "1");
                const wp = parseInt(parts[3] || "0");
                const hs = parseInt(parts[4] || "1");
                const hp = parseInt(parts[5] || "0");
                const ds = parseInt(parts[6] || "1");
                const dp = parseInt(parts[7] || "0");
                // Convert to world units: squares + pixel% of SQUARE_SIZE
                const w = (ws + wp / 100);
                const h = (hs + hp / 100);
                const d = (ds + dp / 100);
                // Create box centered on X/Z, sitting on Y=0
                const boxMesh = MeshBuilder.CreateBox("_tmpBox", { width: w, height: h, depth: d }, scene);
                // Shift up so bottom face sits at Y=0
                const positions = boxMesh.getVerticesData("position");
                if (positions) {
                    for (let i = 1; i < positions.length; i += 3) positions[i] += h / 2;
                    boxMesh.setVerticesData("position", positions);
                }
                const vd = VertexData.ExtractFromMesh(boxMesh);
                boxMesh.dispose();
                obj3dVDCache.current.set(meshName, vd);
                onReady?.();
                return;
            }
            fetch(`/objects3d/meshes/${meshName}.obj`)
                .then(r => r.text())
                .then(text => {
                    const vd = parseOBJ(text);
                    if (vd) obj3dVDCache.current.set(meshName, vd);
                    onReady?.();
                })
                .catch(() => onReady?.());
        };
        (editorState as unknown as Record<string, unknown>)._ensureObj3dMesh = ensureObj3dMesh;

        const ensureObj3dMaterial = (texName: string, onReady?: () => void) => {
            if (obj3dMatCache.current.has(texName)) { onReady?.(); return; }
            const tex = new Texture(`/objects3d/textures/${texName}.png`, scene, false, true, Texture.NEAREST_SAMPLINGMODE);
            tex.hasAlpha = true;
            tex.wrapU = Texture.CLAMP_ADDRESSMODE;
            tex.wrapV = Texture.CLAMP_ADDRESSMODE;
            const mat = new StandardMaterial("obj3dMat_" + texName, scene);
            mat.diffuseTexture = tex;
            mat.specularPower = 0;
            mat.backFaceCulling = false;
            mat.emissiveTexture = tex;
            mat.disableLighting = true;
            tex.onLoadObservable.addOnce(() => {
                obj3dMatCache.current.set(texName, mat);
                onReady?.();
            });
        };
        (editorState as unknown as Record<string, unknown>)._ensureObj3dMaterial = ensureObj3dMaterial;

        // Ensure both mesh and texture are loaded, then call back
        const ensureObj3dReady = (meshName: string, texName: string, onReady?: () => void) => {
            let count = 0;
            const check = () => { count++; if (count >= 2) onReady?.(); };
            ensureObj3dMesh(meshName, check);
            ensureObj3dMaterial(texName, check);
        };
        (editorState as unknown as Record<string, unknown>)._ensureObj3dReady = ensureObj3dReady;

        cameraRef.current = camera;

        // Wait for mountain, wall, autotile textures to load (tileset handled by loadTilesetTexture)
        let readyCount = 0;
        const checkAllReady = () => {
            readyCount++;
            if (readyCount >= 3) {
                rebuildMeshes();
            }
        };

        setupMountainMaterial();
        setupWallMaterial();
        setupAutotileMaterial();

        // Pre-cache materials for all tilesets/textures already referenced by existing map data
        const existingFloorTexs = new Set<string>();
        for (const e of editorState.getFloorEntries()) {
            if (e.v.tex) existingFloorTexs.add(e.v.tex);
        }
        for (const e of editorState.getSpriteEntries()) {
            if (e.v.tex) existingFloorTexs.add(e.v.tex);
        }
        for (const tex of existingFloorTexs) {
            ensureFloorMaterial(tex);
        }
        const existingMtnTexs = new Set<string>();
        for (const e of editorState.getMountainEntries()) {
            if (e.v.tex) existingMtnTexs.add(e.v.tex);
        }
        for (const tex of existingMtnTexs) {
            if (tex !== mountainTexSrc) ensureMountainMaterial(tex);
        }
        const existingWallTexs = new Set<string>();
        for (const e of editorState.getWallEntriesWithPos()) {
            if (e.v.tex) existingWallTexs.add(e.v.tex);
        }
        for (const tex of existingWallTexs) {
            if (tex !== editorState.wallTextureSrc) ensureWallMaterial(tex);
        }

        // Helper: pick tile coordinates from pointer position.
        // Returns hitKind to tell eraser what was actually clicked.
        type PickResult = { tileX: number; tileZ: number; hitKind: "ground" | "wall" | "other" };
        const pickTile = (forEraser: boolean): PickResult | null => {
            let pickResult;
            let hitKind: "ground" | "wall" | "other" = "ground";
            if (forEraser) {
                // Pick any visible mesh first, fall back to ground plane
                pickResult = scene.pick(scene.pointerX, scene.pointerY, (m) => m !== previewMeshRef.current && m !== ground && m.isPickable);
                if (pickResult?.hit && pickResult.pickedMesh) {
                    const name = pickResult.pickedMesh.name;
                    if (name.startsWith("walls_")) hitKind = "wall";
                    else hitKind = "other";
                } else {
                    pickResult = scene.pick(scene.pointerX, scene.pointerY, (m) => m === ground);
                    hitKind = "ground";
                }
            } else {
                pickResult = scene.pick(scene.pointerX, scene.pointerY, (m) => m === ground);
                hitKind = "ground";
            }
            if (!pickResult?.hit || !pickResult.pickedPoint) return null;
            const tileX = Math.floor(pickResult.pickedPoint.x / SQUARE_SIZE);
            const tileZ = Math.floor(pickResult.pickedPoint.z / SQUARE_SIZE);
            if (tileX < 0 || tileX >= editorState.mapWidth || tileZ < 0 || tileZ >= editorState.mapDepth) return null;
            return { tileX, tileZ, hitKind };
        };

        // Paint helper: pick ground plane and apply active tool
        let undoPushedThisStroke = false;
        const tryPaint = (shiftKey: boolean) => {
            const tool = editorState.activeTool;
            const isErasing = shiftKey || tool === "eraser";
            const tile = pickTile(isErasing);
            if (!tile) return;
            const { tileX, tileZ } = tile;
            // Push undo once per stroke
            if (!undoPushedThisStroke) {
                editorState.pushUndo();
                undoPushedThisStroke = true;
            }
            if (isErasing) {
                const bs = editorState.eraserBrushSize;
                const half = Math.floor(bs / 2);
                for (let dx = -half; dx < bs - half; dx++) {
                    for (let dz = -half; dz < bs - half; dz++) {
                        const ex = tileX + dx, ez = tileZ + dz;
                        if (ex >= 0 && ex < editorState.mapWidth && ez >= 0 && ez < editorState.mapDepth) {
                            if (tile.hitKind === "wall") {
                                // Only erase walls when a wall mesh was clicked
                                editorState.eraseAllWalls(ex, ez);
                            } else {
                                // Ground or other: erase everything
                                editorState.eraseFloor(ex, ez);
                                editorState.removeMountain(ex, ez);
                                editorState.eraseSprite(ex, ez);
                                editorState.eraseAllWalls(ex, ez);
                                editorState.eraseAutotile(ex, ez);
                                editorState.eraseObject3d(ex, ez);
                                editorState.removeTerrain(ex, ez);
                            }
                        }
                    }
                }
            } else if (tool === "floor") {
                if (editorState.paintMode === "fill") {
                    editorState.floodFill(tileX, tileZ, editorState.selectedTile);
                } else if (editorState.paintMode === "custom") {
                    editorState.paintFloorRect(tileX, tileZ);
                } else {
                    editorState.paintFloorBrush(tileX, tileZ, editorState.selectedTile);
                }
            } else if (tool === "mountain") {
                editorState.placeMountain(tileX, tileZ);
            } else if (tool === "sprite") {
                editorState.placeSprite(tileX, tileZ, editorState.selectedTile);
            } else if (tool === "autotile") {
                // Ensure atlas exists for the current autotile set before placing
                const atKey = `${editorState.autotileSrc}:${editorState.autotileIdx}`;
                if (!autotileMatsRef.current.has(atKey)) {
                    ensureAutotileAtlas(editorState.autotileSrc, editorState.autotileIdx, () => {
                        editorState.placeAutotile(tileX, tileZ);
                    });
                } else {
                    editorState.placeAutotile(tileX, tileZ);
                }
            } else if (tool === "object3d") {
                const mName = editorState.object3dMesh;
                const tName = editorState.object3dTex;
                if (!obj3dVDCache.current.has(mName) || !obj3dMatCache.current.has(tName)) {
                    ensureObj3dReady(mName, tName, () => {
                        editorState.placeObject3d(tileX, tileZ);
                    });
                } else {
                    editorState.placeObject3d(tileX, tileZ);
                }
            } else if (tool === "terrain") {
                editorState.placeTerrain(tileX, tileZ);
            }
            // wall tool is handled separately via drag
        };

        // Wall texture reload helper — ensures the selected texture material is cached
        const reloadWallTexture = () => {
            ensureWallMaterial(editorState.wallTextureSrc, () => {
                const cached = wallMatsRef.current.get(editorState.wallTextureSrc);
                if (cached) {
                    wallMatRef.current = cached.mat;
                    wallTexSizeRef.current = cached.texSize;
                }
                rebuildMeshes();
            });
        };
        // Expose reload to editorState for UI changes
        (editorState as unknown as Record<string, unknown>)._reloadWallTex = reloadWallTexture;

        // Pointer state
        let isPainting = false;
        let wallDragStart: { tileX: number; tileZ: number } | null = null;
        let wallDragCancelled = false;

        const clearPreview = () => {
            if (previewMeshRef.current) {
                previewMeshRef.current.dispose();
                previewMeshRef.current = null;
            }
            obj3dPreviewRef.current = null;
        };

        const updatePreview = () => {
            clearPreview();
            const tile = pickTile(false);
            if (!tile) return;
            const { tileX, tileZ } = tile;

            const tool = editorState.activeTool;
            if (tool === "floor" && previewFloorMatRef.current) {
                const builder = new FloorGeometryBuilder();
                const { width: texW, height: texH } = texSizeRef.current;
                const sel = editorState.selectedTile;
                if (editorState.paintMode === "custom") {
                    const r = editorState.floorRect;
                    const halfW = Math.floor(r.w / 2);
                    const halfH = Math.floor(r.h / 2);
                    for (let dx = 0; dx < r.w; dx++) {
                        for (let dz = 0; dz < r.h; dz++) {
                            const px = tileX + dx - halfW, pz = tileZ + dz - halfH;
                            if (px >= 0 && px < editorState.mapWidth && pz >= 0 && pz < editorState.mapDepth) {
                                const pos = Position.createFromArray([px, 0, 0, pz, 0]);
                                builder.addFloor(pos, { t: [r.col + dx, r.row + dz] }, texW, texH);
                            }
                        }
                    }
                } else {
                    const bs = editorState.paintMode === "fill" ? 1 : editorState.brushSize;
                    const half = Math.floor(bs / 2);
                    for (let dx = -half; dx < bs - half; dx++) {
                        for (let dz = -half; dz < bs - half; dz++) {
                            const px = tileX + dx, pz = tileZ + dz;
                            if (px >= 0 && px < editorState.mapWidth && pz >= 0 && pz < editorState.mapDepth) {
                                const pos = Position.createFromArray([px, 0, 0, pz, 0]);
                                builder.addFloor(pos, { t: [sel.col, sel.row] }, texW, texH);
                            }
                        }
                    }
                }
                const vd = builder.build();
                if (vd) {
                    const mesh = new Mesh("preview", scene);
                    vd.applyToMesh(mesh);
                    mesh.material = previewFloorMatRef.current;
                    mesh.position.y = 0.1;
                    mesh.isPickable = false;
                    previewMeshRef.current = mesh;
                }
            } else if (tool === "mountain" && previewMtnMatRef.current) {
                const mtnBuilder = new MountainGeometryBuilder();
                const { width: mTexW, height: mTexH } = mtnTexSizeRef.current;
                const tempMtn = {
                    sid: 1,
                    ws: editorState.mountainWidthSquares,
                    wp: editorState.mountainWidthPixels,
                    hs: editorState.mountainHeightSquares,
                    hp: editorState.mountainHeightPixels,
                    t: false, b: false, l: false, r: false,
                };
                mtnBuilder.addMountain(tileX, 0, tileZ, tempMtn, mTexW, mTexH);
                const vd = mtnBuilder.build();
                if (vd) {
                    const mesh = new Mesh("preview", scene);
                    vd.applyToMesh(mesh);
                    mesh.material = previewMtnMatRef.current;
                    mesh.isPickable = false;
                    previewMeshRef.current = mesh;
                }
            } else if (tool === "sprite" && previewFloorMatRef.current) {
                const sprBuilder = new SpriteGeometryBuilder();
                const { width: texW, height: texH } = texSizeRef.current;
                const sel = editorState.selectedTile;
                const spriteData = {
                    t: [sel.col, sel.row, editorState.spriteWidth, editorState.spriteHeight],
                    k: "fix" as const,
                };
                sprBuilder.addSprite(tileX, 0, tileZ, spriteData, texW, texH);
                const vd = sprBuilder.build();
                if (vd) {
                    const mesh = new Mesh("preview", scene);
                    vd.applyToMesh(mesh);
                    mesh.material = previewFloorMatRef.current;
                    mesh.isPickable = false;
                    previewMeshRef.current = mesh;
                }
            } else if (tool === "wall" && wallDragStart && !wallDragCancelled) {
                // Wall drag preview: show wall line from start to current tile
                const curWallTex = editorState.wallTextureSrc;
                const cachedWall = wallMatsRef.current.get(curWallTex);
                if (!cachedWall) { ensureWallMaterial(curWallTex); return; }
                const dx = tileX - wallDragStart.tileX;
                const dz = tileZ - wallDragStart.tileZ;
                const wallBuilder = new WallGeometryBuilder();
                const { width: wTexW, height: wTexH } = cachedWall.texSize;
                if (Math.abs(dx) >= Math.abs(dz)) {
                    const edge = dz >= 0 ? "south" as const : "north" as const;
                    const startX = Math.min(wallDragStart.tileX, tileX);
                    const endX = Math.max(wallDragStart.tileX, tileX);
                    for (let xi = startX; xi <= endX; xi++) {
                        const k = xi === startX && xi === endX ? 1 : xi === startX ? 0 : xi === endX ? 2 : 1;
                        wallBuilder.addWall(xi, 0, wallDragStart.tileZ, { k, edge }, wTexW, wTexH);
                    }
                } else {
                    const edge = dx >= 0 ? "east" as const : "west" as const;
                    const startZ = Math.min(wallDragStart.tileZ, tileZ);
                    const endZ = Math.max(wallDragStart.tileZ, tileZ);
                    for (let zi = startZ; zi <= endZ; zi++) {
                        const k = zi === startZ && zi === endZ ? 1 : zi === startZ ? 0 : zi === endZ ? 2 : 1;
                        wallBuilder.addWall(wallDragStart.tileX, 0, zi, { k, edge }, wTexW, wTexH);
                    }
                }
                const vd = wallBuilder.build();
                if (vd) {
                    const mesh = new Mesh("preview", scene);
                    vd.applyToMesh(mesh);
                    mesh.material = cachedWall.mat;
                    mesh.isPickable = false;
                    previewMeshRef.current = mesh;
                }
            } else if (tool === "wall" && !wallDragStart) {
                // Before drag starts, show a single-tile highlight
                const mesh = MeshBuilder.CreateGround("preview", {
                    width: SQUARE_SIZE, height: SQUARE_SIZE,
                }, scene);
                mesh.position.x = tileX * SQUARE_SIZE + SQUARE_SIZE / 2;
                mesh.position.y = 0.15;
                mesh.position.z = tileZ * SQUARE_SIZE + SQUARE_SIZE / 2;
                const mat = new StandardMaterial("wallPrevMat", scene);
                mat.diffuseColor.set(0.2, 0.6, 1);
                mat.emissiveColor.set(0.2, 0.6, 1);
                mat.alpha = 0.3;
                mat.disableLighting = true;
                mesh.material = mat;
                mesh.isPickable = false;
                previewMeshRef.current = mesh;
            } else if (tool === "autotile") {
                // Show a semi-transparent highlight at the cursor for autotile placement
                const bs = editorState.autotileBrushSize || 1;
                const half = Math.floor(bs / 2);
                const totalSize = bs * SQUARE_SIZE;
                const atMesh = MeshBuilder.CreateGround("preview", {
                    width: totalSize, height: totalSize,
                }, scene);
                atMesh.position.x = (tileX - half + bs / 2) * SQUARE_SIZE;
                atMesh.position.y = 0.12;
                atMesh.position.z = (tileZ - half + bs / 2) * SQUARE_SIZE;
                const atMat = new StandardMaterial("atPrevMat", scene);
                atMat.diffuseColor.set(0.2, 0.9, 0.5);
                atMat.emissiveColor.set(0.2, 0.9, 0.5);
                atMat.alpha = 0.25;
                atMat.disableLighting = true;
                atMesh.material = atMat;
                atMesh.isPickable = false;
                previewMeshRef.current = atMesh;
            } else if (tool === "object3d") {
                const mName = editorState.object3dMesh;
                const tName = editorState.object3dTex;
                const vd = obj3dVDCache.current.get(mName);
                const mat = obj3dMatCache.current.get(tName);
                if (vd && mat) {
                    // Create a semi-transparent preview clone
                    const mesh = new Mesh("obj3dPreview", scene);
                    vd.applyToMesh(mesh);
                    const prevMat = mat.clone("obj3dPrevMat");
                    prevMat.alpha = 0.5;
                    mesh.material = prevMat;
                    mesh.position.set(
                        (tileX + 0.5) * SQUARE_SIZE,
                        0,
                        (tileZ + 0.5) * SQUARE_SIZE,
                    );
                    mesh.rotation.set(
                        editorState.object3dRot[0],
                        editorState.object3dRot[1],
                        editorState.object3dRot[2],
                    );
                    mesh.scaling.setAll(SQUARE_SIZE);
                    mesh.isPickable = false;
                    obj3dPreviewRef.current = mesh;
                    previewMeshRef.current = mesh;
                }
            } else if (tool === "eraser" && eraserMatRef.current) {
                const mesh = MeshBuilder.CreateGround("preview", {
                    width: SQUARE_SIZE, height: SQUARE_SIZE,
                }, scene);
                mesh.position.x = tileX * SQUARE_SIZE + SQUARE_SIZE / 2;
                mesh.position.y = 0.15;
                mesh.position.z = tileZ * SQUARE_SIZE + SQUARE_SIZE / 2;
                mesh.material = eraserMatRef.current;
                mesh.isPickable = false;
                previewMeshRef.current = mesh;
            }
        };

        const onPointerDown = (evt: PointerEvent) => {
            if (evt.button !== 0) return;
            if (evt.metaKey) return; // Cmd+drag is camera orbit, not painting
            const tool = editorState.activeTool;
            if (tool === "wall" && !evt.shiftKey) {
                // Start wall drag
                const tile = pickTile(false);
                if (tile) {
                    wallDragStart = tile;
                    wallDragCancelled = false;
                }
            } else {
                isPainting = true;
                undoPushedThisStroke = false;
                tryPaint(evt.shiftKey);
            }
        };

        const onPointerMove = (evt: PointerEvent) => {
            if (isPainting) {
                tryPaint(evt.shiftKey);
            }
            updatePreview();
        };

        const onPointerUp = (evt: PointerEvent) => {
            if (evt.button !== 0) return;
            if (wallDragStart && !wallDragCancelled) {
                const tile = pickTile(false);
                if (tile) {
                    editorState.pushUndo();
                    editorState.placeWallLine(wallDragStart.tileX, wallDragStart.tileZ, tile.tileX, tile.tileZ);
                }
            }
            isPainting = false;
            undoPushedThisStroke = false;
            wallDragStart = null;
            wallDragCancelled = false;
            clearPreview();
        };

        const onKeyDown = (evt: KeyboardEvent) => {
            if (evt.key === "Escape" && wallDragStart) {
                wallDragCancelled = true;
                wallDragStart = null;
                clearPreview();
            }
            // Ctrl+Z / Cmd+Z for undo
            if (evt.key === "z" && (evt.ctrlKey || evt.metaKey) && !evt.shiftKey) {
                evt.preventDefault();
                editorState.undo();
            }
            // Object3D rotation keys: 1=X, 2=Y, 3=Z (90° increments), 4=reset
            if (editorState.activeTool === "object3d") {
                const ROT_STEP = Math.PI / 2;
                if (evt.key === "1") {
                    editorState.object3dRot[0] = (editorState.object3dRot[0] + ROT_STEP) % (Math.PI * 2);
                    updatePreview();
                    const cb = (editorState as unknown as Record<string, unknown>)._onRotChange;
                    if (typeof cb === "function") (cb as () => void)();
                } else if (evt.key === "2") {
                    editorState.object3dRot[1] = (editorState.object3dRot[1] + ROT_STEP) % (Math.PI * 2);
                    updatePreview();
                    const cb = (editorState as unknown as Record<string, unknown>)._onRotChange;
                    if (typeof cb === "function") (cb as () => void)();
                } else if (evt.key === "3") {
                    editorState.object3dRot[2] = (editorState.object3dRot[2] + ROT_STEP) % (Math.PI * 2);
                    updatePreview();
                    const cb = (editorState as unknown as Record<string, unknown>)._onRotChange;
                    if (typeof cb === "function") (cb as () => void)();
                } else if (evt.key === "4") {
                    editorState.object3dRot = [0, 0, 0];
                    updatePreview();
                    const cb = (editorState as unknown as Record<string, unknown>)._onRotChange;
                    if (typeof cb === "function") (cb as () => void)();
                }
            }
        };

        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        window.addEventListener("keydown", onKeyDown);

        // Listen for state changes and rebuild meshes
        const unsubscribe = editorState.onChange(() => {
            rebuildMeshes();
        });

        // Render loop with autotile animation
        let lastAnimTime = 0;
        const ANIM_INTERVAL = 200; // ms per frame
        engine.runRenderLoop(() => {
            const now = performance.now();
            if (now - lastAnimTime > ANIM_INTERVAL) {
                lastAnimTime = now;
                autotileAnimFrameRef.current = (autotileAnimFrameRef.current + 1) % 4;
                const frame = autotileAnimFrameRef.current;
                // Swap materials on animated autotile meshes
                for (const [baseKey, frameKeys] of animatedAutotilesRef.current) {
                    const mesh = autotileMeshesRef.current.get(baseKey);
                    if (!mesh) continue;
                    const targetKey = frameKeys[frame];
                    const cached = autotileMatsRef.current.get(targetKey);
                    if (cached) mesh.material = cached.mat;
                }
            }
            scene.render();
        });

        const onResize = () => engine.resize();
        window.addEventListener("resize", onResize);

        // Initial resize to fit container
        setTimeout(() => engine.resize(), 50);

        return () => {
            unsubscribe();
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("pointerdown", onCmdPointerDown, true);
            canvas.removeEventListener("pointerup", onCmdPointerUp, true);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("resize", onResize);
            engine.dispose();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editorState, rebuildMeshes]);

    // Mountain texture change — swap in-place without recreating scene
    const mtnTexSrcRef = useRef(mountainTexSrc);
    useEffect(() => {
        if (mountainTexSrc === mtnTexSrcRef.current) return;
        mtnTexSrcRef.current = mountainTexSrc;
        const fn = (editorState as unknown as Record<string, unknown>)._loadMountainTexture;
        if (typeof fn === "function") (fn as (src: string) => void)(mountainTexSrc);
    }, [mountainTexSrc, editorState]);

    // Tileset prop change — swap texture in-place without recreating scene
    const tilesetSrcRef = useRef(tilesetSrc);
    useEffect(() => {
        if (tilesetSrc === tilesetSrcRef.current) return; // skip initial
        tilesetSrcRef.current = tilesetSrc;
        const fn = (editorState as unknown as Record<string, unknown>)._loadTilesetTexture;
        if (typeof fn === "function") (fn as (src: string) => void)(tilesetSrc);
    }, [tilesetSrc, editorState]);

    // Camera mode change
    const cameraModeRef = useRef(cameraMode);
    useEffect(() => {
        if (cameraMode === cameraModeRef.current) return;
        cameraModeRef.current = cameraMode;
        const fn = (editorState as unknown as Record<string, unknown>)._switchCamera;
        if (typeof fn === "function") (fn as (mode: string) => void)(cameraMode);
    }, [cameraMode, editorState]);

    // Skybox prop change — call exposed setup function without recreating scene
    useEffect(() => {
        if (!skybox) return;
        const fn = (editorState as unknown as Record<string, unknown>)._setupSkybox;
        if (typeof fn === "function") (fn as (name: string) => void)(skybox);
    }, [skybox, editorState]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                width: "100%",
                height: "100%",
                display: "block",
                touchAction: "none",
                outline: "none",
            }}
        />
    );
};
