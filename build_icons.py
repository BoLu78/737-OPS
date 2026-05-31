#!/usr/bin/env python3
from pathlib import Path
import math
import struct
import zlib


SCALE = 4
NAVY = (13, 28, 45, 255)
NAVY_SOFT = (18, 42, 64, 255)
BLUE = (38, 92, 130, 255)
AMBER = (245, 158, 11, 255)
AMBER_SOFT = (255, 203, 116, 255)
WHITE = (250, 252, 252, 255)
SHADOW = (0, 0, 0, 62)
TRANSPARENT = (0, 0, 0, 0)


def alpha_blend(dst, src):
    sa = src[3] / 255
    da = dst[3] / 255
    out_a = sa + da * (1 - sa)
    if out_a == 0:
        return TRANSPARENT
    rgb = []
    for i in range(3):
        rgb.append(round((src[i] * sa + dst[i] * da * (1 - sa)) / out_a))
    return (*rgb, round(out_a * 255))


def set_px(buf, size, x, y, color):
    if 0 <= x < size and 0 <= y < size:
        buf[y][x] = alpha_blend(buf[y][x], color)


def fill_rect(buf, size, x, y, w, h, color):
    for yy in range(max(0, y), min(size, y + h)):
        for xx in range(max(0, x), min(size, x + w)):
            set_px(buf, size, xx, yy, color)


def fill_rounded_rect(buf, size, x, y, w, h, r, color):
    x2 = x + w - 1
    y2 = y + h - 1
    rr = r * r
    for yy in range(max(0, y), min(size, y + h)):
        for xx in range(max(0, x), min(size, x + w)):
            cx = x + r if xx < x + r else x2 - r if xx > x2 - r else xx
            cy = y + r if yy < y + r else y2 - r if yy > y2 - r else yy
            if (xx - cx) * (xx - cx) + (yy - cy) * (yy - cy) <= rr:
                set_px(buf, size, xx, yy, color)


def polygon(buf, size, points, color):
    min_y = max(0, math.floor(min(y for _, y in points)))
    max_y = min(size - 1, math.ceil(max(y for _, y in points)))
    for y in range(min_y, max_y + 1):
        intersections = []
        for i, (x1, y1) in enumerate(points):
            x2, y2 = points[(i + 1) % len(points)]
            if y1 == y2:
                continue
            if min(y1, y2) <= y < max(y1, y2):
                intersections.append(x1 + ((y - y1) * (x2 - x1) / (y2 - y1)))
        intersections.sort()
        for start, end in zip(intersections[0::2], intersections[1::2]):
            for x in range(max(0, math.floor(start)), min(size, math.ceil(end))):
                set_px(buf, size, x, y, color)


def thick_line(buf, size, x1, y1, x2, y2, width, color):
    dx = x2 - x1
    dy = y2 - y1
    length = math.hypot(dx, dy)
    if length == 0:
        return
    nx = -dy / length * width / 2
    ny = dx / length * width / 2
    polygon(
        buf,
        size,
        [
            (x1 + nx, y1 + ny),
            (x2 + nx, y2 + ny),
            (x2 - nx, y2 - ny),
            (x1 - nx, y1 - ny),
        ],
        color,
    )


def draw_aircraft(buf, size):
    cx = size * 0.5

    # Soft shadow, offset down for depth.
    shadow_offset = size * 0.018
    aircraft_polygons = aircraft_shape(cx, size, shadow_offset)
    for points in aircraft_polygons:
        polygon(buf, size, points, SHADOW)

    for points in aircraft_shape(cx, size, 0):
        polygon(buf, size, points, WHITE)


def aircraft_shape(cx, size, y_offset):
    return [
        # Fuselage with pointed nose.
        [
            (cx, size * 0.205 + y_offset),
            (cx + size * 0.045, size * 0.315 + y_offset),
            (cx + size * 0.034, size * 0.735 + y_offset),
            (cx, size * 0.800 + y_offset),
            (cx - size * 0.034, size * 0.735 + y_offset),
            (cx - size * 0.045, size * 0.315 + y_offset),
        ],
        # Main wings.
        [
            (cx - size * 0.035, size * 0.465 + y_offset),
            (cx - size * 0.350, size * 0.660 + y_offset),
            (cx - size * 0.315, size * 0.720 + y_offset),
            (cx - size * 0.015, size * 0.610 + y_offset),
        ],
        [
            (cx + size * 0.035, size * 0.465 + y_offset),
            (cx + size * 0.350, size * 0.660 + y_offset),
            (cx + size * 0.315, size * 0.720 + y_offset),
            (cx + size * 0.015, size * 0.610 + y_offset),
        ],
        # Tail plane.
        [
            (cx - size * 0.024, size * 0.720 + y_offset),
            (cx - size * 0.180, size * 0.825 + y_offset),
            (cx - size * 0.145, size * 0.865 + y_offset),
            (cx, size * 0.795 + y_offset),
        ],
        [
            (cx + size * 0.024, size * 0.720 + y_offset),
            (cx + size * 0.180, size * 0.825 + y_offset),
            (cx + size * 0.145, size * 0.865 + y_offset),
            (cx, size * 0.795 + y_offset),
        ],
    ]


def downsample(high, final_size):
    high_size = len(high)
    factor = high_size // final_size
    out = []
    area = factor * factor
    for y in range(final_size):
        row = []
        for x in range(final_size):
            sums = [0, 0, 0, 0]
            for yy in range(y * factor, (y + 1) * factor):
                for xx in range(x * factor, (x + 1) * factor):
                    px = high[yy][xx]
                    for i in range(4):
                        sums[i] += px[i]
            row.append(tuple(round(v / area) for v in sums))
        out.append(row)
    return out


def png_chunk(tag, data):
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path, pixels):
    size = len(pixels)
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b, a in row:
            raw.extend((r, g, b, a))
    data = b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            png_chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)),
            png_chunk(b"IDAT", zlib.compress(bytes(raw), 9)),
            png_chunk(b"IEND", b""),
        ]
    )
    path.write_bytes(data)


def build_icon(final_size):
    size = final_size * SCALE
    buf = [[TRANSPARENT for _ in range(size)] for _ in range(size)]
    margin = round(size * 0.045)
    radius = round(size * 0.18)

    fill_rounded_rect(buf, size, margin, margin, size - margin * 2, size - margin * 2, radius, NAVY)
    fill_rounded_rect(
        buf,
        size,
        margin + round(size * 0.020),
        margin + round(size * 0.020),
        size - (margin + round(size * 0.020)) * 2,
        size - (margin + round(size * 0.020)) * 2,
        radius - round(size * 0.020),
        NAVY_SOFT,
    )

    thick_line(buf, size, size * 0.5, size * 0.20, size * 0.5, size * 0.86, size * 0.036, AMBER)
    thick_line(buf, size, size * 0.43, size * 0.80, size * 0.57, size * 0.80, size * 0.018, AMBER_SOFT)
    thick_line(buf, size, size * 0.24, size * 0.26, size * 0.76, size * 0.26, size * 0.012, BLUE)
    draw_aircraft(buf, size)

    return downsample(buf, final_size)


def main():
    icons = Path("icons")
    icons.mkdir(exist_ok=True)
    for size in (192, 512):
        write_png(icons / f"icon-{size}.png", build_icon(size))


if __name__ == "__main__":
    main()
