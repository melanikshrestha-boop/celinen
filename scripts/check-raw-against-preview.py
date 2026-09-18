#!/usr/bin/env python3
"""Check every RAW on disk against the picture its own camera put inside it.

For each file this decodes the sensor data and compares the result with the
embedded JPEG on the two things that can actually be checked without a
reference render: the scene geometry (the two must be the same picture, the
same way up, at the same aspect ratio) and the colour, once the difference in
exposure and tone between them has been divided out.

It reports a per-file table and a summary, and it names every file that could
not be decoded and why. Originals are opened read-only.

    python3 scripts/check-raw-against-preview.py \\
        --files "~/Documents/01-Photography/Raw-Photos/*.ARW" [--limit 40] [--full]
"""
from __future__ import annotations

import argparse
import glob
import os
import struct
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

LUMA = np.array([0.2126390, 0.7151687, 0.0721923])


def srgb_decode(x: np.ndarray) -> np.ndarray:
    x = x.astype(np.float64) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def area_resize(image: np.ndarray, width: int, height: int) -> np.ndarray:
    source_h, source_w = image.shape[:2]
    ys = (np.arange(height + 1) * source_h / height).astype(int)
    xs = (np.arange(width + 1) * source_w / width).astype(int)
    rows = np.add.reduceat(image, ys[:-1], axis=0) / np.diff(ys).reshape(-1, 1, 1)
    return np.add.reduceat(rows, xs[:-1], axis=1) / np.diff(xs).reshape(1, -1, 1)


def read_ppm(path: str) -> np.ndarray:
    with open(path, "rb") as handle:
        if handle.readline().strip() != b"P6":
            raise ValueError("not a P6 PPM")
        fields = []
        while len(fields) < 3:
            line = handle.readline()
            if not line:
                raise ValueError("truncated PPM header")
            if line.startswith(b"#"):
                continue
            fields += line.split()
        width, height, _maximum = (int(v) for v in fields[:3])
        data = np.frombuffer(handle.read(width * height * 3), dtype=np.uint8)
    return data.reshape(height, width, 3)


def monotone_curve(x: np.ndarray, y: np.ndarray, bins: int = 48):
    x, y = x.ravel(), y.ravel()
    good = np.isfinite(x) & np.isfinite(y) & (x > 0)
    x, y = x[good], y[good]
    if x.size < 200:
        return None
    order = np.argsort(x)
    xs, ys = x[order], y[order]
    edges = np.linspace(0, len(xs), bins + 1).astype(int)
    knots_x, knots_y = [], []
    for i in range(bins):
        a, b = edges[i], edges[i + 1]
        if b - a < 8:
            continue
        knots_x.append(np.median(xs[a:b]))
        knots_y.append(np.median(ys[a:b]))
    if len(knots_x) < 6:
        return None
    knots_x = np.array(knots_x)
    knots_y = np.maximum.accumulate(np.array(knots_y))
    return lambda v: np.interp(v, knots_x, knots_y)


def compare(decoder: str, raw_path: str, work: str, full: bool):
    render_path = os.path.join(work, "render.ppm")
    preview_path = os.path.join(work, "preview.jpg")
    command = [decoder, "decode", raw_path, render_path]
    if not full:
        command.append("--half")
    done = subprocess.run(command, capture_output=True, text=True)
    if done.returncode != 0:
        return {"file": os.path.basename(raw_path),
                "error": (done.stderr or done.stdout).strip().splitlines()[-1:] or ["refused"]}
    line = done.stdout.strip().splitlines()[0]
    timing = line.split("  ")
    preview = subprocess.run([decoder, "preview", raw_path, preview_path], capture_output=True,
                             text=True)
    render = read_ppm(render_path)
    row = {"file": os.path.basename(raw_path), "render": f"{render.shape[1]}x{render.shape[0]}",
           "timing": timing[2].strip() if len(timing) > 2 else ""}
    for part in timing:
        if part.startswith("total"):
            row["ms"] = float(part.split()[1])
        if part.startswith("peak"):
            row["mb"] = float(part.split()[1])
    if preview.returncode != 0:
        row["error"] = ["no embedded JPEG"]
        return row
    with Image.open(preview_path) as handle:
        jpeg = np.asarray(handle.convert("RGB"))
    row["preview"] = f"{jpeg.shape[1]}x{jpeg.shape[0]}"

    # Same scene, same way up, same shape: the aspect ratios must agree and the
    # two must correlate. A mirrored or rotated render would correlate at zero.
    render_aspect = render.shape[1] / render.shape[0]
    jpeg_aspect = jpeg.shape[1] / jpeg.shape[0]
    row["aspect"] = abs(render_aspect - jpeg_aspect) / jpeg_aspect

    grid = 128
    height = max(8, int(round(grid * render.shape[0] / render.shape[1])))
    r = area_resize(srgb_decode(render), grid, height)
    j = area_resize(srgb_decode(jpeg), grid, height)
    lr, lj = r @ LUMA, j @ LUMA

    def correlation(a, b):
        a = a.ravel() - a.mean()
        b = b.ravel() - b.mean()
        return float((a * b).sum() / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))

    row["geometry"] = correlation(lr, lj)
    row["flipped"] = max(correlation(lr, lj[:, ::-1]), correlation(lr, lj[::-1, :]))

    # Colour, with the difference in exposure and tone divided out: the render
    # is scene-referred and the camera's JPEG has its own curve on top, so a raw
    # difference would measure the curve rather than the colour.
    encoded = area_resize(np.asarray(Image.open(preview_path).convert("RGB")).astype(float),
                          grid, height)
    keep = (encoded.min(axis=2) > 16) & (encoded.max(axis=2) < 240) & (r.min(axis=2) > 0.001)
    if keep.sum() < 200:
        row["error"] = ["too little usable mid-tone to compare colour"]
        return row
    rk, jk = r[keep], j[keep]
    curve = monotone_curve(rk @ LUMA, jk @ LUMA)
    if curve is None:
        row["error"] = ["could not match the camera's tone curve"]
        return row
    mapped = np.clip(curve(rk @ LUMA), 1e-6, None)
    matched = rk * (mapped / np.clip(rk @ LUMA, 1e-6, None))[:, None]
    a = matched / np.clip(np.linalg.norm(matched, axis=1, keepdims=True), 1e-9, None)
    b = jk / np.clip(np.linalg.norm(jk, axis=1, keepdims=True), 1e-9, None)
    angles = np.degrees(np.arccos(np.clip((a * b).sum(axis=1), -1, 1)))
    row["colour_mean"] = float(angles.mean())
    row["colour_p95"] = float(np.percentile(angles, 95))
    # Average colour after matching exposure, as a plain per-channel ratio.
    row["ratio"] = (matched.mean(axis=0) / np.clip(jk.mean(axis=0), 1e-9, None)).tolist()
    return row


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--decoder", default="native/build/lenslabs-raw-decode")
    parser.add_argument("--files", required=True)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--full", action="store_true", help="decode at full resolution")
    parser.add_argument("--rows", type=int, default=12, help="how many files to list individually")
    args = parser.parse_args()

    paths = sorted(glob.glob(os.path.expanduser(args.files)))
    if args.limit:
        paths = paths[:args.limit]
    if not paths:
        raise SystemExit("no files matched")

    rows = []
    with tempfile.TemporaryDirectory(prefix="check-raw-") as work:
        for index, path in enumerate(paths):
            rows.append(compare(args.decoder, path, work, args.full))
            if (index + 1) % 25 == 0:
                print(f"  {index + 1}/{len(paths)}…", file=sys.stderr)

    good = [r for r in rows if "error" not in r]
    bad = [r for r in rows if "error" in r]

    print(f"\n{len(rows)} files: {len(good)} decoded, {len(bad)} refused\n")
    header = (f"{'file':<18}{'render':>12}{'preview':>11}{'geom':>7}{'flip':>7}"
              f"{'colour mean':>13}{'p95':>7}{'R/G/B ratio':>22}{'ms':>8}{'MB':>7}")
    print(header)
    print("-" * len(header))
    for row in good[:args.rows]:
        ratio = "/".join(f"{v:.3f}" for v in row["ratio"])
        print(f"{row['file']:<18}{row['render']:>12}{row['preview']:>11}"
              f"{row['geometry']:>7.3f}{row['flipped']:>7.3f}"
              f"{row['colour_mean']:>12.2f}°{row['colour_p95']:>7.2f}{ratio:>22}"
              f"{row.get('ms', 0):>8.0f}{row.get('mb', 0):>7.0f}")
    if len(good) > args.rows:
        print(f"… and {len(good) - args.rows} more")

    if good:
        def column(name):
            return np.array([r[name] for r in good])
        print("\nacross every decoded file:")
        print(f"  scene correlation with the camera's own JPEG: "
              f"min {column('geometry').min():.3f}, median {np.median(column('geometry')):.3f}")
        print(f"  best correlation of a flipped preview:        "
              f"max {column('flipped').max():.3f}  (must stay far below the above)")
        print(f"  aspect ratio difference:                      "
              f"max {column('aspect').max() * 100:.2f}%")
        print(f"  angular colour error, exposure matched:       "
              f"mean {column('colour_mean').mean():.2f}°, "
              f"worst file {column('colour_mean').max():.2f}°, "
              f"95th percentile within a file up to {column('colour_p95').max():.2f}°")
        ratios = np.array([r["ratio"] for r in good])
        print(f"  average colour ratio to the camera's JPEG:    "
              f"R {ratios[:, 0].mean():.3f}  G {ratios[:, 1].mean():.3f}  B {ratios[:, 2].mean():.3f}")
        print(f"  decode: median {np.median(column('ms')):.0f} ms, "
              f"peak memory {column('mb').max():.0f} MB")
    for row in bad:
        print(f"  REFUSED {row['file']}: {row['error'][0] if row['error'] else 'unknown'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
