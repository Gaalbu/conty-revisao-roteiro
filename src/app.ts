import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { body, BodyError, MAX_BODY_BYTES } from "./body.ts";
import type { Context } from "hono";
import { approve, createScript, readScript, requestChanges, submitVersion } from "./review.ts";
import type { Outcome } from "./review.ts";

function reply(c: Context, outcome: Outcome) {
  return c.json(outcome.body, outcome.status);
}

export function createApp(db: DatabaseSync) {
  const app = new Hono();

  app.use("*", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "corpo acima de 64 KB" }, 413) }));
  app.onError((error, c) => {
    if (error instanceof BodyError) return c.json(error.payload, error.status);
    // Erro inesperado: 500 em JSON genérico, sem stack na resposta; o detalhe vai para o log.
    console.error(error);
    return c.json({ error: "erro interno" }, 500);
  });

  app.post("/scripts", async (c) => reply(c, createScript(db, await body(c, ["body", "at"]))));
  app.post("/scripts/:id/change-requests", async (c) =>
    reply(c, requestChanges(db, c.req.param("id"), await body(c, ["reason", "deadline_date", "at"]))),
  );
  app.post("/scripts/:id/versions", async (c) => reply(c, submitVersion(db, c.req.param("id"), await body(c, ["body", "at"]))));
  app.post("/scripts/:id/approval", async (c) => reply(c, approve(db, c.req.param("id"), await body(c, ["at"]))));
  app.get("/scripts/:id", (c) => {
    const script = readScript(db, c.req.param("id"));
    return script ? c.json(script) : c.json({ error: "roteiro não encontrado" }, 404);
  });

  app.notFound((c) => c.json({ error: "rota não encontrada" }, 404));

  return app;
}
