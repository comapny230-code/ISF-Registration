/**
 * Runs once when the Next.js server starts. Misconfiguration is logged by
 * variable name only; route handlers independently refuse to serve (503).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateRuntimeConfig } = await import("./lib/config");
  const errors = validateRuntimeConfig();
  if (errors.length > 0) {
    console.error(
      "[CONFIG] Runtime configuration is invalid; affected endpoints will return 503:",
      errors.map((e) => e.message)
    );
  }
}
