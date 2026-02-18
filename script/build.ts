import { build as esbuild, transform } from "esbuild";
import { rm, readFile, copyFile, writeFile } from "fs/promises";

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];

  // Bundle these deps into the output to reduce cold-start syscalls
  const bundleAllowlist = [
    "archiver",
    "ejs",
    "marked",
  ];

  const externals = allDeps.filter((dep) => !bundleAllowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: "dist/index.mjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    banner: {
      // Provide require() in ESM context for native addons (better-sqlite3)
      js: 'import{createRequire}from"module";const require=createRequire(import.meta.url);',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // Copy client-side vendor scripts to public/
  console.log("\nvendoring client scripts...");

  await copyFile("node_modules/htmx.org/dist/htmx.min.js", "public/htmx.min.js");
  console.log("  public/htmx.min.js");

  // Minify qrcode-generator (ships unminified)
  const qrSrc = await readFile("node_modules/qrcode-generator/qrcode.js", "utf-8");
  const qrMinified = await transform(qrSrc, { minify: true });
  await writeFile("public/qrcode.min.js", qrMinified.code);
  console.log(`  public/qrcode.min.js (${(qrMinified.code.length / 1024).toFixed(1)}kb from ${(qrSrc.length / 1024).toFixed(1)}kb)`);
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
