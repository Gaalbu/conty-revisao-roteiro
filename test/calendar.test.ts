import { afterAll, afterEach, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

const db = openDatabase();
const app = createApp(db);
afterAll(() => db.close());
afterEach(() => db.exec("DELETE FROM change_requests; DELETE FROM versions; DELETE FROM scripts"));

it.each(["2026-99-99", "2026-02-29", "2028-02-30", "2026-04-31", "2026-00-10"])(
  "recusa prazo impossível %s sem mudar o roteiro", async (deadline) => {
    const created = await app.request("/scripts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "v1", at: "2026-01-01T12:00:00Z" }) });
    const { id } = await created.json() as { id: string };
    const response = await app.request(`/scripts/${id}/change-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "revisar", deadline_date: deadline, at: "2026-01-01T12:00:00Z" }) });
    expect(response.status).toBe(400);
    expect(db.prepare("SELECT status FROM scripts WHERE id = ?").get(id)).toEqual({ status: "awaiting_review" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM change_requests").get()).toEqual({ n: 0 });
  },
);

it("aceita 29 de fevereiro em ano bissexto", async () => {
  const created = await app.request("/scripts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "v1", at: "2028-02-28T12:00:00Z" }) });
  const { id } = await created.json() as { id: string };
  const response = await app.request(`/scripts/${id}/change-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "revisar", deadline_date: "2028-02-29", at: "2028-02-28T12:00:00Z" }) });
  expect(response.status).toBe(201);
});
