/**
 * Tile position in the map.
 *
 * RPM position array format:
 *   [x, y, z, yPixels, layer, centerX, centerZ, angleY, angleX, angleZ, scaleX, scaleY, scaleZ]
 *   Index mapping: 0=x, 1=y, 3=z, 2=yPixels, 4=layer, 5=centerX, 6=centerZ, 7+=angles/scales
 */

import { SQUARE_SIZE, PORTION_SIZE } from "./Constants";
import { Portion } from "./Portion";

export class Position {
    public x: number;
    public y: number;
    public z: number;
    public yPixels: number;
    public layer: number;
    public centerX: number;
    public centerZ: number;
    public angleY: number;
    public angleX: number;
    public angleZ: number;
    public scaleX: number;
    public scaleY: number;
    public scaleZ: number;

    constructor(
        x = 0, y = 0, z = 0, yPixels = 0, layer = 0,
        centerX = 50, centerZ = 50,
        angleY = 0, angleX = 0, angleZ = 0,
        scaleX = 1, scaleY = 1, scaleZ = 1
    ) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.yPixels = yPixels;
        this.layer = layer;
        this.centerX = centerX;
        this.centerZ = centerZ;
        this.angleY = angleY;
        this.angleX = angleX;
        this.angleZ = angleZ;
        this.scaleX = scaleX;
        this.scaleY = scaleY;
        this.scaleZ = scaleZ;
    }

    /**
     * Create from RPM JSON array.
     * Note the quirky index order: [x, y, yPixels, z, layer, centerX, centerZ, ...]
     */
    static createFromArray(arr: number[]): Position {
        return new Position(
            arr[0],             // x
            arr[1],             // y
            arr[3],             // z   (index 3, not 2!)
            arr[2],             // yPixels (index 2)
            arr[4] ?? 0,        // layer
            arr[5] ?? 50,       // centerX
            arr[6] ?? 50,       // centerZ
            arr[7] ?? 0,        // angleY
            arr[8] ?? 0,        // angleX
            arr[9] ?? 0,        // angleZ
            arr[10] ?? 1,       // scaleX
            arr[11] ?? 1,       // scaleY
            arr[12] ?? 1        // scaleZ
        );
    }

    /** Total Y in world units. */
    getTotalY(): number {
        return (this.y * SQUARE_SIZE) + (this.yPixels * SQUARE_SIZE / 100);
    }

    /** Convert to a world-space 3D coordinate (no center offset). */
    toVector3(center = true): { x: number; y: number; z: number } {
        return {
            x: (this.x * SQUARE_SIZE) + (center ? (this.centerX / 100 * SQUARE_SIZE) : 0),
            y: (this.y * SQUARE_SIZE) + (this.yPixels * SQUARE_SIZE / 100),
            z: (this.z * SQUARE_SIZE) + (center ? (this.centerZ / 100 * SQUARE_SIZE) : 0),
        };
    }

    /** Get the global portion this position belongs to. */
    getGlobalPortion(): Portion {
        return new Portion(
            Math.floor(this.x / PORTION_SIZE),
            Math.floor(this.y / PORTION_SIZE),
            Math.floor(this.z / PORTION_SIZE)
        );
    }

    /** Index within a portion's flat array (used for bounding boxes). */
    toIndex(): number {
        const mod = (n: number, m: number) => ((n % m) + m) % m;
        return (this.x % PORTION_SIZE)
            + (mod(this.y, PORTION_SIZE) * PORTION_SIZE)
            + ((this.z % PORTION_SIZE) * PORTION_SIZE * PORTION_SIZE);
    }
}
