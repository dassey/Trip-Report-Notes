#!/usr/bin/env python3
"""Regenerate the Home Screen icons.

Pure stdlib so it runs anywhere: draws the mark at 3x and box-filters it down,
then writes a plain (non-interlaced, 8-bit RGB) PNG.

    python3 tools/make-icons.py
"""
import struct, zlib, os

INK = (0x0e, 0x13, 0x19)
PAGE = (0xe8, 0xed, 0xf3)
ACC = (0x4d, 0x9f, 0xe8)
DIM = (0x8b, 0x98, 0xa9)
SS = 3  # supersampling factor

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def rounded(x, y, x0, y0, x1, y1, r):
    """True when (x, y) falls inside the rounded rectangle."""
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = x0 + r if x < x0 + r else (x1 - r if x > x1 - r else x)
    cy = y0 + r if y < y0 + r else (y1 - r if y > y1 - r else y)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def shade(x, y, n):
    """Colour of one supersampled pixel of an n-wide icon."""
    u, v = x / n, y / n
    # sheet of paper, portrait, centred
    if rounded(u, v, 0.28, 0.18, 0.72, 0.82, 0.035):
        # written lines: three in accent blue, one short in grey
        for top, left, right in ((0.30, 0.34, 0.66), (0.42, 0.34, 0.66), (0.54, 0.34, 0.60)):
            if top <= v <= top + 0.055 and left <= u <= right:
                return ACC
        if 0.66 <= v <= 0.715 and 0.34 <= u <= 0.52:
            return DIM
        return PAGE
    return INK


def render(size):
    n = size * SS
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = 0
            for sy in range(SS):
                for sx in range(SS):
                    c = shade(x * SS + sx, y * SS + sy, n)
                    r += c[0]; g += c[1]; b += c[2]
            k = SS * SS
            row += bytes((r // k, g // k, b // k))
        rows.append(bytes(row))
    return rows


def write_png(path, size):
    rows = render(size)
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    print("%s (%d bytes)" % (path, len(png)))


for size in (180, 192, 512):
    write_png(os.path.join(OUT, "icon-%d.png" % size), size)
