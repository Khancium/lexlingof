import sharp from "sharp";

export type Frame = { width: number; height: number };

// The backdrop is built from a small copy of the picture and then enlarged, so
// the blur is cheap (a few ms, not a 1600x900 gaussian) and has no visible
// blocks. The extra blur after enlarging only smooths what the enlargement left.
const BACKDROP_SCALE_DOWN = 8;
const BACKDROP_BLUR_SIGMA = 10;

/**
 * Fits the WHOLE picture inside a fixed-size frame and returns it as a WebP of
 * exactly `frame.width` x `frame.height`.
 *
 * The picture is scaled (up or down) until it just fits, centred, and the part
 * of the frame it doesn't reach -- bars at the sides of a tall picture, bars
 * above and below a wide one -- is filled with a soft blurred copy of the same
 * picture, so the bars read as part of the photo rather than as empty
 * letterboxing. Nothing is cut off and nothing is stretched.
 *
 * A picture that is already the frame's ratio fills it exactly and has no bars.
 * EXIF orientation is applied first, so a phone photo taken sideways is framed
 * the way it is viewed.
 */
export async function fitInsideFrame(input: Buffer, frame: Frame, webpQuality: number): Promise<Buffer> {
  const oriented = sharp(input).rotate();

  const foreground = await oriented
    .clone()
    .resize({ width: frame.width, height: frame.height, fit: "inside" })
    .png({ compressionLevel: 1 })
    .toBuffer({ resolveWithObject: true });

  const { width, height } = foreground.info;
  if (width === frame.width && height === frame.height) {
    // No bars to fill.
    return sharp(foreground.data).webp({ quality: webpQuality }).toBuffer();
  }

  const smallBackdrop = await oriented
    .clone()
    .resize({
      width: Math.round(frame.width / BACKDROP_SCALE_DOWN),
      height: Math.round(frame.height / BACKDROP_SCALE_DOWN),
      fit: "cover",
    })
    .png({ compressionLevel: 1 })
    .toBuffer();

  const backdrop = await sharp(smallBackdrop)
    .resize({ width: frame.width, height: frame.height, fit: "fill" })
    .blur(BACKDROP_BLUR_SIGMA)
    .png({ compressionLevel: 1 })
    .toBuffer();

  return sharp(backdrop)
    .composite([
      {
        input: foreground.data,
        left: Math.floor((frame.width - width) / 2),
        top: Math.floor((frame.height - height) / 2),
      },
    ])
    .webp({ quality: webpQuality })
    .toBuffer();
}
