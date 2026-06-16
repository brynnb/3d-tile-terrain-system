/**
 * Catalog of 3D objects: mesh name → available texture names.
 * Entries with mesh="_box" use a generated box shape instead of an OBJ file.
 * Box dimensions from RPM specialElements.json:
 *   ws/wp = width in squares + pixels (pixel is % of SQUARE_SIZE)
 *   hs/hp = height in squares + pixels
 *   ds/dp = depth in squares + pixels
 */
export interface Object3DCatalogEntry {
    mesh: string;
    textures: string[];
    /** Box dimensions — only used when mesh === "_box" */
    ws?: number; wp?: number;
    hs?: number; hp?: number;
    ds?: number; dp?: number;
}

export const OBJECTS3D_CATALOG: Object3DCatalogEntry[] = [
    // --- Custom OBJ meshes ---
    { mesh: "barrel", textures: ["barrel", "barrel-closed", "barrel-fruits", "barrel-vegetables"] },
    { mesh: "car", textures: ["car-black", "car-blue", "car-green", "car-red", "car-white"] },
    { mesh: "chair", textures: ["chair-blue", "chair-green", "chair-red", "chair-white"] },
    { mesh: "chest-opened", textures: ["chest-opened1", "chest-opened2"] },
    { mesh: "house1", textures: ["house-brick-blue", "house-brick-blue-snow", "house-brick-green", "house-brick-green-snow", "house-brick-red", "house-brick-red-snow", "house-stone-blue", "house-stone-blue-snow", "house-stone-green", "house-stone-green-snow", "house-stone-red", "house-stone-red-snow", "house-wood-blue", "house-wood-blue-snow", "house-wood-green", "house-wood-green-snow", "house-wood-red", "house-wood-red-snow"] },
    { mesh: "sink", textures: ["sink"] },
    { mesh: "sofa", textures: ["sofa-black", "sofa-blue", "sofa-green", "sofa-red", "sofa-white"] },
    { mesh: "tent", textures: ["tent"] },
    { mesh: "toilet", textures: ["toilet"] },
    { mesh: "woodfence1", textures: ["woodfence", "woodfence-snow"] },
    { mesh: "woodfence2", textures: ["woodfence", "woodfence-snow"] },
    { mesh: "woodfence3", textures: ["woodfence", "woodfence-snow"] },
    // --- Box-shaped objects (dimensions from RPM specialElements.json) ---
    { mesh: "_box", textures: ["chest-small-opened", "chest-small-opened-blue", "chest-small-opened-green", "chest-small-opened-red"], ws: 1, wp: 0, hs: 0, hp: 25, ds: 0, dp: 50 },
    { mesh: "_box", textures: ["chest-small", "chest-small-blue", "chest-small-green", "chest-small-red"], ws: 1, wp: 0, hs: 0, hp: 50, ds: 0, dp: 50 },
    { mesh: "_box", textures: ["chest-opened1", "table-small"], ws: 1, wp: 0, hs: 0, hp: 50, ds: 1, dp: 0 },
    { mesh: "_box", textures: ["cabinets1", "cabinets2"], ws: 1, wp: 0, hs: 0, hp: 75, ds: 1, dp: 0 },
    { mesh: "_box", textures: ["chest", "log-small", "chimney-brick", "chimney-stone", "cabinets3", "crate", "cube-cobblestone"], ws: 1, wp: 0, hs: 1, hp: 0, ds: 1, dp: 0 },
    { mesh: "_box", textures: ["bookshelf-small"], ws: 1, wp: 0, hs: 2, hp: 0, ds: 0, dp: 50 },
    { mesh: "_box", textures: ["fridge"], ws: 1, wp: 0, hs: 2, hp: 0, ds: 1, dp: 0 },
    { mesh: "_box", textures: ["minecart"], ws: 1, wp: 25, hs: 1, hp: 0, ds: 1, dp: 0 },
    { mesh: "_box", textures: ["tv-small"], ws: 1, wp: 56, hs: 1, hp: 0, ds: 1, dp: 0 },
    { mesh: "_box", textures: ["bench-stone", "bench-wood"], ws: 2, wp: 0, hs: 0, hp: 25, ds: 0, dp: 50 },
    { mesh: "_box", textures: ["picnic-table-stone", "picnic-table-wood", "bed-black", "bed-blue", "bed-green", "bed-red", "bed-white", "table", "bath"], ws: 2, wp: 0, hs: 0, hp: 50, ds: 1, dp: 0 },
    { mesh: "_box", textures: ["bed-big-black", "bed-big-blue", "bed-big-green", "bed-big-red", "bed-big-white"], ws: 2, wp: 0, hs: 0, hp: 50, ds: 2, dp: 0 },
    { mesh: "_box", textures: ["log"], ws: 2, wp: 0, hs: 1, hp: 0, ds: 1, dp: 0 },
    { mesh: "_box", textures: ["tv"], ws: 2, wp: 0, hs: 1, hp: 50, ds: 0, dp: 18 },
    { mesh: "_box", textures: ["shop-stand-black", "shop-stand-blue", "shop-stand-green", "shop-stand-red", "shop-stand-white", "dresser", "bookshelf"], ws: 2, wp: 0, hs: 2, hp: 0, ds: 1, dp: 0 },
    { mesh: "_box", textures: ["bus"], ws: 2, wp: 0, hs: 2, hp: 0, ds: 6, dp: 0 },
    { mesh: "_box", textures: ["table-big"], ws: 3, wp: 0, hs: 0, hp: 50, ds: 2, dp: 0 },
    { mesh: "_box", textures: ["log-big"], ws: 3, wp: 0, hs: 1, hp: 0, ds: 1, dp: 0 },
    { mesh: "_box", textures: ["shop-stand-big-black", "shop-stand-big-black-snow", "shop-stand-big-blue", "shop-stand-big-blue-snow", "shop-stand-big-green", "shop-stand-big-green-snow", "shop-stand-big-red", "shop-stand-big-red-snow", "shop-stand-big-white", "shop-stand-big-white-snow"], ws: 4, wp: 0, hs: 2, hp: 0, ds: 3, dp: 0 },
    { mesh: "_box", textures: ["building-brick", "building-stone", "building-wood"], ws: 4, wp: 0, hs: 4, hp: 0, ds: 4, dp: 0 },
    { mesh: "_box", textures: ["building-brick-big", "building-stone-big", "building-wood-big"], ws: 6, wp: 0, hs: 6, hp: 0, ds: 6, dp: 0 },
    { mesh: "_box", textures: ["template"], ws: 1, wp: 0, hs: 1, hp: 0, ds: 1, dp: 0 },
];
