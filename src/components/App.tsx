/**
 * App — main layout. Babylon canvas takes most of the screen,
 * tileset palette panel on the right side with tool controls.
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { BabylonCanvas } from "./BabylonCanvas";
import { TilesetPalette, TileRect } from "./TilesetPalette";
import { MapEditorState, SelectedTile, EditorTool } from "../editor/MapEditorState";
import type { SpriteKind } from "../terrain/SpriteGeometry";
import { OBJECTS3D_CATALOG } from "../data/objects3d-catalog";

const WALL_TEXTURES = [
    "brick", "bridge-string", "bush-haunted", "bush-snow", "bush", "castle1",
    "cave1", "hedge-snow", "hedge", "inside-door-opened", "inside1", "inside2",
    "inside3", "jungle1", "jungle2", "sandstone-big", "sandstone", "sewers",
    "spaceship1", "spaceship2", "stone", "volcano1", "volcano2", "white-wall",
    "wood", "woods-wall",
];

const AUTOTILE_SOURCES = ["water", "general", "haunted", "lava", "snow"];

// Each autotile set is 32x48 pixels (2×SQUARE_SIZE wide, 3×SQUARE_SIZE tall)
// Dimensions: general=192x144 (6x3=18 sets), haunted=192x144 (18), lava=128x48 (4x1=4), snow=192x144 (18), water=128x288 (4x6=24)
// For animated sets (water, lava): 4 columns per row are animation frames — show 1 thumbnail per row.
// 'animated' marks sets where each row of 4 is a single animated autotile.
const AUTOTILE_SETS: { file: string; count: number; cols: number; animated?: boolean; rows?: number }[] = [
    { file: "general", count: 18, cols: 6 },
    { file: "water", count: 6, cols: 4, animated: true, rows: 6 },
    { file: "snow", count: 18, cols: 6 },
    { file: "haunted", count: 18, cols: 6 },
    { file: "lava", count: 1, cols: 4, animated: true, rows: 1 },
];

const TILESETS = [
    "plains-woods", "plains-woods-snow", "plains-woods-haunted",
    "beach-desert", "castle", "dungeon-mines", "inside", "jungle",
    "school", "sewers", "shop", "spaceship", "town", "town-desert",
    "town-snow", "volcano",
];

const SKYBOXES = ["day", "evening-sun", "night"];

const MOUNTAIN_TEXTURES = [
    "grass", "grass-noborders", "grass-small-cave-entry", "snow", "snow-no-borders",
    "sand", "desert", "sandstone", "cave", "haunted", "haunted-noborders",
    "sewers", "sidewalk", "stairs",
    "roof-blue", "roof-green", "roof-red", "roof-white",
];

const toolButtonStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 12px",
    border: active ? "2px solid #4af" : "1px solid #666",
    background: active ? "#335" : "#333",
    color: active ? "#fff" : "#aaa",
    borderRadius: 4,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: active ? 700 : 400,
});

const numInputStyle: React.CSSProperties = {
    width: 48, padding: "2px 4px", background: "#444", color: "#fff",
    border: "1px solid #666", borderRadius: 3, fontSize: 12, textAlign: "right",
};
const labelStyle: React.CSSProperties = { fontSize: 11, color: "#999", minWidth: 20 };

const activeInputStyle: React.CSSProperties = {
    ...numInputStyle,
    border: "1px solid #4af",
    background: "#335",
};
const inactiveInputStyle: React.CSSProperties = {
    ...numInputStyle,
    color: "#666",
};

const MtnPropRow: React.FC<{
    label: string; sq: number; px: number;
    onSq: (v: number) => void; onPx: (v: number) => void;
    sqMax: number; pxMax: number;
}> = ({ label, sq, px, onSq, onPx, sqMax, pxMax }) => {
    // The most recently edited input is "active" — indicated by having a non-zero value.
    // When both are 0, neither is highlighted.
    const sqActive = sq > 0 || (sq === 0 && px === 0);
    const pxActive = px > 0;
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: "#ccc", minWidth: 80 }}>{label}</span>
            <span style={{ ...labelStyle, color: sqActive ? "#4af" : "#666" }}>sq</span>
            <input type="number" min={0} max={sqMax} value={sq}
                style={sqActive ? activeInputStyle : inactiveInputStyle}
                onChange={e => onSq(Math.max(0, Math.min(sqMax, parseInt(e.target.value, 10) || 0)))} />
            <span style={{ ...labelStyle, color: pxActive ? "#4af" : "#666" }}>px</span>
            <input type="number" min={0} max={pxMax} value={px}
                style={pxActive ? activeInputStyle : inactiveInputStyle}
                onChange={e => onPx(Math.max(0, Math.min(pxMax, parseInt(e.target.value, 10) || 0)))} />
        </div>
    );
};

// Per-skybox ambient tint settings stored in localStorage
interface SkyboxTintSettings {
    tintR: number;
    tintG: number;
    tintB: number;
}
interface SceneSettings {
    skyboxTints: Record<string, SkyboxTintSettings>;
    fogStart: number;
    renderDistance: number;
}

const DEFAULT_TINT: SkyboxTintSettings = { tintR: 1, tintG: 1, tintB: 1 };
const STORAGE_KEY = "3d-tile-terrain-system-scene-settings";

function loadSceneSettings(): SceneSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            // Migrate old format
            if (!parsed.skyboxTints) parsed.skyboxTints = {};
            return parsed;
        }
    } catch { /* ignore */ }
    return { skyboxTints: {}, fogStart: 0, renderDistance: 5000 };
}
function saveSceneSettings(s: SceneSettings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

const sliderRow = (label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void) => (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: "#999", minWidth: 65 }}>{label}</span>
        <input type="range" min={min} max={max} step={step} value={value}
            style={{ flex: 1, accentColor: "#4af" }}
            onChange={e => onChange(parseFloat(e.target.value))} />
        <span style={{ fontSize: 11, color: "#aaa", minWidth: 32, textAlign: "right" }}>{value.toFixed(step < 0.1 ? 3 : step < 1 ? 1 : 0)}</span>
    </div>
);

const SkyboxPanel: React.FC<{
    skyboxIdx: number; setSkyboxIdx: (v: number) => void;
    skyboxes: string[]; editorState: MapEditorState;
}> = ({ skyboxIdx, setSkyboxIdx, skyboxes, editorState }) => {
    const [settings, setSettings] = useState<SceneSettings>(() => loadSceneSettings());
    const skyboxName = skyboxes[skyboxIdx];
    const tint = settings.skyboxTints[skyboxName] || { ...DEFAULT_TINT };

    const es = editorState as unknown as Record<string, unknown>;
    const callSetter = (name: string, ...args: number[]) => {
        const fn = es[name];
        if (typeof fn === "function") (fn as (...a: number[]) => void)(...args);
    };

    // Apply current settings whenever skybox changes
    useEffect(() => {
        const s = loadSceneSettings();
        setSettings(s);
        const t = s.skyboxTints[skyboxName] || { ...DEFAULT_TINT };
        callSetter("_setAmbientTint", t.tintR, t.tintG, t.tintB);
        callSetter("_setFog", s.fogStart, s.renderDistance);
        callSetter("_setRenderDistance", s.renderDistance);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [skyboxName]);

    const updateTint = (patch: Partial<SkyboxTintSettings>) => {
        const updated = { ...tint, ...patch };
        const next = { ...settings, skyboxTints: { ...settings.skyboxTints, [skyboxName]: updated } };
        setSettings(next);
        callSetter("_setAmbientTint", updated.tintR, updated.tintG, updated.tintB);
    };

    const updateFogStart = (fogStart: number) => {
        const next = { ...settings, fogStart };
        setSettings(next);
        callSetter("_setFog", fogStart, settings.renderDistance);
    };

    const updateRenderDist = (renderDistance: number) => {
        const next = { ...settings, renderDistance };
        setSettings(next);
        callSetter("_setRenderDistance", renderDistance);
        callSetter("_setFog", settings.fogStart, renderDistance);
    };

    const handleSave = () => {
        const toSave = { ...settings, skyboxTints: { ...settings.skyboxTints, [skyboxName]: tint } };
        saveSceneSettings(toSave);
    };

    return (
        <div style={{ padding: 12, overflowY: "auto" }}>
            <div style={{ fontSize: 12, color: "#ccc", marginBottom: 8 }}>Skybox</div>
            <div style={{ display: "flex", gap: 4, alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
                <button onClick={() => setSkyboxIdx((skyboxIdx - 1 + skyboxes.length) % skyboxes.length)}
                    style={{ background: "#444", color: "#fff", border: "1px solid #666", borderRadius: 3, cursor: "pointer", padding: "4px 12px" }}>&lt;</button>
                <span style={{ fontSize: 13, color: "#aaa", minWidth: 90, textAlign: "center" }}>{skyboxName}</span>
                <button onClick={() => setSkyboxIdx((skyboxIdx + 1) % skyboxes.length)}
                    style={{ background: "#444", color: "#fff", border: "1px solid #666", borderRadius: 3, cursor: "pointer", padding: "4px 12px" }}>&gt;</button>
            </div>

            <div style={{ fontSize: 12, color: "#ccc", marginBottom: 6 }}>Ambient Tint ({skyboxName})</div>
            {sliderRow("Red", tint.tintR, 0, 1, 0.01, v => updateTint({ tintR: v }))}
            {sliderRow("Green", tint.tintG, 0, 1, 0.01, v => updateTint({ tintG: v }))}
            {sliderRow("Blue", tint.tintB, 0, 1, 0.01, v => updateTint({ tintB: v }))}

            <button onClick={handleSave} style={{
                marginTop: 6, marginBottom: 12, padding: "4px 12px", background: "#3a5", color: "#fff",
                border: "none", borderRadius: 3, cursor: "pointer", fontSize: 12, width: "100%",
            }}>Save Lighting</button>

            <div style={{ fontSize: 12, color: "#ccc", marginBottom: 6 }}>Environment</div>
            {sliderRow("Fog Start", settings.fogStart, 0, 15000, 100, v => updateFogStart(v))}
            {sliderRow("Render Dist", settings.renderDistance, 500, 20000, 100, v => updateRenderDist(v))}
        </div>
    );
};

export const App: React.FC = () => {
    const editorState = useMemo(() => {
        const state = new MapEditorState(320, 320);
        state.generateDefaultMap({ col: 0, row: 0 });
        return state;
    }, []);

    const [selectedTile, setSelectedTile] = useState<SelectedTile>({ col: 0, row: 0 });
    const [activeTool, setActiveTool] = useState<EditorTool>("floor");
    const [mtnWidthSq, setMtnWidthSq] = useState(0);
    const [mtnWidthPx, setMtnWidthPx] = useState(0);
    const [mtnHeightSq, setMtnHeightSq] = useState(1);
    const [mtnHeightPx, setMtnHeightPx] = useState(0);
    const [mtnInverted, setMtnInverted] = useState(false);
    const [showGrid, setShowGrid] = useState(true);
    const [spriteKind, setSpriteKind] = useState<SpriteKind>("fix");
    const [spriteRect, setSpriteRect] = useState<TileRect>({ col: 0, row: 0, w: 1, h: 1 });
    const [wallTexture, setWallTexture] = useState(WALL_TEXTURES[0]);
    const [wall3d, setWall3d] = useState(false);
    const [autotileBrush, setAutotileBrush] = useState(1);
    const [autotileSrc, setAutotileSrc] = useState(AUTOTILE_SOURCES[0]);
    const [autotileIdx, setAutotileIdx] = useState(0);
    const [tilesetIdx, setTilesetIdx] = useState(0);
    const [brushSize, setBrushSize] = useState(1);
    const [eraserBrush, setEraserBrush] = useState(1);
    const [paintMode, setPaintMode] = useState<"brush" | "fill" | "custom">("brush");
    const [floorRect, setFloorRect] = useState<TileRect>({ col: 0, row: 0, w: 1, h: 1 });
    const [, setUndoTick] = useState(0); // force re-render on undo
    const [skyboxIdx, setSkyboxIdx] = useState(0);
    const [sidebarTab, setSidebarTab] = useState<"tools" | "skybox" | "objects">("tools");
    const [cameraMode, setCameraMode] = useState<"default" | "fps">("default");
    // Terrain tool state
    const [terrainHeight, setTerrainHeight] = useState(-1);
    const [terrainSlopeWidth, setTerrainSlopeWidth] = useState(0);
    const [terrainBrushSize, setTerrainBrushSize] = useState(1);
    // Expose callback so BabylonCanvas ESC handler can update React state
    (editorState as unknown as Record<string, unknown>)._onCameraModeChange = (mode: string) => {
        setCameraMode(mode as "default" | "fps");
    };
    const [mountainTex, setMountainTex] = useState("grass");
    const [obj3dMeshIdx, setObj3dMeshIdx] = useState(0);
    const [obj3dTexIdx, setObj3dTexIdx] = useState(0);
    const [obj3dRot, setObj3dRot] = useState<[number, number, number]>([0, 0, 0]);
    // Expose rotation change callback so BabylonCanvas key handler can update React state
    (editorState as unknown as Record<string, unknown>)._onRotChange = () => {
        setObj3dRot([...editorState.object3dRot]);
    };
    const sidebarRef = useRef<HTMLDivElement>(null);

    const currentTilesetSrc = `/tilesets/${TILESETS[tilesetIdx]}.png`;
    const currentSkybox = SKYBOXES[skyboxIdx];
    const currentMountainTexSrc = `/tilesets/mountains/${mountainTex}.png`;

    const handleSelectTile = (tile: SelectedTile) => {
        setSelectedTile(tile);
        editorState.selectedTile = tile;
    };

    // Prevent sidebar from stealing arrow/space keys from Babylon camera
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)) {
                // If focus is inside the sidebar, blur it so camera gets the key
                if (sidebarRef.current?.contains(document.activeElement)) {
                    (document.activeElement as HTMLElement)?.blur();
                }
            }
        };
        window.addEventListener("keydown", handler, true); // capture phase
        return () => window.removeEventListener("keydown", handler, true);
    }, []);

    const handleToolChange = useCallback((tool: EditorTool) => {
        setActiveTool(tool);
        editorState.activeTool = tool;
    }, [editorState]);

    const setMtnProp = useCallback((prop: string, val: number) => {
        switch (prop) {
            case "ws":
                setMtnWidthSq(val); editorState.mountainWidthSquares = val;
                if (val > 0) { setMtnWidthPx(0); editorState.mountainWidthPixels = 0; }
                break;
            case "wp":
                setMtnWidthPx(val); editorState.mountainWidthPixels = val;
                if (val > 0) { setMtnWidthSq(0); editorState.mountainWidthSquares = 0; }
                break;
            case "hs":
                setMtnHeightSq(val); editorState.mountainHeightSquares = val;
                if (val > 0) { setMtnHeightPx(0); editorState.mountainHeightPixels = 0; }
                break;
            case "hp":
                setMtnHeightPx(val); editorState.mountainHeightPixels = val;
                if (val > 0) { setMtnHeightSq(0); editorState.mountainHeightSquares = 0; }
                break;
        }
    }, [editorState]);

    const handleGridToggle = useCallback(() => {
        const next = !showGrid;
        setShowGrid(next);
        editorState.showGrid = next;
        // Trigger a rebuild so the grid mesh updates
        (editorState as unknown as Record<string, boolean>)._dirty = true;
        for (const fn of (editorState as unknown as Record<string, (() => void)[]>).listeners) fn();
    }, [editorState, showGrid]);

    return (
        <div style={{ display: "flex", width: "100%", height: "100%" }}>
            {/* Babylon viewport */}
            <div style={{ flex: 1, position: "relative" }}>
                <BabylonCanvas
                    editorState={editorState}
                    tilesetSrc={currentTilesetSrc}
                    mountainTexSrc={currentMountainTexSrc}
                    showGrid={showGrid}
                    skybox={currentSkybox}
                    cameraMode={cameraMode}
                />
                <div style={{
                    position: "absolute",
                    bottom: 8,
                    left: 8,
                    color: "#fff",
                    fontSize: 11,
                    background: "rgba(0,0,0,0.5)",
                    padding: "4px 8px",
                    borderRadius: 4,
                    pointerEvents: "none",
                }}>
                    Click to paint | Shift+Click to erase | Wall: drag to place, ESC cancel | Right-drag to rotate | Scroll to zoom
                </div>
                {/* Camera mode toggle — top left */}
                <div style={{
                    position: "absolute",
                    top: 8,
                    left: 8,
                    display: "flex",
                    gap: 4,
                }}>
                    <button
                        style={toolButtonStyle(cameraMode === "default")}
                        onClick={() => setCameraMode("default")}
                    >Default</button>
                    <button
                        style={toolButtonStyle(cameraMode === "fps")}
                        onClick={() => setCameraMode("fps")}
                    >FPS</button>
                </div>
            </div>

            {/* Right panel */}
            <div ref={sidebarRef} style={{
                width: 280,
                background: "#2a2a2a",
                borderLeft: "1px solid #444",
                overflowY: "auto",
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
            }}>
                {/* Sidebar tabs */}
                <div style={{ display: "flex", borderBottom: "1px solid #444" }}>
                    <button
                        style={{ flex: 1, padding: "8px 0", background: sidebarTab === "tools" ? "#335" : "#2a2a2a", color: sidebarTab === "tools" ? "#fff" : "#888", border: "none", borderBottom: sidebarTab === "tools" ? "2px solid #4af" : "2px solid transparent", cursor: "pointer", fontSize: 12, fontWeight: sidebarTab === "tools" ? 700 : 400 }}
                        onClick={() => setSidebarTab("tools")}
                    >Tools</button>
                    <button
                        style={{ flex: 1, padding: "8px 0", background: sidebarTab === "objects" ? "#335" : "#2a2a2a", color: sidebarTab === "objects" ? "#fff" : "#888", border: "none", borderBottom: sidebarTab === "objects" ? "2px solid #4af" : "2px solid transparent", cursor: "pointer", fontSize: 12, fontWeight: sidebarTab === "objects" ? 700 : 400 }}
                        onClick={() => { setSidebarTab("objects"); handleToolChange("object3d"); }}
                    >Objects</button>
                    <button
                        style={{ flex: 1, padding: "8px 0", background: sidebarTab === "skybox" ? "#335" : "#2a2a2a", color: sidebarTab === "skybox" ? "#fff" : "#888", border: "none", borderBottom: sidebarTab === "skybox" ? "2px solid #4af" : "2px solid transparent", cursor: "pointer", fontSize: 12, fontWeight: sidebarTab === "skybox" ? 700 : 400 }}
                        onClick={() => setSidebarTab("skybox")}
                    >Skybox</button>
                </div>

                {sidebarTab === "skybox" && (<SkyboxPanel
                    skyboxIdx={skyboxIdx} setSkyboxIdx={setSkyboxIdx}
                    skyboxes={SKYBOXES} editorState={editorState}
                />)}

                {sidebarTab === "objects" && (() => {
                    const catalog = OBJECTS3D_CATALOG;
                    const meshEntry = catalog[obj3dMeshIdx] || catalog[0];
                    const boxMeshKey = (e: typeof catalog[0]) =>
                        e.mesh === "_box" ? `_box_${e.ws||1}_${e.wp||0}_${e.hs||1}_${e.hp||0}_${e.ds||1}_${e.dp||0}` : e.mesh;
                    const selectMesh = (idx: number) => {
                        setObj3dMeshIdx(idx);
                        setObj3dTexIdx(0);
                        const entry = catalog[idx];
                        const mKey = boxMeshKey(entry);
                        editorState.object3dMesh = mKey;
                        editorState.object3dTex = entry.textures[0];
                        const fn = (editorState as unknown as Record<string, unknown>)._ensureObj3dReady;
                        if (typeof fn === "function") (fn as (m: string, t: string) => void)(mKey, entry.textures[0]);
                    };
                    const selectTex = (idx: number) => {
                        setObj3dTexIdx(idx);
                        editorState.object3dTex = meshEntry.textures[idx];
                        const fn = (editorState as unknown as Record<string, unknown>)._ensureObj3dMaterial;
                        if (typeof fn === "function") (fn as (t: string) => void)(meshEntry.textures[idx]);
                    };
                    const toDeg = (r: number) => Math.round((r * 180) / Math.PI);
                    const listItemStyle = (sel: boolean): React.CSSProperties => ({
                        padding: "4px 8px", cursor: "pointer", borderRadius: 3, fontSize: 12,
                        background: sel ? "#335" : "transparent",
                        color: sel ? "#fff" : "#aaa",
                        border: sel ? "1px solid #4af" : "1px solid transparent",
                    });
                    return (
                        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
                            <div style={{ fontSize: 12, color: "#ccc", marginBottom: 4 }}>Mesh</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 10, maxHeight: 200, overflowY: "auto" }}>
                                {catalog.map((entry, i) => {
                                    const label = entry.mesh === "_box" ? `📦 ${entry.textures[0]}` : entry.mesh;
                                    return (
                                        <div key={entry.mesh + ":" + entry.textures[0]} style={listItemStyle(obj3dMeshIdx === i)}
                                            onClick={() => selectMesh(i)}>
                                            {label}
                                        </div>
                                    );
                                })}
                            </div>

                            <div style={{ fontSize: 12, color: "#ccc", marginBottom: 4 }}>Texture ({meshEntry.mesh === "_box" ? "box" : meshEntry.mesh})</div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 10, maxHeight: 200, overflowY: "auto" }}>
                                {meshEntry.textures.map((tex, i) => (
                                    <div key={tex} style={listItemStyle(obj3dTexIdx === i)}
                                        onClick={() => selectTex(i)}>
                                        {tex}
                                    </div>
                                ))}
                            </div>

                            <div style={{ fontSize: 12, color: "#ccc", marginBottom: 4 }}>Rotation</div>
                            <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>
                                X: {toDeg(obj3dRot[0])}° &nbsp; Y: {toDeg(obj3dRot[1])}° &nbsp; Z: {toDeg(obj3dRot[2])}°
                            </div>
                            <div style={{ fontSize: 11, color: "#666" }}>
                                Press <b>1</b>=X <b>2</b>=Y <b>3</b>=Z (90°) &nbsp; <b>4</b>=Reset
                            </div>
                        </div>
                    );
                })()}

                {sidebarTab === "tools" && (<div style={{ flex: 1, overflowY: "auto" }}>
                {/* Tool selector */}
                <div style={{ padding: 8, borderBottom: "1px solid #444" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: "#ccc" }}>Tool</span>
                        <label style={{ fontSize: 11, color: "#999", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
                            <input type="checkbox" checked={showGrid} onChange={handleGridToggle} />
                            Grid
                        </label>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <button style={toolButtonStyle(activeTool === "floor")}
                            onClick={() => handleToolChange("floor")}>Floor</button>
                        <button style={toolButtonStyle(activeTool === "mountain")}
                            onClick={() => handleToolChange("mountain")}>Mountain</button>
                        <button style={toolButtonStyle(activeTool === "sprite")}
                            onClick={() => handleToolChange("sprite")}>Sprite</button>
                        <button style={toolButtonStyle(activeTool === "wall")}
                            onClick={() => handleToolChange("wall")}>Wall</button>
                        <button style={toolButtonStyle(activeTool === "autotile")}
                            onClick={() => handleToolChange("autotile")}>Autotile</button>
                        <button style={toolButtonStyle(activeTool === "eraser")}
                            onClick={() => handleToolChange("eraser")}>Eraser</button>
                        <button style={toolButtonStyle(activeTool === "terrain")}
                            onClick={() => handleToolChange("terrain")}>Terrain</button>
                    </div>
                    <div style={{ display: "flex", gap: 4, marginTop: 6, alignItems: "center" }}>
                        <button
                            style={{ ...toolButtonStyle(false), opacity: editorState.canUndo ? 1 : 0.4 }}
                            disabled={!editorState.canUndo}
                            onClick={() => { editorState.undo(); setUndoTick(t => t + 1); }}
                        >Undo</button>
                    </div>
                </div>

                {/* Eraser properties */}
                {activeTool === "eraser" && (
                    <div style={{ padding: 8, borderBottom: "1px solid #444" }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <span style={{ fontSize: 12, color: "#ccc" }}>Brush:</span>
                            <input type="number" min={1} max={100} value={eraserBrush}
                                style={{ ...numInputStyle, width: 48 }}
                                onChange={e => {
                                    const v = Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1));
                                    setEraserBrush(v);
                                    editorState.eraserBrushSize = v;
                                }} />
                            <span style={{ fontSize: 11, color: "#888" }}>{eraserBrush}x{eraserBrush}</span>
                        </div>
                    </div>
                )}

                {/* Terrain properties (shown when terrain tool active) */}
                {activeTool === "terrain" && (
                    <div style={{ padding: 8, borderBottom: "1px solid #444" }}>
                        <div style={{ fontSize: 12, color: "#ccc", marginBottom: 6 }}>Terrain Properties</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: "#ccc", minWidth: 80 }}>Height</span>
                            <input type="number" min={-20} max={20} value={terrainHeight}
                                style={{ ...numInputStyle, width: 56 }}
                                onChange={e => {
                                    const v = Math.max(-20, Math.min(20, parseInt(e.target.value, 10) || 0));
                                    setTerrainHeight(v);
                                    editorState.terrainHeight = v;
                                }} />
                            <span style={{ fontSize: 11, color: "#888" }}>tiles</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: "#ccc", minWidth: 80 }}>Slope Width</span>
                            <input type="number" min={0} max={10} value={terrainSlopeWidth}
                                style={{ ...numInputStyle, width: 56 }}
                                onChange={e => {
                                    const v = Math.max(0, Math.min(10, parseInt(e.target.value, 10) || 0));
                                    setTerrainSlopeWidth(v);
                                    editorState.terrainSlopeWidth = v;
                                }} />
                            <span style={{ fontSize: 11, color: "#888" }}>{terrainSlopeWidth === 0 ? "(walls)" : "tiles"}</span>
                        </div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: "#ccc", minWidth: 80 }}>Brush</span>
                            <input type="number" min={1} max={20} value={terrainBrushSize}
                                style={{ ...numInputStyle, width: 56 }}
                                onChange={e => {
                                    const v = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
                                    setTerrainBrushSize(v);
                                    editorState.terrainBrushSize = v;
                                }} />
                            <span style={{ fontSize: 11, color: "#888" }}>{terrainBrushSize}x{terrainBrushSize}</span>
                        </div>
                        <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                            Click to place terrain at height {terrainHeight}. Shift+click to erase.
                        </div>
                    </div>
                )}

                {/* Mountain properties (shown when mountain tool active) */}
                {activeTool === "mountain" && (
                    <div style={{ padding: 8, borderBottom: "1px solid #444" }}>
                        <div style={{ fontSize: 12, color: "#ccc", marginBottom: 6 }}>Mountain Properties</div>
                        <MtnPropRow label="Border Width" sq={mtnWidthSq} px={mtnWidthPx}
                            onSq={v => setMtnProp("ws", v)} onPx={v => setMtnProp("wp", v)}
                            sqMax={3} pxMax={99} />
                        <MtnPropRow label="Height" sq={mtnHeightSq} px={mtnHeightPx}
                            onSq={v => setMtnProp("hs", v)} onPx={v => setMtnProp("hp", v)}
                            sqMax={10} pxMax={99} />
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#ccc", marginTop: 6, cursor: "pointer" }}>
                            <input type="checkbox" checked={mtnInverted} onChange={e => {
                                setMtnInverted(e.target.checked);
                                editorState.mountainInverted = e.target.checked;
                            }} />
                            Inverted (pit / hole)
                        </label>
                        <div style={{ fontSize: 12, color: "#ccc", marginTop: 8, marginBottom: 6 }}>Mountain Texture</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {MOUNTAIN_TEXTURES.map(t => (
                                <img
                                    key={t}
                                    src={`/tilesets/mountains/${t}.png`}
                                    alt={t}
                                    title={t}
                                    onClick={() => { setMountainTex(t); editorState.mountainTexSrc = `/tilesets/mountains/${t}.png`; }}
                                    style={{
                                        width: 40, height: 40, objectFit: "cover",
                                        imageRendering: "pixelated",
                                        border: mountainTex === t ? "2px solid #4af" : "1px solid #555",
                                        borderRadius: 3, cursor: "pointer",
                                        background: mountainTex === t ? "#335" : "#333",
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Sprite properties */}
                {activeTool === "sprite" && (
                    <div style={{ padding: 8, borderBottom: "1px solid #444" }}>
                        <div style={{ fontSize: 12, color: "#ccc", marginBottom: 6 }}>Sprite Kind</div>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {(["face", "fix", "double", "quadra"] as SpriteKind[]).map(k => (
                                <button key={k} style={toolButtonStyle(spriteKind === k)}
                                    onClick={() => { setSpriteKind(k); editorState.spriteKind = k; }}>
                                    {k.charAt(0).toUpperCase() + k.slice(1)}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Wall properties */}
                {activeTool === "wall" && (
                    <div style={{ padding: 8, borderBottom: "1px solid #444" }}>
                        <label style={{ fontSize: 12, color: "#ccc", display: "flex", alignItems: "center", gap: 6, marginBottom: 6, cursor: "pointer" }}>
                            <input type="checkbox" checked={wall3d}
                                onChange={e => { setWall3d(e.target.checked); editorState.wall3d = e.target.checked; }} />
                            3D Walls (1 tile thick)
                        </label>
                        <div style={{ fontSize: 12, color: "#ccc", marginBottom: 6 }}>Wall Texture</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {WALL_TEXTURES.map(t => (
                                <img
                                    key={t}
                                    src={`/tilesets/walls/${t}.png`}
                                    alt={t}
                                    title={t}
                                    onClick={() => {
                                        setWallTexture(t);
                                        editorState.wallTextureSrc = `/tilesets/walls/${t}.png`;
                                        const reload = (editorState as unknown as Record<string, unknown>)._reloadWallTex;
                                        if (typeof reload === "function") (reload as () => void)();
                                    }}
                                    style={{
                                        width: 40, height: 40, objectFit: "cover",
                                        imageRendering: "pixelated",
                                        border: wallTexture === t ? "2px solid #4af" : "1px solid #555",
                                        borderRadius: 3, cursor: "pointer",
                                        background: wallTexture === t ? "#335" : "#333",
                                    }}
                                />
                            ))}
                        </div>
                        <div style={{ fontSize: 11, marginTop: 6, color: "#999" }}>
                            Click &amp; drag to place a wall line. ESC to cancel.
                        </div>
                    </div>
                )}

                {/* Autotile properties — grouped by file, showing 16x16 top-left thumbnail per set */}
                {activeTool === "autotile" && (
                    <div style={{ padding: 8, borderBottom: "1px solid #444" }}>
                        <div style={{ fontSize: 12, color: "#ccc", marginBottom: 6 }}>Autotile Sets</div>
                        {AUTOTILE_SETS.map(group => (
                            <div key={group.file} style={{ marginBottom: 8 }}>
                                <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{group.file}</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                                    {Array.from({ length: group.count }, (_, i) => {
                                        // For animated sets: idx = row, thumbnail from col 0 of that row
                                        // For non-animated: idx = sequential index across cols×rows
                                        let sx: number, sy: number, realIdx: number;
                                        if (group.animated) {
                                            sx = 0;          // col 0 (first frame)
                                            sy = i * 48;     // row i
                                            realIdx = i * group.cols; // store as row*cols so we know the row
                                        } else {
                                            const col = i % group.cols;
                                            const row = Math.floor(i / group.cols);
                                            sx = col * 32;
                                            sy = row * 48;
                                            realIdx = i;
                                        }
                                        const isSelected = autotileSrc === group.file && autotileIdx === realIdx;
                                        return (
                                            <canvas
                                                key={`${group.file}-${i}`}
                                                title={`${group.file} #${i}`}
                                                width={16}
                                                height={16}
                                                style={{
                                                    width: 32, height: 32,
                                                    imageRendering: "pixelated",
                                                    border: isSelected ? "2px solid #4af" : "1px solid #555",
                                                    borderRadius: 3, cursor: "pointer",
                                                    background: isSelected ? "#335" : "#333",
                                                }}
                                                onClick={() => {
                                                    setAutotileSrc(group.file);
                                                    setAutotileIdx(realIdx);
                                                    editorState.autotileSrc = group.file;
                                                    editorState.autotileIdx = realIdx;
                                                    // Pre-cache atlas for all 4 animation frames if animated
                                                    const fn = (editorState as unknown as Record<string, unknown>)._ensureAutotileAtlas;
                                                    if (typeof fn === "function") {
                                                        const ensure = fn as (src: string, idx: number, cb?: () => void) => void;
                                                        if (group.animated) {
                                                            const row = i;
                                                            for (let f = 0; f < group.cols; f++) ensure(group.file, row * group.cols + f);
                                                        } else {
                                                            ensure(group.file, realIdx);
                                                        }
                                                    }
                                                }}
                                                ref={(canvas) => {
                                                    if (!canvas) return;
                                                    const ctx = canvas.getContext("2d");
                                                    if (!ctx) return;
                                                    const img = new Image();
                                                    img.onload = () => {
                                                        ctx.imageSmoothingEnabled = false;
                                                        ctx.clearRect(0, 0, 16, 16);
                                                        ctx.drawImage(img, sx, sy, 16, 16, 0, 0, 16, 16);
                                                    };
                                                    img.src = `/tilesets/autotiles/${group.file}.png`;
                                                }}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                            <span style={{ fontSize: 12, color: "#ccc" }}>Brush:</span>
                            <input type="number" min={1} max={10} value={autotileBrush}
                                style={{ ...numInputStyle, width: 42 }}
                                onChange={e => {
                                    const v = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
                                    setAutotileBrush(v);
                                    editorState.autotileBrushSize = v;
                                }} />
                            <span style={{ fontSize: 11, color: "#888" }}>{autotileBrush}x{autotileBrush}</span>
                        </div>
                        <div style={{ fontSize: 11, marginTop: 4, color: "#999" }}>
                            Click to paint autotiles. Borders update automatically.
                        </div>
                    </div>
                )}

                {/* Floor tool: brush size, fill mode, custom mode, tileset pagination */}
                {activeTool === "floor" && (
                    <div style={{ padding: 8, borderBottom: "1px solid #444" }}>
                        <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 12, color: "#ccc" }}>Mode:</span>
                            <button style={toolButtonStyle(paintMode === "brush")}
                                onClick={() => { setPaintMode("brush"); editorState.paintMode = "brush"; }}>Brush</button>
                            <button style={toolButtonStyle(paintMode === "fill")}
                                onClick={() => { setPaintMode("fill"); editorState.paintMode = "fill"; }}>Fill</button>
                            {paintMode === "custom" && (
                                <button style={toolButtonStyle(true)}>Custom {floorRect.w}x{floorRect.h}</button>
                            )}
                        </div>
                        {paintMode === "brush" && (
                            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                                <span style={{ fontSize: 12, color: "#ccc" }}>Brush:</span>
                                <input type="number" min={1} max={100} value={brushSize}
                                    style={{ ...numInputStyle, width: 48 }}
                                    onChange={e => {
                                        const v = Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1));
                                        setBrushSize(v);
                                        editorState.brushSize = v;
                                    }} />
                                <span style={{ fontSize: 11, color: "#888" }}>{brushSize}x{brushSize}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Tileset palette with pagination (shown for floor, sprite tools) */}
                {(activeTool === "floor" || activeTool === "sprite" || activeTool === "terrain") && (
                    <div style={{ padding: "4px 8px", borderBottom: "1px solid #444" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <button
                                onClick={() => { const ni = (tilesetIdx - 1 + TILESETS.length) % TILESETS.length; setTilesetIdx(ni); editorState.tilesetSrc = `/tilesets/${TILESETS[ni]}.png`; handleSelectTile({ col: 0, row: 0 }); }}
                                style={{ background: "#444", color: "#fff", border: "1px solid #666", borderRadius: 3, cursor: "pointer", padding: "2px 8px" }}
                            >&lt;</button>
                            <span style={{ fontSize: 12, color: "#ccc" }}>{TILESETS[tilesetIdx]}</span>
                            <button
                                onClick={() => { const ni = (tilesetIdx + 1) % TILESETS.length; setTilesetIdx(ni); editorState.tilesetSrc = `/tilesets/${TILESETS[ni]}.png`; handleSelectTile({ col: 0, row: 0 }); }}
                                style={{ background: "#444", color: "#fff", border: "1px solid #666", borderRadius: 3, cursor: "pointer", padding: "2px 8px" }}
                            >&gt;</button>
                        </div>
                    </div>
                )}
                {(activeTool === "floor" || activeTool === "terrain") && (
                    <TilesetPalette
                        tilesetSrc={currentTilesetSrc}
                        selectedTile={selectedTile}
                        onSelectTile={handleSelectTile}
                        allowRect
                        selectionRect={paintMode === "custom" ? floorRect : undefined}
                        onSelectRect={(rect) => {
                            setFloorRect(rect);
                            editorState.floorRect = rect;
                            if (rect.w > 1 || rect.h > 1) {
                                setPaintMode("custom");
                                editorState.paintMode = "custom";
                            }
                        }}
                    />
                )}
                {activeTool === "sprite" && (
                    <TilesetPalette
                        tilesetSrc={currentTilesetSrc}
                        selectedTile={selectedTile}
                        onSelectTile={handleSelectTile}
                        allowRect
                        selectionRect={spriteRect}
                        onSelectRect={(rect) => {
                            setSpriteRect(rect);
                            editorState.spriteWidth = rect.w;
                            editorState.spriteHeight = rect.h;
                        }}
                    />
                )}

                </div>)}{/* end tools tab */}
            </div>
        </div>
    );
};
