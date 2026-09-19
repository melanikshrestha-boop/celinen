#!/usr/bin/env python3
"""Measure a camera's colour response from its own embedded JPEGs.

A Sony ARW carries no colour matrix. Every raw converter therefore ships a table
of them, and every one of those tables traces back to a source this repository
cannot take (LibRaw is LGPL, dcraw has its own redistribution terms, Adobe's
matrices are Adobe's). This measures one instead, from the only colour reference
the file itself contains: the finished JPEG the camera wrote beside the mosaic,
which is the manufacturer's own rendering of the same photons.

The model
---------
A camera renders in two steps: a 3x3 onto its output primaries, then one tone
curve applied per channel. Both are recovered by alternating:

1. ``lenslabs-raw-decode camera`` gives white-balanced linear camera RGB with no
   profile applied. A neutral subject is (1, 1, 1) there by construction.
2. The embedded JPEG is linearised through the sRGB transfer function, and both
   rasters are area-averaged onto a common grid. A 3x3 commutes with area
   averaging, so coarse cells cost nothing and absorb the small difference
   between the preview's crop and the sensor's.
3. With a provisional matrix, the tone curve is estimated by pooling all three
   channels' (predicted, rendered) pairs into a monotone map, and the JPEG is
   pulled back through its inverse.
4. The matrix is re-solved on what is left.

Why the fit is constrained
--------------------------
A camera channel is a non-negative spectral response, so every entry of
camera->XYZ is non-negative; and a neutral camera pixel must render as the
training illuminant's white, which fixes each row's sum. Those two together make
each row of camera->XYZ a point on a scaled simplex, and step 4 is projected
gradient descent onto it.

The constraint is not cosmetic. A shoot of rock, a yellow dress and dark water
barely excites the red-green axis, and the unconstrained least-squares solution
puts the camera's red primary at negative Y and Z — a filter that absorbs light.
It fits the training frames better and is not a camera. Constrained, the red
primary lands on the simplex boundary, which is the least saturated response
consistent with the evidence, and the resulting ColorMatrix has the shape a real
one has: a positive diagonal with negative off-diagonals.

What this is not
----------------
Adobe measures a sensor against a spectral target under known illuminants. This
matches one camera's own JPEG rendering under the illuminants that shoot
happened to contain. Renders will look like the back of the camera, which is not
the same picture as Lightroom's Adobe Standard, and the extrapolation to white
balances far from the training illuminant is unvalidated.

Usage
-----
    python3 scripts/fit-raw-profile.py \\
        --decoder native/build/lenslabs-raw-decode \\
        --files "~/Documents/01-Photography/Raw-Photos/*.ARW" --train 20 --test 20

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
        if handle.read(6) != b"LLCAM1":
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
    rows = np.add.reduceat(image, ys[:-1], axis=0) / np.diff(ys).reshape(-1, 1, 1)
    return np.add.reduceat(rows, xs[:-1], axis=1) / np.diff(xs).reshape(1, -1, 1)


def monotone_curve(x: np.ndarray, y: np.ndarray, bins: int = 64):
    """A monotone map y ~= f(x) and its inverse, by matching quantiles."""
    x, y = x.ravel(), y.ravel()
    good = np.isfinite(x) & np.isfinite(y) & (x > 0)
    x, y = x[good], y[good]
    if x.size < bins * 16:
        bins = max(6, x.size // 16)
    order = np.argsort(x)
    xs, ys = x[order], y[order]
    edges = np.linspace(0, len(xs), bins + 1).astype(int)
    knots_x, knots_y = [], []
    for i in range(bins):
        a, b = edges[i], edges[i + 1]
        if b - a < 16:
            continue
        knots_x.append(np.median(xs[a:b]))
        knots_y.append(np.median(ys[a:b]))
    if len(knots_x) < 6:
        return None, None
    knots_x = np.array(knots_x)
    # Strictly increasing, so the inverse is single valued.
    knots_y = np.maximum.accumulate(np.array(knots_y)) + np.arange(len(knots_x)) * 1e-9
    return (lambda v: np.interp(v, knots_x, knots_y)), (lambda v: np.interp(v, knots_y, knots_x))


def project_simplex(row: np.ndarray, total: float) -> np.ndarray:
    """Nearest point with every entry >= 0 and the entries summing to `total`."""
    if total <= 0:
        return np.zeros_like(row)
    descending = np.sort(row)[::-1]
    running = np.cumsum(descending) - total
    counts = np.arange(1, len(row) + 1)
    valid = np.nonzero(descending - running / counts > 0)[0]
    pivot = valid[-1] if len(valid) else 0
    return np.maximum(row - running[pivot] / (pivot + 1), 0)


def solve_constrained(cam, target, weights, white, iterations=1500):
    """Projected gradient on N = camera -> XYZ, each row on a scaled simplex."""
    weighted = cam * weights[:, None]
    gram = cam.T @ weighted
    cross = target.T @ weighted
    projection = XYZ_TO_SRGB
    # Start admissible and colourless: every camera channel sees the white.
    matrix = np.outer(white, np.ones(3)) / 3.0
    step = 1.0 / (np.linalg.norm(projection.T @ projection) * np.linalg.norm(gram) + 1e-12)
    for _ in range(iterations):
        gradient = 2 * projection.T @ ((projection @ matrix) @ gram - cross)
        matrix = matrix - step * gradient
        for row in range(3):
            matrix[row] = project_simplex(matrix[row], white[row])
    return matrix


def gather(decoder: str, raw_path: str, work: str, grid: int):
    """One frame's paired camera RGB and camera-JPEG samples."""
    cam_path = os.path.join(work, "frame.cam")
    jpg_path = os.path.join(work, "frame.jpg")
    subprocess.run([decoder, "camera", raw_path, cam_path], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([decoder, "preview", raw_path, jpg_path], check=True, stdout=subprocess.DEVNULL)
    cam, neutral = read_camera_dump(cam_path)
    with Image.open(jpg_path) as handle:
        jpeg = np.asarray(handle.convert("RGB"))
    # Both rasters are stored sensor-up and cover the same picture, so a common
    # grid pairs them without either one's orientation entering into it.
    height = max(8, int(round(grid * cam.shape[0] / cam.shape[1])))
    cam_small = area_resize(cam, grid, height)
    jpeg_linear = area_resize(srgb_decode(jpeg), grid, height)
    encoded = area_resize(jpeg.astype(np.float64), grid, height)
    # The matrix is solved on well-exposed cells: a near-black cell is mostly
    # noise and its chromaticity would only add error.
    colour = ((encoded.min(axis=2) > 16) & (encoded.max(axis=2) < 240) &
              (cam_small.min(axis=2) > 0.002) & (cam_small.max(axis=2) < 0.9))
    # The tone curve is not. It has to say what happens to a shadow, and these
    # frames are mostly shadow — dark water behind a lit subject. Fitting the
    # curve on mid-tones alone leaves the bottom of it to a straight line, and
    # the render comes out darker than the camera's across most of the frame.
    tone = (encoded.max(axis=2) < 250) & (cam_small.min(axis=2) > 0)
    return cam_small[colour], jpeg_linear[colour], neutral, cam_small[tone], jpeg_linear[tone]


def fit(samples, passes: int = 8):
    cam = np.concatenate([s[0] for s in samples])
    target = np.concatenate([s[1] for s in samples])
    white = SRGB_TO_XYZ @ np.ones(3)
    matrix = np.eye(3)
    camera_to_xyz = None
    for _ in range(passes):
        predicted = cam @ matrix.T
        _forward, inverse = monotone_curve(predicted, target)
        if inverse is None:
            break
        corrected = inverse(target)
        # Weight by brightness so a dark, noisy cell cannot outvote a good one,
        # and cap so a near-clipped one cannot dominate either.
        weights = np.clip(predicted.mean(axis=1), 1e-4, 0.6)
        camera_to_xyz = solve_constrained(cam, corrected, weights, white)
        matrix = XYZ_TO_SRGB @ camera_to_xyz
    # The curve is measured last, from the wide sample, against the matrix that
    # will actually be shipped with it.
    wide_cam = np.concatenate([s[3] for s in samples])
    wide_target = np.concatenate([s[4] for s in samples])
    wide_predicted = wide_cam @ matrix.T
    forward, _inverse = monotone_curve(wide_predicted, wide_target, bins=96)
    return matrix, camera_to_xyz, forward, wide_predicted


KNOTS = 33


def tone_curve_knots(forward, observed):
    """The camera's baseline rendering, on the grid the decoder interpolates.

    The fit only knows the range of scene values these frames happened to
    contain. Below it the curve runs straight into black; above it, it is
    carried on the slope the measurement ended with, because inventing a
    shoulder the camera never showed is worse than extending the one it did.
    """
    # The very ends of the measured range are the thinnest evidence there is,
    # and a tone curve built on them wobbles. Trust the solid middle — but the
    # wide sample reaches into the shadows, so "the middle" now covers the
    # tones a photograph is actually made of.
    low = float(np.percentile(observed, 0.5))
    high = float(np.percentile(observed, 99.5))
    if not (high > low > 0):
        return None
    # Denser at the bottom, where a tone curve bends hardest and where linear
    # interpolation between knots would otherwise show as banding.
    xs = (np.arange(KNOTS) / (KNOTS - 1)) ** 2
    ys = np.asarray(forward(np.clip(xs, low, high)), dtype=float)
    toe = float(forward(np.array([low]))[0]) / low
    ys = np.where(xs < low, xs * toe, ys)
    # Above the measured range the curve has to reach white by the sensor's own
    # ceiling, and it has to get there the way a camera does: leaving the
    # measurement at the slope the measurement ended with, then shouldering off.
    # A straight line would arrive early and clip the top third of the range.
    window = max(low, high * 0.6)
    top = float(forward(np.array([high]))[0])
    slope = (top - float(forward(np.array([window]))[0])) / max(high - window, 1e-9)
    run = max(1.0 - high, 1e-9)
    head = max(1.0 - top, 1e-9)
    # Fritsch-Carlson: any steeper than this and a cubic through these two
    # points stops being monotone and the shoulder grows a bump.
    slope = min(slope, 3.0 * head / run)
    end_slope = min(0.3 * slope, 3.0 * head / run)
    u = np.clip((xs - high) / run, 0.0, 1.0)
    hermite = ((2 * u ** 3 - 3 * u ** 2 + 1) * top +
               (u ** 3 - 2 * u ** 2 + u) * run * slope +
               (-2 * u ** 3 + 3 * u ** 2) * 1.0 +
               (u ** 3 - u ** 2) * run * end_slope)
    ys = np.where(xs > high, hermite, ys)
    ys[0] = 0.0
    # A flat run in a tone curve is a band of scene values that all render to
    # one number, which shows as posterisation. Smooth the measurement, then
    # force a minimum slope between knots so no run can be flat at all.
    # One pass, not three: smoothing a curve that is convex almost everywhere
    # drags it downwards, and three passes cost about a lightness unit of the
    # very brightness this curve exists to recover.
    inner = ys.copy()
    inner[1:-1] = (inner[:-2] + 2 * inner[1:-1] + inner[2:]) / 4
    ys = inner
    for i in range(1, KNOTS):
        floor = ys[i - 1] + 0.05 * (xs[i] - xs[i - 1])
        if ys[i] < floor:
            ys[i] = floor
    # Sensor white renders as working-space white. When the extension reaches
    # white before the sensor's own ceiling, clamp there rather than rescaling
    # the whole curve: scaling would darken every tone below to fix the top.
    ys = np.clip(ys, 0, 1)
    ys[-1] = 1.0
    xs[-1] = 1.0
    return xs, ys, low, high


def evaluate(matrix, samples):
    """Angular error between the render and the camera's own JPEG, in degrees."""
    rendered_errors = []
    for cam, target, *_rest in samples:
        predicted = cam @ matrix.T
        forward, _inverse = monotone_curve(predicted, target)
        if forward is None:
            continue
        rendered = forward(predicted)
        a = rendered / np.clip(np.linalg.norm(rendered, axis=1, keepdims=True), 1e-9, None)
        b = target / np.clip(np.linalg.norm(target, axis=1, keepdims=True), 1e-9, None)
        rendered_errors.append(np.degrees(np.arccos(np.clip((a * b).sum(axis=1), -1, 1))))
    if not rendered_errors:
        return None
    joined = np.concatenate(rendered_errors)
    return {"mean": float(joined.mean()), "median": float(np.median(joined)),
            "p95": float(np.percentile(joined, 95)), "samples": int(joined.size)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--decoder", default="native/build/lenslabs-raw-decode")
    parser.add_argument("--files", required=True, help="glob of RAW files")
    parser.add_argument("--train", type=int, default=20)
    parser.add_argument("--test", type=int, default=20)
    parser.add_argument("--grid", type=int, default=128)
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    paths = sorted(glob.glob(os.path.expanduser(args.files)))
    if not paths:
        raise SystemExit("no files matched")
    random.Random(args.seed).shuffle(paths)

    with tempfile.TemporaryDirectory(prefix="fit-raw-profile-") as work:
        def collect(which, label):
            print(f"gathering {len(which)} {label} frames…", file=sys.stderr)
            out = []
            for path in which:
                try:
                    sample = gather(args.decoder, path, work, args.grid)
                except subprocess.CalledProcessError:
                    print(f"  skipped (decoder refused) {os.path.basename(path)}", file=sys.stderr)
                    continue
                if len(sample[0]) < 200 or len(sample[3]) < 200:
                    print(f"  skipped (too few usable cells) {os.path.basename(path)}", file=sys.stderr)
                    continue
                out.append(sample)
            return out

        train = collect(paths[:args.train], "training")
        test = collect(paths[args.train:args.train + args.test], "held-out")

    if not train:
        raise SystemExit("no usable training frames")
    matrix, camera_to_xyz, forward, observed = fit(train)
    neutral = np.mean([s[2] for s in train], axis=0)

    print("\ncamera -> XYZ (D65); every entry is a non-negative response:")
    print(np.array2string(camera_to_xyz, precision=4))
    print("implied primaries:")
    for index, name in enumerate("RGB"):
        column = camera_to_xyz[:, index]
        total = column.sum()
        print(f"  {name}  xy {column[0] / total:.4f} {column[1] / total:.4f}")
    print("\ncamera (white balanced) -> linear sRGB:")
    print(np.array2string(matrix, precision=4))
    print(f"\ntraining as-shot neutral: {neutral[0]:.5f} {neutral[1]:.5f} {neutral[2]:.5f}")

    # The decoder wants XYZ(D50) -> camera at the calibration illuminant. For
    # daylight training frames that is named D65, where the two chromatic
    # adaptations in camera_to_working() cancel, leaving:
    colour_matrix = np.diag(neutral) @ np.linalg.inv(matrix) @ XYZ_TO_SRGB
    print("\nColorMatrix1 (XYZ D50 -> camera), CalibrationIlluminant1 = 21 (D65):")
    print("    {", ", ".join(f"{v:.4f}" for v in colour_matrix.flatten()), "},")

    curve = tone_curve_knots(forward, observed) if forward is not None else None
    if curve is not None:
        xs, ys, low, high = curve
        print(f"\nbaseline tone curve, measured over scene values "
              f"{low:.4f} to {high:.4f}; {KNOTS} knots, linear in and out:")
        print("     {true,")
        print("      {" + ", ".join(f"{v:.6f}" for v in xs) + "},")
        print("      {" + ", ".join(f"{v:.6f}" for v in ys) + "}},")
        mid = float(np.interp(0.18, xs, ys))
        print(f"    (0.18 scene renders at {mid:.4f} linear, "
              f"{100 * (1.055 * mid ** (1 / 2.4) - 0.055):.1f}% encoded)")

    for label, which in (("training", train), ("held out", test)):
        stats = evaluate(matrix, which)
        if not stats:
            continue
        print(f"\n{label}: {stats['samples']} cells, angular error against the camera's own "
              f"JPEG: mean {stats['mean']:.2f} deg, median {stats['median']:.2f} deg, "
              f"95th {stats['p95']:.2f} deg")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
