/* Records the image the route would send to the vision model. */
export async function extractLogoColors(image) {
  globalThis.__visionImage = image;
  return {
    primary: "#000000",
    secondary: "#ffffff",
    accents: [],
    failed: false,
  };
}
