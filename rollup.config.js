import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";

export default {
  input: "src/main.ts",
  output: {
    dir: ".",
    sourcemap: false,
    format: "cjs",
    exports: "default",
    inlineDynamicImports: true,
  },
  external: ["obsidian"],
  plugins: [typescript({ exclude: ["test/**"] }), nodeResolve({ browser: true }), commonjs(), json()],
};
