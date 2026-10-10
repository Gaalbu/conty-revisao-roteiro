import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { Context } from "hono";
import { approve, createScript, readScript, requestChanges, submitVersion } from "./review.ts";
import type { Outcome } from "./review.ts";

async function body(c: Context): Promise<Record<string, unknown>> {
  const parsed: unknown = await c.req.json().catch(() => ({}));
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

function reply(c: Context, outcome: Outcome) {
  return c.json(outcome.body, outcome.status);
}

export function createApp(db: DatabaseSync) {
  const app = new Hono();

  app.post("/scripts", async (c) => reply(c, createScript(db, await body(c))));
  app.post("/scripts/:id/change-requests", async (c) =>
    reply(c, requestChanges(db, c.req.param("id"), await body(c))),
  );
  app.post("/scripts/:id/versions", async (c) => reply(c, submitVersion(db, c.req.param("id"), await body(c))));
  app.post("/scripts/:id/approval", async (c) => reply(c, approve(db, c.req.param("id"), await body(c))));
  app.get("/scripts/:id", (c) => {
    const script = readScript(db, c.req.param("id"));
    return script ? c.json(script) : c.json({ error: "roteiro não encontrado" }, 404);
  });

  return app;
}
