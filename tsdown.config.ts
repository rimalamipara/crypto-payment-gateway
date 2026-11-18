import { isBuiltin } from "node:module";
import { defineConfig } from "tsdown";

const optionalNestDependencies = [
  /^@nestjs\/microservices(?:\/|$)/,
  /^@nestjs\/platform-socket\.io(?:\/|$)/,
  /^@nestjs\/websockets(?:\/|$)/,
  /^class-transformer(?:\/|$)/,
  /^class-validator(?:\/|$)/,
];

// Kept external, loaded from node_modules at runtime (install dependencies on the
// host before `npm start`):
//  - native addons (bcrypt) find their .node binary relative to their own files;
//  - every @nestjs/* package, so there is exactly one copy of Nest. Bundling core
//    while the websocket packages load their own copy breaks `instanceof` checks
//    ("server.listeners is not a function" when the socket adapter starts).
const nativeDependencies = [
  /^bcrypt(?:\/|$)/,
  /^node-gyp-build(?:\/|$)/,
  /^@nestjs\//,
];

export default defineConfig({
  entry: { server: "src/main.ts" },
  platform: "node",
  target: "node22.18",
  format: "esm",
  clean: true,
  hash: false,
  outputOptions: {
    codeSplitting: false,
  },
  deps: {
    onlyBundle: false,
    alwaysBundle: (id) =>
      !isBuiltin(id) &&
      !optionalNestDependencies.some((pattern) => pattern.test(id)) &&
      !nativeDependencies.some((pattern) => pattern.test(id)),
    neverBundle: [...optionalNestDependencies, ...nativeDependencies],
  },
});
