#!/usr/bin/env python3
"""Measure a camera's colour response from its own embedded JPEGs.

A Sony ARW carries no colour matrix. Every raw converter therefore ships a table
of them, and every one of those tables traces back to a source this repository
cannot take (LibRaw is LGPL, dcraw has its own redistribution terms, Adobe's
matrices are Adobe's). This measures one instead, from the only colorimetric
reference the file itself contains: the finished JPEG the camera wrote beside
the mosaic, which is the manufacturer's own rendering of the same photons.

Method
------
For each training frame:

1. ``lenslabs-raw-decode camera`` gives white-balanced linear camera RGB with no
   profile applied. A neutral subject is (1, 1, 1) there by construction.
2. The embedded JPEG is linearised through the sRGB transfer function.
3. Both are area-averaged onto a common small grid and pixels that are not
   locally flat are dropped, so the two rasters' slightly different crops cannot
   pair an edge with its neighbour.
4. The camera's tone curve is removed rather than fitted: with a provisional
   matrix in hand, each JPEG pixel is rescaled so its luminance matches the
   prediction's while its chromaticity is untouched. What is left to fit is
   colour alone.
5. A 3x3 is solved by least squares with each row constrained to sum to one, so
   a neutral input stays neutral exactly. Steps 4 and 5 repeat until it settles.

The result maps white-balanced camera RGB to linear sRGB. It is converted to the
DNG ColorMatrix convention (XYZ D50 -> camera) at D65, because the training
frames are daylight and a single-illuminant profile has to name the illuminant
it was measured at.

What this is not: Adobe measures a sensor's response against a spectral target.
This matches the camera's own JPEG rendering, tone curve removed but the
manufacturer's saturation still in it. Renders will look like the back of the
camera, which is not the same picture as Lightroom's Adobe Standard.

Usage
-----
    python3 scripts/fit-raw-profile.py --decoder native/build/lenslabs-raw-decode \\
        --files "~/Documents/01-Photography/Raw-Photos/*.ARW" --train 24 --test 24

Originals are opened read-only; everything intermediate lands in a temporary
directory this script removes.
"""
from __future__ import annotations

import argparse
import glob
import os
import random
import struct
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

# Linear sRGB (D65) <-> XYZ (D65). Same numbers as native/src/raw_color.cpp.
SRGB_TO_XYZ = np.array([
    [0.4123908, 0.3575843, 0.1804808],
    [0.2126390, 0.7151687, 0.0721923],
    [0.0193308, 0.1191948, 0.9505322],
])
XYZ_TO_SRGB = np.linalg.inv(SRGB_TO_XYZ)
LUMA = SRGB_TO_XYZ[1]


def srgb_decode(x: np.ndarray) -> np.ndarray:
    """8-bit sRGB to linear."""
    x = x.astype(np.float64) / 255.0
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def read_camera_dump(path: str):
    """The .cam file lenslabs-raw-decode writes: header, then float32 RGB."""
    with open(path, "rb") as handle:
        magic = handle.read(6)
        if magic != b"LLCAM1":
            raise SystemExit(f"{path} is not a camera dump")
        width, height, _orientation = struct.unpack("<III", handle.read(12))
        neutral = np.array(struct.unpack("<ddd", handle.read(24)))
        data = np.frombuffer(handle.read(), dtype="<f4")
    if data.size != width * height * 3:
        raise SystemExit(f"{path} is the wrong size")
    return data.reshape(height, width, 3).astype(np.float64), neutral


def area_resize(image: np.ndarray, width: int, height: int) -> np.ndarray:
    """Box-average onto a grid. Linear values in, linear values out."""
    source_h, source_w = image.shape[:2]
    ys = (np.arange(height + 1) * source_h / height).astype(int)
    xs = (np.arange(width + 1) * source_w / width).astype(int)
    rows = np.add.reduceat(image, ys[:-1], axis=0)
    counts_y = np.diff(ys).reshape(-1, 1, 1)
    rows = rows / counts_y
    cells = np.add.reduceat(rows, xs[:-1], axis=1)
    counts_x = np.diff(xs).reshape(1, -1, 1)
    return cells / counts_x


def local_flatness(image: np.ndarray) -> np.ndarray:
    """Max absolute difference to the four neighbours, relative to the value."""
    pad = np.pad(image, ((1, 1), (1, 1), (0, 0)), mode="edge")
    centre = pad[1:-1, 1:-1]
    spread = np.zeros(centre.shape[:2])
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        other = pad[1 + dy:1 + dy + centre.shape[0], 1 + dx:1 + dx + centre.shape[1]]
        spread = np.maximum(spread, np.abs(other - centre).max(axis=2))
    return spread / (centre.mean(axis=2) + 1e-6)


def constrained_least_squares(source: np.ndarray, target: np.ndarray,
                              weights: np.ndarray) -> np.ndarray:
    """Least squares for a 3x3 whose every row sums to one.

    The constraint is what makes a neutral camera pixel render neutral: a row
    that sums to one takes (1, 1, 1) to 1.
    """
    matrix = np.zeros((3, 3))
    weighted = source * weights[:, None]
    gram = source.T @ weighted
    ones = np.ones((3, 1))
    # KKT system for minimise ||Ax - b||^2 subject to 1'x = 1.
    kkt = np.block([[gram, ones], [ones.T, np.zeros((1, 1))]])
    for channel in range(3):
        rhs = np.concatenate([weighted.T @ target[:, channel], [1.0]])
        solution = np.linalg.solve(kkt, rhs)
        matrix[channel] = solution[:3]
    return matrix


def monotone_curve(x: np.ndarray, y: np.ndarray, bins: int = 48):
    """A monotone map from x to y, by matching quantiles."""
    order = np.argsort(x)
    x_sorted, y_sorted = x[order], y[order]
    edges = np.linspace(0, len(x_sorted), bins + 1).astype(int)
    knots_x, knots_y = [], []
    for i in range(bins):
        a, b = edges[i], edges[i + 1]
        if b - a < 8:
            continue
        knots_x.append(np.median(x_sorted[a:b]))
        knots_y.append(np.median(y_sorted[a:b]))
    if len(knots_x) < 4:
        return None
    knots_x = np.array(knots_x)
    knots_y = np.maximum.accumulate(np.array(knots_y))
    return lambda v: np.interp(v, knots_x, knots_y)


def gather(decoder: str, raw_path: str, work: str, grid: int):
    """One frame's paired camera RGB and camera-JPEG samples."""
    cam_path = os.path.join(work, "frame.cam")
    jpg_path = os.path.join(work, "frame.jpg")
    subprocess.run([decoder, "camera", raw_path, cam_path], check=True,
                   stdout=subprocess.DEVNULL)
    subprocess.run([decoder, "preview", raw_path, jpg_path], check=True,
                   stdout=subprocess.DEVNULL)
    cam, neutral = read_camera_dump(cam_path)
    with Image.open(jpg_path) as handle:
        jpeg = np.asarray(handle.convert("RGB"))
    # Both rasters are stored sensor-up and cover the same picture, so a common
    # grid pairs them without needing either one's orientation.
    height = max(8, int(round(grid * cam.shape[0] / cam.shape[1])))
    cam_small = area_resize(cam, grid, height)
    jpeg_linear = area_resize(srgb_decode(jpeg), grid, height)
    jpeg_encoded = area_resize(jpeg.astype(np.float64), grid, height)

    # Keep only samples that are locally flat in both, mid-tone in the JPEG and
    # unclipped in the camera data.
    flat = (local_flatness(cam_small) < 0.10) & (local_flatness(jpeg_linear) < 0.10)
    exposed = (jpeg_encoded.min(axis=2) > 24) & (jpeg_encoded.max(axis=2) < 232)
    sane = (cam_small.min(axis=2) > 0.002) & (cam_small.max(axis=2) < 0.85)
    keep = flat & exposed & sane
    return cam_small[keep], jpeg_linear[keep], neutral


def fit(samples, passes: int = 6):
    """Solve the camera-to-linear-sRGB matrix over pooled samples."""
    cam = np.concatenate([s[0] for s in samples])
    target = np.concatenate([s[1] for s in samples])
    matrix = np.eye(3)
    for _ in range(passes):
        predicted = cam @ matrix.T
        lum_predicted = np.clip(predicted @ LUMA, 1e-6, None)
        lum_target = np.clip(target @ LUMA, 1e-6, None)
        curve = monotone_curve(lum_predicted, lum_target)
        if curve is None:
            break
        # Rescale each JPEG pixel onto the prediction's luminance, keeping its
        # chromaticity: what is left to explain is colour, not tone.
        mapped = np.clip(curve(lum_predicted), 1e-6, None)
        corrected = target * (lum_predicted / mapped)[:, None]
        # Weight by luminance so a dark, noisy sample does not outvote a
        # well-exposed one, and cap so a near-clipped sample cannot dominate.
        weights = np.clip(lum_predicted, 1e-4, 0.5)
        matrix = constrained_least_squares(cam, corrected, weights)
    return matrix


def evaluate(matrix: np.ndarray, samples):
    """Angular colour error in degrees between rendered and camera chromaticity."""
    errors = []
    for cam, target, _ in samples:
        predicted = cam @ matrix.T
        lum_predicted = np.clip(predicted @ LUMA, 1e-6, None)
        lum_target = np.clip(target @ LUMA, 1e-6, None)
        curve = monotone_curve(lum_predicted, lum_target)
        if curve is None:
            continue
        mapped = np.clip(curve(lum_predicted), 1e-6, None)
        corrected = target * (lum_predicted / mapped)[:, None]
        a = predicted / np.linalg.norm(predicted, axis=1, keepdims=True).clip(1e-9)
        b = corrected / np.linalg.norm(corrected, axis=1, keepdims=True).clip(1e-9)
        cosine = np.clip((a * b).sum(axis=1), -1, 1)
        errors.append(np.degrees(np.arccos(cosine)))
    if not errors:
        return None
    joined = np.concatenate(errors)
    return {
        "mean": float(joined.mean()),
        "median": float(np.median(joined)),
        "p95": float(np.percentile(joined, 95)),
        "samples": int(joined.size),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--decoder", default="native/build/lenslabs-raw-decode")
    parser.add_argument("--files", required=True, help="glob of RAW files")
    parser.add_argument("--train", type=int, default=24)
    parser.add_argument("--test", type=int, default=24)
    parser.add_argument("--grid", type=int, default=256)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    paths = sorted(glob.glob(os.path.expanduser(args.files)))
    if not paths:
        raise SystemExit("no files matched")
    random.Random(args.seed).shuffle(paths)
    train_paths = paths[:args.train]
    test_paths = paths[args.train:args.train + args.test]

    with tempfile.TemporaryDirectory(prefix="fit-raw-profile-") as work:
        def collect(which):
            out = []
            for path in which:
                try:
                    sample = gather(args.decoder, path, work, args.grid)
                except subprocess.CalledProcessError:
                    print(f"  skipped (decoder refused) {os.path.basename(path)}", file=sys.stderr)
                    continue
                if len(sample[0]) < 200:
                    print(f"  skipped (too few usable samples) {os.path.basename(path)}",
                          file=sys.stderr)
                    continue
                out.append(sample)
            return out

        print(f"gathering {len(train_paths)} training frames…", file=sys.stderr)
        train = collect(train_paths)
        print(f"gathering {len(test_paths)} held-out frames…", file=sys.stderr)
        test = collect(test_paths)

    if not train:
        raise SystemExit("no usable training frames")
    matrix = fit(train)
    neutral = np.mean([s[2] for s in train], axis=0)

    # White-balanced camera RGB -> linear sRGB is what was fitted. The decoder
    # wants XYZ(D50) -> camera at the calibration illuminant, which for daylight
    # training frames is named D65:
    #   working = XYZ_TO_SRGB . Bradford(D50->D65) . Bradford(D65->D50) . inv(CM) . diag(neutral)
    # The two adaptations cancel at D65, leaving CM = diag(neutral) . inv(W) . XYZ_TO_SRGB.
    colour_matrix = np.diag(neutral) @ np.linalg.inv(matrix) @ XYZ_TO_SRGB

    print("\ncamera (white balanced) -> linear sRGB, rows sum to 1:")
    for row in matrix:
        print("   ", "  ".join(f"{v: .6f}" for v in row), f"   (sum {row.sum():.6f})")
    print(f"\ntraining as-shot neutral: {neutral[0]:.5f} {neutral[1]:.5f} {neutral[2]:.5f}")
    print("\nColorMatrix1 (XYZ D50 -> camera), CalibrationIlluminant1 = 21 (D65):")
    print("    {", ", ".join(f"{v:.4f}" for v in colour_matrix.flatten()), "},")

    for label, which in (("training", train), ("held out", test)):
        stats = evaluate(matrix, which)
        if not stats:
            continue
        print(f"\n{label}: {stats['samples']} samples, angular colour error "
              f"mean {stats['mean']:.2f} deg, median {stats['median']:.2f} deg, "
              f"95th {stats['p95']:.2f} deg")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
