#!/usr/bin/env python3
from pathlib import Path
import struct
import zlib


BG = (11, 11, 15, 255)
BLUE = (39, 92, 182, 255)
WHITE = (245, 248, 255, 255)
MUTED = (159, 181, 224, 255)

DIGITS = {
    "7": ("111", "001", "001", "010", "010", "100", "100"),
    "3": ("111", "001", "001", "111", "001", "001", "111"),
}

LETTERS = {
    "O": ("111", "101", "101", "101", "101", "101", "111"),
    "P": ("110", "101", "101", "110", "100", "100", "100"),
    "S": ("111", "100", "100", "111", "001", "001", "111"),
}


def put_px(buf, size, x, y, color):
    if 0 <= x < size and 0 <= y < size:
        buf[y][x] = color


def rect(buf, size, x, y, w, h, color):
    for yy in range(max(0, y), min(size, y + h)):
        row = buf[yy]
        for xx in range(max(0, x), min(size, x + w)):
            row[xx] = color


def line(buf, size, x0, y0, x1, y1, color, thickness=1):
    dx = abs(x1 - x0)
    dy = -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    while True:
        r = max(1, thickness) // 2
        rect(buf, size, x0 - r, y0 - r, thickness, thickness, color)
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def draw_bitmap_text(buf, size, text, x, y, scale, color, alphabet):
    cursor = x
    for char in text:
        if char == " ":
            cursor += 2 * scale
            continue
        glyph = alphabet[char]
        for row_i, row in enumerate(glyph):
            for col_i, bit in enumerate(row):
                if bit == "1":
                    rect(buf, size, cursor + col_i * scale, y + row_i * scale, scale, scale, color)
        cursor += (len(glyph[0]) + 1) * scale


def draw_plane(buf, size):
    y = int(size * 0.80)
    x0 = int(size * 0.19)
    x1 = int(size * 0.81)
    t = max(3, size // 42)
    line(buf, size, x0, y, x1, y, WHITE, t)
    line(buf, size, x1, y, x1 - int(size * 0.08), y - int(size * 0.035), WHITE, t)
    line(buf, size, x1, y, x1 - int(size * 0.08), y + int(size * 0.035), WHITE, t)
    line(buf, size, int(size * 0.45), y, int(size * 0.32), y + int(size * 0.10), WHITE, t)
    line(buf, size, int(size * 0.53), y, int(size * 0.42), y - int(size * 0.085), WHITE, t)
    line(buf, size, x0 + int(size * 0.03), y, x0 - int(size * 0.02), y - int(size * 0.06), WHITE, t)
    line(buf, size, x0 + int(size * 0.04), y, x0 - int(size * 0.02), y + int(size * 0.045), WHITE, t)


def png_chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, pixels):
    size = len(pixels)
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b, a in row:
            raw.extend((r, g, b, a))
    data = b"".join([
        b"\x89PNG\r\n\x1a\n",
        png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)),
        png_chunk(b"IDAT", zlib.compress(bytes(raw), 9)),
        png_chunk(b"IEND", b""),
    ])
    path.write_bytes(data)


def build_icon(size):
    pixels = [[BG for _ in range(size)] for _ in range(size)]
    border = max(5, size // 24)
    rect(pixels, size, 0, 0, size, border, BLUE)
    rect(pixels, size, 0, size - border, size, border, BLUE)
    rect(pixels, size, 0, 0, border, size, BLUE)
    rect(pixels, size, size - border, 0, border, size, BLUE)

    digit_scale = max(10, size // 15)
    digit_width = (3 * digit_scale * 3) + (digit_scale * 2)
    draw_bitmap_text(pixels, size, "737", (size - digit_width) // 2, int(size * 0.18), digit_scale, WHITE, DIGITS)

    ops_scale = max(4, size // 37)
    ops_width = (3 * ops_scale * 3) + (ops_scale * 2)
    draw_bitmap_text(pixels, size, "OPS", (size - ops_width) // 2, int(size * 0.55), ops_scale, MUTED, LETTERS)
    draw_plane(pixels, size)
    return pixels


def main():
    icons = Path("icons")
    icons.mkdir(exist_ok=True)
    for size in (192, 512):
        write_png(icons / f"icon-{size}.png", build_icon(size))


if __name__ == "__main__":
    main()
