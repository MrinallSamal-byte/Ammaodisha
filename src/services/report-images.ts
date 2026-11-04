export const ODISHA_GARBAGE_FALLBACK_IMAGE = {
  photo_url: "https://www.orissapost.com/wp-content/uploads/2025/09/Daringbadi.jpg",
  source_page: "https://www.orissapost.com/garbage-dumps-tarnish-daringbadis-kashmir-of-odisha-image/",
  title: "Garbage dumps tarnish Daringbadi's Kashmir of Odisha image",
  credit: "OrissaPOST",
  license: null,
  width: 1280,
  height: 545
} as const;

export const LOCAL_REPORT_PHOTO_FALLBACK_URL = "/garbage-about.jpg";

/** Maximum accepted upload size — larger files crash/freeze low-end phones during canvas compression. */
export const MAX_IMAGE_FILE_BYTES = 15 * 1024 * 1024;

/** Validate a user-picked photo; returns a human-readable error or null when acceptable. */
export function validateImageFile(file: File): string | null {
  if (!file.type || !file.type.startsWith("image/")) {
    return "Only image files are supported. Choose a photo from your camera or gallery.";
  }
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    return "That photo is larger than 15 MB. Choose a smaller image — phone cameras can save with less detail.";
  }
  return null;
}
