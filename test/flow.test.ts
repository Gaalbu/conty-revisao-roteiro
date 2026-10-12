import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

type Script = { id: string; status: string; allowed_actions: { brand: string[]; creator: string[] } };

describe("estado explícito em cada passo", () => {
  it("cada resposta do fluxo diz o estado e o que cada lado pode fazer", async () => {
    const app = createApp(openDatabase());
    const post = async (path: string, body: unknown) =>
      (await (await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json()) as Script;

    const created = await post("/scripts", { body: "Abre com o produto na mão.", at: "2026-03-10T12:00:00.000Z" });
    expect(created).toMatchObject({ status: "awaiting_review", allowed_actions: { brand: ["request_changes", "approve"], creator: [] } });
    const asked = await post(`/scripts/${created.id}/change-requests`, { reason: "Mostrar o preço", deadline_date: "2026-03-12", at: "2026-03-11T15:00:00.000Z" });
    expect(asked).toMatchObject({ status: "changes_requested", allowed_actions: { brand: [], creator: ["submit_version"] } });
    const second = await post(`/scripts/${created.id}/versions`, { body: "Abre com o preço na tela.", at: "2026-03-12T10:00:00.000Z" });
    expect(second).toMatchObject({ status: "awaiting_review", allowed_actions: { brand: ["request_changes", "approve"], creator: [] } });
    const approved = await post(`/scripts/${created.id}/approval`, { at: "2026-03-12T18:00:00.000Z" });
    expect(approved).toMatchObject({ status: "approved", allowed_actions: { brand: [], creator: [] } });
  });
});

describe("disputa entre conexões", () => {
  it("aprovação e pedido de alteração na mesma versão, em threads diferentes: só um vence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "roteiro-"));
    const path = join(dir, "shared.sqlite");
    try {
      const db = openDatabase(path);
      const app = createApp(db);
      const created = (await (await app.request("/scripts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "v1", at: "2026-03-10T12:00:00.000Z" }) })).json()) as { id: string };
      const flags = new Int32Array(new SharedArrayBuffer(8));
      const actions = [
        { route: `/scripts/${created.id}/approval`, body: { at: "2026-03-11T12:00:00.000Z" } },
        { route: `/scripts/${created.id}/change-requests`, body: { reason: "trocar", deadline_date: "2026-03-20", at: "2026-03-11T12:00:00.000Z" } },
        { route: `/scripts/${created.id}/approval`, body: { at: "2026-03-11T12:00:00.000Z" } },
        { route: `/scripts/${created.id}/change-requests`, body: { reason: "trocar", deadline_date: "2026-03-20", at: "2026-03-11T12:00:00.000Z" } },
      ];
      const results = actions.map((action) => {
        const worker = new Worker(new URL("./post-worker.ts", import.meta.url), {
          workerData: { dbPath: path, flags, ...action },
          execArgv: ["--experimental-strip-types", "--disable-warning=ExperimentalWarning"],
        });
        return new Promise<number>((resolve, reject) => {
          worker.once("message", resolve);
          worker.once("error", reject);
        });
      });
      while (Atomics.load(flags, 1) < actions.length) await new Promise((resolve) => setTimeout(resolve, 5));
      Atomics.store(flags, 0, 1);
      Atomics.notify(flags, 0);
      const statuses = await Promise.all(results);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(3);
      const counts = db.prepare("SELECT (SELECT COUNT(*) FROM approvals) + (SELECT COUNT(*) FROM change_requests) AS n").get() as { n: number };
      expect(counts.n).toBe(1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
