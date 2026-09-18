/** Magnifier that follows the end of a guide being drawn, so the line can be
 * put on the edge of a window frame rather than near it. Purely a view of the
 * displayed preview: it reads no pixels back and changes no settings.
 */
const SIZE = 132;
const ZOOM = 3;

export function UprightLoupe({
  url,
  x,
  y,
  width,
  height,
}: {
  url: string;
  /** Pointer position in normalized image coordinates. */
  x: number;
  y: number;
  /** Displayed image size in CSS pixels. */
  width: number;
  height: number;
}) {
  // Keep the loupe inside the frame, and out from under the fingertip.
  const left = Math.min(Math.max(x * width + 24, 4), Math.max(4, width - SIZE - 4));
  const top = Math.min(Math.max(y * height - SIZE - 24, 4), Math.max(4, height - SIZE - 4));
  return (
    <div
      className="develop-loupe"
      style={{ left, top, width: SIZE, height: SIZE }}
      aria-hidden="true"
    >
      <div
        className="develop-loupe-view"
        style={{
          backgroundImage: `url("${url}")`,
          backgroundSize: `${width * ZOOM}px ${height * ZOOM}px`,
          backgroundPosition: `${SIZE / 2 - x * width * ZOOM}px ${SIZE / 2 - y * height * ZOOM}px`,
        }}
      />
      <div className="develop-loupe-cross" />
    </div>
  );
}
