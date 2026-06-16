/**
 * AutotileAtlas — pre-generates the autotile lookup atlas from a source image.
 *
 * RPM autotile source format: 2×3 half-tiles (each half-tile = SQUARE_SIZE/2 × SQUARE_SIZE/2)
 * The source image contains mini-tiles arranged in a 4×6 grid of half-tiles:
 *
 *   Col0  Col1  Col2  Col3
 *  +-----+-----+-----+-----+
 *  |  0  |  1  |  2  |  3  |  Row0
 *  +-----+-----+-----+-----+
 *  |  4  |  5  |  6  |  7  |  Row1
 *  +-----+-----+-----+-----+
 *  |  8  |  9  | 10  | 11  |  Row2
 *  +-----+-----+-----+-----+
 *  | 12  | 13  | 14  | 15  |  Row3
 *  +-----+-----+-----+-----+
 *  | 16  | 17  | 18  | 19  |  Row4
 *  +-----+-----+-----+-----+
 *  | 20  | 21  | 22  | 23  |  Row5
 *  +-----+-----+-----+-----+
 *
 * RPM's AUTOTILE_BORDER maps corner+state to mini-tile index.
 * Each full tile is composed of 4 corner mini-tiles: A(top-left), B(top-right), C(bottom-left), D(bottom-right).
 *
 * For each neighbor configuration we pick the correct state for each corner:
 *   State 1: interior (all neighbors present)
 *   State 2: edge (missing cardinal neighbor)
 *   State 3: corner (missing diagonal but has both cardinals)
 *   State 4: outer corner (missing one cardinal)
 *   State 5: isolated (missing both cardinals)
 *
 * We generate 47 standard autotile patterns (RPM Wang tile set) into an atlas.
 */

import { SQUARE_SIZE } from "./Constants";

const HALF = SQUARE_SIZE / 2;

// Mini-tile index from AUTOTILE_BORDER (maps "Corner+State" to index in 4×6 grid)
const BORDER: Record<string, number> = {
    "A1": 2, "B1": 3, "C1": 6, "D1": 7,
    "A2": 8, "B4": 9, "A4": 10, "B2": 11,
    "C5": 12, "D3": 13, "C3": 14, "D5": 15,
    "A5": 16, "B3": 17, "A3": 18, "B5": 19,
    "C2": 20, "D4": 21, "C4": 22, "D2": 23,
};

function getMiniTilePos(index: number): { sx: number; sy: number } {
    const col = index % 4;
    const row = Math.floor(index / 4);
    return { sx: col * HALF, sy: row * HALF };
}

/**
 * Determine which mini-tile state to use for each corner based on neighbors.
 * Returns [stateA, stateB, stateC, stateD] (0-4 each).
 *
 * States per corner:
 *   0 = inside corner (has both cardinals but missing diagonal)
 *   1 = outer corner (missing both cardinals)
 *   2 = interior (has both cardinals AND diagonal)
 *   3 = edge (missing horizontal cardinal, has vertical)
 *   4 = edge (missing vertical cardinal, has horizontal)
 */
function getCornerStates(
    top: boolean, right: boolean, bottom: boolean, left: boolean,
    tl: boolean, tr: boolean, br: boolean, bl: boolean
): [number, number, number, number] {
    // Corner A (top-left): depends on left, top, topLeft
    let a: number;
    if (!left && !top) a = 1;
    else if (!top && left) a = 3;
    else if (!left && top) a = 4;
    else if (left && top && tl) a = 2;
    else a = 0;

    // Corner B (top-right): depends on right, top, topRight
    let b: number;
    if (!right && !top) b = 1;
    else if (!top && right) b = 3;
    else if (!right && top) b = 4;
    else if (right && top && tr) b = 2;
    else b = 0;

    // Corner C (bottom-left): depends on left, bottom, bottomLeft
    let c: number;
    if (!left && !bottom) c = 1;
    else if (!bottom && left) c = 3;
    else if (!left && bottom) c = 4;
    else if (left && bottom && bl) c = 2;
    else c = 0;

    // Corner D (bottom-right): depends on right, bottom, bottomRight
    let d: number;
    if (!right && !bottom) d = 1;
    else if (!bottom && right) d = 3;
    else if (!right && bottom) d = 4;
    else if (right && bottom && br) d = 2;
    else d = 0;

    return [a, b, c, d];
}

/**
 * Get the autotile tile ID for a given neighbor configuration.
 * neighbors: [top, right, bottom, left, topLeft, topRight, bottomRight, bottomLeft]
 * tileID = a*125 + b*25 + c*5 + d (matching RPM atlas layout: a outer, d inner)
 */
export function getAutotileTileID(neighbors: boolean[]): number {
    const [top, right, bottom, left, tl, tr, br, bl] = neighbors;
    const [a, b, c, d] = getCornerStates(top, right, bottom, left, tl, tr, br, bl);
    return a * 125 + b * 25 + c * 5 + d;
}

/**
 * Generate the autotile atlas from a source image.
 * The atlas contains all 625 possible tile combinations arranged in a grid.
 * Atlas layout: 64 tiles wide, ceil(625/64) = 10 rows.
 * Each tile is SQUARE_SIZE × SQUARE_SIZE.
 *
 * @param sourceImg The autotile source image (2×SQUARE_SIZE wide, 3×SQUARE_SIZE tall per unit)
 * @param autotileIndex Which autotile in the source (for multi-autotile images)
 */
export function generateAutotileAtlas(sourceImg: HTMLImageElement, autotileIndex = 0): HTMLCanvasElement {
    const srcW = 2 * SQUARE_SIZE;
    const offsetX = (autotileIndex % Math.floor(sourceImg.width / srcW)) * srcW;
    const offsetY = Math.floor(autotileIndex / Math.floor(sourceImg.width / srcW)) * 3 * SQUARE_SIZE;

    const COLS = 64;
    const TOTAL = 625;
    const ROWS = Math.ceil(TOTAL / COLS);

    const canvas = document.createElement("canvas");
    canvas.width = COLS * SQUARE_SIZE;
    canvas.height = ROWS * SQUARE_SIZE;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // Atlas generation matches RPM: a outer → d inner, sequential placement
    // States 0-4, BORDER keys use 1-indexed (state+1)
    const drawCorner = (corner: string, state: number, destX: number, destY: number, dx: number, dy: number) => {
        const key = `${corner}${state + 1}`;
        const idx = BORDER[key];
        if (idx === undefined) return;
        const { sx, sy } = getMiniTilePos(idx);
        ctx.drawImage(sourceImg,
            sx + offsetX, sy + offsetY, HALF, HALF,
            destX + dx, destY + dy, HALF, HALF);
    };

    let tileID = 0;
    for (let a = 0; a < 5; a++) {
        for (let b = 0; b < 5; b++) {
            for (let c = 0; c < 5; c++) {
                for (let d = 0; d < 5; d++) {
                    const destX = (tileID % COLS) * SQUARE_SIZE;
                    const destY = Math.floor(tileID / COLS) * SQUARE_SIZE;
                    drawCorner("A", a, destX, destY, 0, 0);
                    drawCorner("B", b, destX, destY, HALF, 0);
                    drawCorner("C", c, destX, destY, 0, HALF);
                    drawCorner("D", d, destX, destY, HALF, HALF);
                    tileID++;
                }
            }
        }
    }

    return canvas;
}

/**
 * Count how many autotile units are in a source image.
 * Each unit is 2×SQUARE_SIZE wide, 3×SQUARE_SIZE tall.
 */
export function countAutotileUnits(imgWidth: number, imgHeight: number): number {
    const cols = Math.floor(imgWidth / (2 * SQUARE_SIZE));
    const rows = Math.floor(imgHeight / (3 * SQUARE_SIZE));
    return cols * rows;
}
