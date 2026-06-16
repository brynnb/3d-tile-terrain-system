/**
 * Core terrain and map constants.
 */

/** Default tile size in world units (pixels in RPM). */
export const SQUARE_SIZE = 16;

/** Number of tiles per portion axis. Portions are PORTION_SIZE^3 cubes. */
export const PORTION_SIZE = 16;

/** Small UV inset to avoid texture bleeding at tile edges. */
export const COEF_TEX = 0.2;
