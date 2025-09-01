import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],  // your app entry point
  format: ["esm"],          // "cjs" if you also need CommonJS
  dts: false,               // true if you need .d.ts (for libs)
  sourcemap: true,
  target: "node20",
  clean: true,              // clear dist before build
  outDir: "dist"
});