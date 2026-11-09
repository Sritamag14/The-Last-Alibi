import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const required = ["public/index.html", "public/app.js", "public/style.css", "cases.js", "netlify/functions/game.ts", "netlify/game-engine.ts"];
for (const file of required) {
  if (!existsSync(file)) throw new Error(`Missing deployment file: ${file}`);
}
const html = readFileSync("public/index.html", "utf8");
if (!html.includes("/public/app.js") || !html.includes("/public/style.css")) {
  throw new Error("The static page must reference its deployable assets.");
}
const output = resolve("work/netlify-function-build/game.mjs");
await mkdir(resolve("work/netlify-function-build"), { recursive: true });
await build({ entryPoints: ["netlify/functions/game.ts"], outfile: output, bundle: true, platform: "node", format: "esm", target: "node22" });
console.log("Static assets verified and the production Netlify Function bundle compiled.");
