export type AllowedUploadKind = "jpg" | "png" | "webp" | "pdf";

/** Detect file type from magic bytes (do not trust client MIME alone). */
export function detectUploadKind(buffer: Buffer): AllowedUploadKind | null {
  if (buffer.length < 4) return null;

  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";

  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "png";
  }

  // PDF
  if (buffer.subarray(0, 4).toString("ascii") === "%PDF") return "pdf";

  // WebP (RIFF....WEBP)
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

export function mimeForUploadKind(kind: AllowedUploadKind): string {
  switch (kind) {
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
  }
}
