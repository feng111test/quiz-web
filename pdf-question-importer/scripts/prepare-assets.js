import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const trainedData = require.resolve("@tesseract.js-data/chi_sim/package.json");
const modelPath = join(dirname(trainedData), "4.0.0", "chi_sim.traineddata.gz");
const outputDirectory = join(projectRoot, "..", "public", "tessdata");

await mkdir(outputDirectory, { recursive: true });
await copyFile(modelPath, join(outputDirectory, "chi_sim.traineddata.gz"));
