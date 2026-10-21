/**
 * TEMPORARY (deleted with /feat-033-preview before merge).
 *
 * Builds the preview harness's fixture images into public/feat-033-preview/
 * (gitignored) from source photos, so no binary is ever committed. Three
 * direction designs are drawn as 1080x1350 PNGs (the third is what a
 * regenerate swaps in); the uploaded-image fixtures are downscaled.
 *
 * Usage: node scripts/feat-033-preview-fixtures.mjs [sourceDir]
 *   sourceDir defaults to /tmp/feat-033/fixtures (cutout.png, photo-b.jpg)
 */

import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const source = process.argv[2] ?? "/tmp/feat-033/fixtures";
const out = path.join(process.cwd(), "public", "feat-033-preview");
mkdirSync(out, { recursive: true });

const dataUri = (file, type) =>
  `data:${type};base64,${readFileSync(path.join(source, file)).toString("base64")}`;
const cutout = dataUri("cutout.png", "image/png");
const photo = dataUri("photo-b.jpg", "image/jpeg");

const FONT =
  "<link rel='stylesheet' href='https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,700;1,700&family=Montserrat:wght@500;700&display=swap'>";

const directionOne = `${FONT}
<body style="margin:0;width:1080px;height:1350px;background:#9b1c2e;position:relative;overflow:hidden;font-family:Montserrat">
  <div style="position:absolute;left:-120px;right:-120px;bottom:-420px;height:900px;border-radius:50%;background:#fff6ea"></div>
  <div style="position:absolute;right:-80px;top:260px;width:480px;height:480px;border-radius:50%;border:40px solid #e88a8f"></div>
  <div style="position:absolute;right:250px;top:150px;width:110px;height:110px;border-radius:50%;background:#f4b740"></div>
  <p style="position:absolute;left:80px;top:70px;margin:0;font:700 44px Fraunces;color:#fff6ea">The Pastry</p>
  <p style="position:absolute;left:80px;top:190px;margin:0;font:700 22px Montserrat;letter-spacing:8px;color:#f2a7ad">EVERYDAY INDULGENCE</p>
  <p style="position:absolute;left:80px;top:250px;width:560px;margin:0;font:700 118px/1.02 Fraunces;color:#fff6ea">Make today a little sweeter.</p>
  <img src="${cutout}" style="position:absolute;right:20px;bottom:240px;width:560px;filter:drop-shadow(0 30px 40px rgba(0,0,0,.25))">
  <p style="position:absolute;left:80px;bottom:250px;width:440px;margin:0;font:500 28px/1.5 Montserrat;color:#4a1018">Thoughtfully crafted pastries for the little moments that deserve something special.</p>
  <div style="position:absolute;left:80px;bottom:110px;padding:26px 44px;border-radius:999px;background:#9b1c2e;color:#fff6ea;font:700 28px Montserrat;letter-spacing:3px">ORDER YOUR TREAT →</div>
</body>`;

const directionTwo = `${FONT}
<body style="margin:0;width:1080px;height:1350px;background:#fff6ea;position:relative;overflow:hidden;font-family:Montserrat">
  <p style="position:absolute;left:0;right:0;top:70px;margin:0;text-align:center;font:700 46px Fraunces;color:#9b1c2e">The Pastry</p>
  <p style="position:absolute;left:0;right:0;top:136px;margin:0;text-align:center;font:700 20px Montserrat;letter-spacing:10px;color:#9b1c2e">EVERYDAY INDULGENCE</p>
  <div style="position:absolute;left:110px;top:210px;width:860px;height:860px;border-radius:50%;background:#f8d3d3"></div>
  <div style="position:absolute;left:220px;top:230px;width:640px;height:700px;border-radius:320px 320px 24px 24px;background:#e88a8f"></div>
  <img src="${cutout}" style="position:absolute;left:250px;top:360px;width:580px;filter:drop-shadow(0 24px 30px rgba(0,0,0,.2))">
  <div style="position:absolute;right:150px;top:820px;width:170px;height:170px;border-radius:50%;background:#9b1c2e;color:#fff6ea;display:flex;align-items:center;justify-content:center;text-align:center;font:700 italic 30px/1.1 Fraunces;transform:rotate(-12deg)">Fresh<br>daily</div>
  <p style="position:absolute;left:0;right:0;top:960px;margin:0;text-align:center;font:italic 700 92px/1.05 Fraunces;color:#9b1c2e">Make today<br>a little sweeter.</p>
  <div style="position:absolute;left:50%;bottom:90px;transform:translateX(-50%);padding:24px 44px;border-radius:999px;background:#9b1c2e;color:#fff6ea;font:700 26px Montserrat;letter-spacing:3px;white-space:nowrap">ORDER YOUR TREAT →</div>
</body>`;

const directionThree = `${FONT}
<body style="margin:0;width:1080px;height:1350px;background:#1d3b2f;position:relative;overflow:hidden;font-family:Montserrat">
  <div style="position:absolute;left:0;right:0;top:0;height:760px;background:#f3e6cf"></div>
  <img src="${cutout}" style="position:absolute;left:-10px;top:-170px;width:1100px;filter:drop-shadow(0 30px 36px rgba(0,0,0,.22))">
  <p style="position:absolute;left:90px;top:820px;margin:0;font:700 22px Montserrat;letter-spacing:8px;color:#d9b77a">FRESH EVERY MORNING</p>
  <p style="position:absolute;left:90px;top:866px;width:900px;margin:0;font:700 88px/1.04 Fraunces;color:#f3e6cf">Layers worth slowing down for.</p>
  <div style="position:absolute;left:90px;bottom:100px;padding:24px 44px;border-radius:12px;background:#d9b77a;color:#1d3b2f;font:700 26px Montserrat;letter-spacing:3px">VISIT THE PASTRY</div>
</body>`;

const fitted = (src, w, h) =>
  `<body style="margin:0;width:${w}px;height:${h}px"><img src="${src}" style="width:${w}px;height:${h}px;object-fit:cover"></body>`;

/* CHROMIUM_PATH lets an older cached browser stand in when the pinned
   playwright build has not been downloaded on this machine. */
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {},
);
async function shoot(html, file, width, height, type = "png") {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.screenshot({
    path: path.join(out, file),
    type,
    ...(type === "jpeg" ? { quality: 82 } : { omitBackground: true }),
  });
  await page.close();
}

await shoot(directionOne, "direction-1.png", 1080, 1350);
await shoot(directionTwo, "direction-2.png", 1080, 1350);
await shoot(directionThree, "direction-3.png", 1080, 1350);
await shoot(
  `<body style="margin:0;background:transparent"><img src="${cutout}" style="width:800px;height:800px"></body>`,
  "upload-cutout.png",
  800,
  800,
);
await shoot(fitted(photo, 1200, 800), "upload-photo.jpg", 1200, 800, "jpeg");
await browser.close();
console.log(`fixtures written to ${out}`);
