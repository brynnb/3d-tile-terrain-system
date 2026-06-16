/**
 * Mountain atlas generator.
 *
 * Takes a 3×3 tile source image (3*SQUARE_SIZE × 3*SQUARE_SIZE) and composites
 * it into a 4×4 tile atlas (4*SQUARE_SIZE × 4*SQUARE_SIZE).
 *
 * Atlas layout (each cell is SQUARE_SIZE × SQUARE_SIZE):
 *   Col 0-2, Row 0-2: Original 3×3 image
 *   Col 3,   Row 0-2: Left/right auto-edge (left-half of col0 + right-half of col2)
 *   Row 3,   Col 0-2: Top/bot auto-edge (top-half of row0 + bottom-half of row2)
 *   Col 3,   Row 3:   All-sides auto (corner pieces from all 4 corners)
 */

import { SQUARE_SIZE } from "./Constants";

/**
 * Generate a 4×4 mountain atlas from a 3×3 source image.
 * Returns a canvas element that can be used as a texture source.
 */
export function generateMountainAtlas(sourceImg: HTMLImageElement): HTMLCanvasElement {
    const S = SQUARE_SIZE;
    const sourceSize = 3 * S;
    const sDiv = Math.round(S / 2);
    const atlasSize = 4 * S;

    const canvas = document.createElement("canvas");
    canvas.width = atlasSize;
    canvas.height = atlasSize;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;

    // Draw original 3×3 image at top-left
    ctx.drawImage(sourceImg, 0, 0);

    // Col 3, Rows 0-2: left/right auto-edges
    // For each of the 3 rows, copy the left half of col 0 and right half of col 2
    for (let i = 0; i < 3; i++) {
        // Left half of leftmost column
        ctx.drawImage(sourceImg,
            0, i * S, sDiv, S,
            sourceSize, i * S, sDiv, S);
        // Right half of rightmost column
        ctx.drawImage(sourceImg,
            sourceSize - sDiv, i * S, sDiv, S,
            sourceSize + sDiv, i * S, sDiv, S);
    }

    // Row 3, Cols 0-2: top/bot auto-edges
    // For each of the 3 columns, copy the top half of row 0 and bottom half of row 2
    for (let i = 0; i < 3; i++) {
        // Top half of topmost row
        ctx.drawImage(sourceImg,
            i * S, 0, S, sDiv,
            i * S, sourceSize, S, sDiv);
        // Bottom half of bottommost row
        ctx.drawImage(sourceImg,
            i * S, sourceSize - sDiv, S, sDiv,
            i * S, sourceSize + sDiv, S, sDiv);
    }

    // Col 3, Row 3: all-sides auto (corner pieces)
    // Top-left corner
    ctx.drawImage(sourceImg,
        0, 0, sDiv, sDiv,
        sourceSize, sourceSize, sDiv, sDiv);
    // Top-right corner
    ctx.drawImage(sourceImg,
        sourceSize - sDiv, 0, sDiv, sDiv,
        sourceSize + sDiv, sourceSize, sDiv, sDiv);
    // Bottom-left corner
    ctx.drawImage(sourceImg,
        0, sourceSize - sDiv, sDiv, sDiv,
        sourceSize, sourceSize + sDiv, sDiv, sDiv);
    // Bottom-right corner
    ctx.drawImage(sourceImg,
        sourceSize - sDiv, sourceSize - sDiv, sDiv, sDiv,
        sourceSize + sDiv, sourceSize + sDiv, sDiv, sDiv);

    return canvas;
}
