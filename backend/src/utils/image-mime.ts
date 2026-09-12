/*
 * The image types a rendered page can embed, keyed by file extension.
 *
 * One table, used by the upload tool (what may be signed for), the attach verb
 * (what may become a picture node) and the readers (is this Material's file a
 * picture at all). Rendering understands raster pictures plus SVG, which is
 * rasterized at layout — so this is the whole allowlist.
 */
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

/** The image MIME for a path or URI, or null when its extension is not an image. */
export function imageMimeFor(pathOrUri: string): string | null {
  const dot = pathOrUri.lastIndexOf(".");
  const ext = dot < 0 ? "" : pathOrUri.slice(dot + 1).toLowerCase();
  return IMAGE_MIME[ext] ?? null;
}

/** The extensions `imageMimeFor` accepts, for messages. */
export const IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME);
