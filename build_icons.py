#!/usr/bin/env python3
from pathlib import Path
import struct
import zlib


BG_TOP = (24, 33, 31, 255)
BG_BOTTOM = (8, 13, 13, 255)
TEAL = (57, 216, 200, 255)
TEAL_DARK = (22, 120, 113, 255)
AMBER = (246, 183, 76, 255)
WHITE = (244, 250, 249, 255)
MUTED = (148, 178, 173, 255)

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


def blend(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(4))


def polygon(buf, size, points, color):
    min_y = max(0, min(y for _, y in points))
    max_y = min(size - 1, max(y for _, y in points))
    for y in range(min_y, max_y + 1):
        intersections = []
        for i, (x1, y1) in enumerate(points):
            x2, y2 = points[(i + 1) % len(points)]
            if y1 == y2:
                continue
            if (y >= min(y1, y2)) and (y < max(y1, y2)):
                intersections.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        intersections.sort()
        for start, end in zip(intersections[0::2], intersections[1::2]):
            rect(buf, size, round(start), y, max(1, round(end - start)), 1, color)


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


def draw_heading_mark(buf, size):
    cx = size // 2
    top = int(size * 0.70)
    tip = int(size * 0.85)
    span = int(size * 0.19)
    inner = int(size * 0.055)
    polygon(
        buf,
        size,
        [
            (cx, top),
            (cx + span, tip),
            (cx + inner, tip - int(size * 0.018)),
            (cx, tip - int(size * 0.075)),
            (cx - inner, tip - int(size * 0.018)),
            (cx - span, tip),
        ],
        TEAL,
    )
    polygon(
        buf,
        size,
        [
            (cx, top + int(size * 0.045)),
            (cx + int(size * 0.075), tip - int(size * 0.025)),
            (cx, tip - int(size * 0.058)),
            (cx - int(size * 0.075), tip - int(size * 0.025)),
        ],
        BG_BOTTOM,
    )


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
    pixels = []
    for y in range(size):
        pixels.append([blend(BG_TOP, BG_BOTTOM, y / max(1, size - 1)) for _ in range(size)])

    border = max(4, size // 34)
    inset = max(10, size // 18)
    rect(pixels, size, inset, inset, size - inset * 2, border, TEAL_DARK)
    rect(pixels, size, inset, size - inset - border, size - inset * 2, border, TEAL_DARK)
    rect(pixels, size, inset, inset, border, size - inset * 2, TEAL_DARK)
    rect(pixels, size, size - inset - border, inset, border, size - inset * 2, TEAL_DARK)
    rect(pixels, size, inset + border, inset + border, size - (inset + border) * 2, max(2, border // 2), TEAL)

    digit_scale = max(10, size // 14)
    digit_width = (3 * digit_scale * 3) + (digit_scale * 2)
    draw_bitmap_text(
        pixels,
        size,
        "737",
        (size - digit_width) // 2,
        int(size * 0.17),
        digit_scale,
        WHITE,
        DIGITS,
    )

    ops_scale = max(4, size // 34)
    ops_width = (3 * ops_scale * 3) + (ops_scale * 2)
    draw_bitmap_text(pixels, size, "OPS", (size - ops_width) // 2, int(size * 0.52), ops_scale, MUTED, LETTERS)
    draw_heading_mark(pixels, size)
    rect(pixels, size, int(size * 0.30), int(size * 0.88), int(size * 0.40), max(2, size // 80), AMBER)
    return pixels


def main():
    icons = Path("icons")
    icons.mkdir(exist_ok=True)
    for size in (192, 512):
        write_png(icons / f"icon-{size}.png", build_icon(size))


if __name__ == "__main__":
    main()
