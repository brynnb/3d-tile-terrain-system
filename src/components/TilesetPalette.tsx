/**
 * TilesetPalette — displays the tileset image as a grid of selectable tiles.
 * Click a tile to select it for painting. Shows selection highlight.
 * When allowRect is true, click-and-drag selects a rectangular region of tiles.
 */

import React, { useRef, useEffect, useState, useCallback } from "react";
import { SelectedTile } from "../editor/MapEditorState";
import { SQUARE_SIZE } from "../terrain/Constants";

export interface TileRect {
    col: number;
    row: number;
    w: number;
    h: number;
}

interface TilesetPaletteProps {
    tilesetSrc: string;
    selectedTile: SelectedTile;
    onSelectTile: (tile: SelectedTile) => void;
    /** When true, click-and-drag selects a rectangle of tiles */
    allowRect?: boolean;
    /** Called when a rectangle is selected (only when allowRect=true) */
    onSelectRect?: (rect: TileRect) => void;
    /** Current selection rect (for highlighting) */
    selectionRect?: TileRect;
}

const DISPLAY_SCALE = 2; // Scale up the tiny 16px tiles for visibility

export const TilesetPalette: React.FC<TilesetPaletteProps> = ({
    tilesetSrc,
    selectedTile,
    onSelectTile,
    allowRect = false,
    onSelectRect,
    selectionRect,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const [cols, setCols] = useState(0);
    const [rows, setRows] = useState(0);
    const dragStartRef = useRef<{ col: number; row: number } | null>(null);
    const [dragRect, setDragRect] = useState<TileRect | null>(null);

    // Use selectionRect for highlight if provided, otherwise fall back to single tile
    const highlightRect: TileRect = selectionRect ?? { col: selectedTile.col, row: selectedTile.row, w: 1, h: 1 };

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const img = imgRef.current;
        if (!canvas || !img) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Grid lines
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = 1;
        const tileW = SQUARE_SIZE * DISPLAY_SCALE;
        const tileH = SQUARE_SIZE * DISPLAY_SCALE;
        for (let x = 0; x <= cols; x++) {
            ctx.beginPath();
            ctx.moveTo(x * tileW + 0.5, 0);
            ctx.lineTo(x * tileW + 0.5, canvas.height);
            ctx.stroke();
        }
        for (let y = 0; y <= rows; y++) {
            ctx.beginPath();
            ctx.moveTo(0, y * tileH + 0.5);
            ctx.lineTo(canvas.width, y * tileH + 0.5);
            ctx.stroke();
        }

        // Active drag rect (blue, dashed)
        const dr = dragRect;
        if (dr) {
            ctx.strokeStyle = "#4af";
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(
                dr.col * tileW + 1,
                dr.row * tileH + 1,
                dr.w * tileW - 2,
                dr.h * tileH - 2
            );
            ctx.setLineDash([]);
        }

        // Selection highlight (yellow)
        const hr = highlightRect;
        ctx.strokeStyle = "#ff0";
        ctx.lineWidth = 2;
        ctx.strokeRect(
            hr.col * tileW + 1,
            hr.row * tileH + 1,
            hr.w * tileW - 2,
            hr.h * tileH - 2
        );
    }, [cols, rows, highlightRect, dragRect]);

    useEffect(() => {
        const img = new Image();
        img.onload = () => {
            imgRef.current = img;
            const c = Math.floor(img.width / SQUARE_SIZE);
            const r = Math.floor(img.height / SQUARE_SIZE);
            setCols(c);
            setRows(r);

            const canvas = canvasRef.current;
            if (canvas) {
                canvas.width = c * SQUARE_SIZE * DISPLAY_SCALE;
                canvas.height = r * SQUARE_SIZE * DISPLAY_SCALE;
                // Draw immediately — don't wait for React state update cycle
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    ctx.imageSmoothingEnabled = false;
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                }
            }
        };
        img.src = tilesetSrc;
    }, [tilesetSrc]);

    useEffect(() => {
        draw();
    }, [draw]);

    const getTileAt = (e: React.MouseEvent<HTMLCanvasElement>): { col: number; row: number } | null => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const px = (e.clientX - rect.left) * scaleX;
        const py = (e.clientY - rect.top) * scaleY;
        const col = Math.floor(px / (SQUARE_SIZE * DISPLAY_SCALE));
        const row = Math.floor(py / (SQUARE_SIZE * DISPLAY_SCALE));
        if (col >= 0 && col < cols && row >= 0 && row < rows) {
            return { col, row };
        }
        return null;
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const tile = getTileAt(e);
        if (!tile) return;
        if (allowRect) {
            dragStartRef.current = tile;
            setDragRect({ col: tile.col, row: tile.row, w: 1, h: 1 });
        }
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!allowRect || !dragStartRef.current) return;
        const tile = getTileAt(e);
        if (!tile) return;
        const start = dragStartRef.current;
        const minCol = Math.min(start.col, tile.col);
        const minRow = Math.min(start.row, tile.row);
        const maxCol = Math.max(start.col, tile.col);
        const maxRow = Math.max(start.row, tile.row);
        setDragRect({ col: minCol, row: minRow, w: maxCol - minCol + 1, h: maxRow - minRow + 1 });
    };

    const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const tile = getTileAt(e);
        if (!tile) {
            dragStartRef.current = null;
            setDragRect(null);
            return;
        }

        if (allowRect && dragStartRef.current) {
            const start = dragStartRef.current;
            const minCol = Math.min(start.col, tile.col);
            const minRow = Math.min(start.row, tile.row);
            const maxCol = Math.max(start.col, tile.col);
            const maxRow = Math.max(start.row, tile.row);
            const rect: TileRect = { col: minCol, row: minRow, w: maxCol - minCol + 1, h: maxRow - minRow + 1 };
            onSelectTile({ col: minCol, row: minRow });
            onSelectRect?.(rect);
            dragStartRef.current = null;
            setDragRect(null);
        } else {
            onSelectTile(tile);
        }
    };

    const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        // For non-rect mode, use click; for rect mode, mouseUp handles it
        if (allowRect) return;
        const tile = getTileAt(e);
        if (tile) onSelectTile(tile);
    };

    return (
        <div style={{ padding: 8 }}>
            <div style={{ fontSize: 12, marginBottom: 4, color: "#ccc" }}>
                Tileset Palette{allowRect ? " (drag to select region)" : ""}
            </div>
            <canvas
                ref={canvasRef}
                onClick={handleClick}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                style={{
                    cursor: "pointer",
                    imageRendering: "pixelated",
                    width: cols * SQUARE_SIZE * DISPLAY_SCALE,
                    maxWidth: "100%",
                }}
            />
            <div style={{ fontSize: 11, marginTop: 4, color: "#999" }}>
                Selected: ({highlightRect.col}, {highlightRect.row}) {highlightRect.w > 1 || highlightRect.h > 1 ? `${highlightRect.w}×${highlightRect.h}` : ""}
            </div>
        </div>
    );
};
