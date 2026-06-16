/**
 * Portion coordinate (chunk address in the map grid).
 */

import { PORTION_SIZE } from "./Constants";

export class Portion {
    public x: number;
    public y: number;
    public z: number;

    constructor(x: number = 0, y: number = 0, z: number = 0) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    equals(other: Portion): boolean {
        return this.x === other.x && this.y === other.y && this.z === other.z;
    }

    getFileName(): string {
        return `${this.x}_${this.y}_${this.z}.json`;
    }

    static createFromVector3(pos: { x: number; y: number; z: number }): Portion {
        return new Portion(
            Math.floor(pos.x / (PORTION_SIZE * 16)), // squareSize assumed 16
            Math.floor(pos.y / (PORTION_SIZE * 16)),
            Math.floor(pos.z / (PORTION_SIZE * 16))
        );
    }
}
