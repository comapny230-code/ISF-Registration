/**
 * Lets operator scripts (node --experimental-transform-types) import the app's TypeScript
 * modules, which use extension-less and "@/" imports that only the bundler resolves:
 *
 *   node --experimental-transform-types --import ./scripts/node-ts-hooks.mjs scripts/<script>.mts
 */
import { register } from "node:module";

register(
  `data:text/javascript,${encodeURIComponent(`
    const root = ${JSON.stringify(new URL("../", import.meta.url).href)};
    export async function resolve(specifier, context, next) {
      const spec = specifier.startsWith("@/") ? root + specifier.slice(2) : specifier;
      try {
        return await next(spec, context);
      } catch (err) {
        if (err?.code !== "ERR_MODULE_NOT_FOUND" || !(spec.startsWith(".") || spec.startsWith("file:"))) throw err;
        for (const suffix of [".ts", ".tsx", "/index.ts"]) {
          try {
            return await next(spec + suffix, context);
          } catch {}
        }
        throw err;
      }
    }
  `)}`
);
