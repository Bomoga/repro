#!/usr/bin/env node
// The `repro` executable: loads the TypeScript CLI through tsx, like the rest of the workspace
// (packages export their src/ directly, no build step).
import { register } from "tsx/esm/api";

register();
await import("../src/main.ts");
