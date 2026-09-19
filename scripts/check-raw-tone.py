#!/usr/bin/env python3
"""How far the sensor render's brightness sits from the camera's own JPEG.

A scene-referred render is colorimetrically right and looks wrong: flat and
dark beside the JPEG the same camera wrote, so a photographer watching the
sensor render replace the embedded preview sees the picture get worse. The
baseline tone curve in the camera profile is what closes that gap, and this
measures whether it does.

The measure is CIE L*, which is lightness as the eye grades it rather than as
the file stores it: one L* unit is near the threshold of noticing, and ten is
obvious. Both pictures are area-averaged onto a common grid first, because the
embedded preview and the sensor render do not agree pixel for pixel.

No exposure matching happens anywhere here. Landing at the camera's own
brightness unaided is the entire point.

    python3 scripts/check-raw-tone.py --files "~/…/*.ARW" --limit 24
"""
from __future__ import annotations

import argparse
import glob
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

LUMA = np.array([0.2126390, 0.7151687, 0.0721923])


def srgb_decode(x: np.ndarray) -> np.ndarray:
    x = x.astype(np.float64) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def lstar(luminance: np.ndarray) -> np.ndarray:
    """CIE L* from relative luminance, white at 1."""
    y = np.clip(luminance, 0, None)
    threshold = (6 / 29) ** 3
    root = np.where(y > threshold, np.cbrt(np.maximum(y, 1e-12)),
                    y / (3 * (6 / 29) ** 2) + 4 / 29)
    return 116 * root - 16


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
        fields: list[bytes] = []
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


def compare(decoder: str, raw_path: str, work: str, grid: int, scene_referred: bool):
    render_path = os.path.join(work, "render.ppm")
    preview_path = os.path.join(work, "preview.jpg")
    command = [decoder, "decode", raw_path, render_path, "--half"]
    if scene_referred:
        command.append("--scene-referred")
    if subprocess.run(command, capture_output=True).returncode != 0:
        return None
    if subprocess.run([decoder, "preview", raw_path, preview_path],
                      capture_output=True).returncode != 0:
        return None
    render = read_ppm(render_path)
    with Image.open(preview_path) as handle:
        jpeg = np.asarray(handle.convert("RGB"))
    height = max(8, int(round(grid * render.shape[0] / render.shape[1])))
    a = lstar(area_resize(srgb_decode(render), grid, height) @ LUMA)
    b = lstar(area_resize(srgb_decode(jpeg), grid, height) @ LUMA)
    difference = a - b
    return {
        "mean": float(np.mean(np.abs(difference))),
        "max": float(np.max(np.abs(difference))),
        "bias": float(np.mean(difference)),
        "median_render": float(np.median(a)),
        "median_camera": float(np.median(b)),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--decoder", default="native/build/lenslabs-raw-decode")
    parser.add_argument("--files", required=True)
    parser.add_argument("--limit", type=int, default=24)
    parser.add_argument("--grid", type=int, default=96)
    args = parser.parse_args()

    paths = sorted(glob.glob(os.path.expanduser(args.files)))
    if not paths:
        raise SystemExit("no files matched")
    # Spread across the set rather than taking the first N, which would be one
    # run of near-identical frames.
    step = max(1, len(paths) // args.limit)
    paths = paths[::step][:args.limit]

    rows = []
    with tempfile.TemporaryDirectory(prefix="check-raw-tone-") as work:
        for index, path in enumerate(paths):
            without = compare(args.decoder, path, work, args.grid, True)
            with_curve = compare(args.decoder, path, work, args.grid, False)
            if without and with_curve:
                rows.append((os.path.basename(path), without, with_curve))
            if (index + 1) % 8 == 0:
                print(f"  {index + 1}/{len(paths)}…", file=sys.stderr)

    if not rows:
        raise SystemExit("nothing decoded")
    header = f"{'file':<18}{'scene-referred':>26}{'with baseline curve':>28}"
    print(f"\nL* against the camera's own JPEG, {len(rows)} files, no exposure matching\n")
    print(header)
    print(f"{'':<18}{'mean':>10}{'max':>8}{'bias':>8}{'mean':>10}{'max':>8}{'bias':>8}")
    print("-" * len(header))
    for name, without, with_curve in rows[:12]:
        print(f"{name:<18}{without['mean']:>10.1f}{without['max']:>8.1f}{without['bias']:>+8.1f}"
              f"{with_curve['mean']:>10.1f}{with_curve['max']:>8.1f}{with_curve['bias']:>+8.1f}")
    if len(rows) > 12:
        print(f"… and {len(rows) - 12} more")

    def column(which, key):
        return np.array([r[1 if which == "without" else 2][key] for r in rows])

    print("\nacross every file:")
    for label, which in (("scene-referred      ", "without"), ("with baseline curve ", "with")):
        print(f"  {label}  mean |dL*| {column(which, 'mean').mean():5.2f}   "
              f"worst file's mean {column(which, 'mean').max():5.2f}   "
              f"largest single cell {column(which, 'max').max():5.1f}   "
              f"bias {column(which, 'bias').mean():+5.2f}")
    improvement = column("without", "mean").mean() - column("with", "mean").mean()
    print(f"\n  the curve moves the render {improvement:+.2f} L* closer to the camera on average")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
