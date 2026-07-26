import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"], // only available inside a real Extension Host, never bundled
  platform: "node",
  format: "cjs",
  target: "node18",
  sourcemap: true,
});

console.log("Built dist/extension.js");
