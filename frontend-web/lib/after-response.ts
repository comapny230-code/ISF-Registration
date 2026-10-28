import { after } from "next/server";
import { getAppEnv } from "./config";

/**
 * Runs work after the response has been sent (so its duration cannot reveal
 * anything to the caller). In tests it runs inline so results can be asserted.
 */
export async function afterResponse(task: () => Promise<unknown>): Promise<void> {
  const run = async () => {
    try {
      await task();
    } catch (err) {
      console.error("[DEFERRED TASK ERROR]", { name: (err as any)?.name, message: (err as any)?.message });
    }
  };
  if (getAppEnv() === "test") {
    await run();
    return;
  }
  after(run);
}
