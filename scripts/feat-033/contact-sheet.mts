/**
 * Puts renders side by side at 540 px wide, for a person to look at a set
 * of directions at once.
 *
 * Usage: tsx scripts/feat-033/contact-sheet.mts <out.png> <a.png> [b.png ...]
 */
import sharp from "sharp";

const [out, ...inputs] = process.argv.slice(2);
if (!out || inputs.length === 0) {
  console.error("usage: contact-sheet.mts <out.png> <a.png> [b.png ...]");
  process.exit(1);
}
const WIDTH = 540;
const GAP = 12;
const tiles = await Promise.all(
  inputs.map(async (file) => {
    const buffer = await sharp(file).resize({ width: WIDTH }).png().toBuffer();
    const { height = 0 } = await sharp(buffer).metadata();
    return { buffer, height };
  }),
);
const height = Math.max(...tiles.map((t) => t.height));
await sharp({
  create: {
    width: tiles.length * WIDTH + (tiles.length - 1) * GAP,
    height,
    channels: 3,
    background: "#ffffff",
  },
})
  .composite(
    tiles.map((t, i) => ({ input: t.buffer, left: i * (WIDTH + GAP), top: 0 })),
  )
  .png()
  .toFile(out);
console.log(out);
