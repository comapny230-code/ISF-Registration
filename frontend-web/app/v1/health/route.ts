import { getDb } from "@/lib/db";
import { handler, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Uptime check for monitoring: 200 when the app can reach its database, 503 otherwise.
 * Public by design; it reveals no versions, configuration or error details.
 */
export const GET = handler(async (_request, { requestId }) => {
  try {
    const sql = await getDb();
    await Promise.race([
      sql`select 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error("database check timed out")), 3000)),
    ]);
    return json({ status: "ok" }, 200, requestId);
  } catch (err) {
    console.error("[HEALTH] database unreachable", { name: (err as Error)?.name, message: (err as Error)?.message });
    return json({ status: "unavailable" }, 503, requestId);
  }
});
