import { afterEach, beforeEach, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

let db: ReturnType<typeof openDatabase>;
let app: ReturnType<typeof createApp>;
const at = "2026-03-10T12:00:00Z";
const change = { reason: "revisar", deadline_date: "2026-03-12", at };
beforeEach(() => { db = openDatabase(); app = createApp(db); app.onError(() => new Response("storage failure", { status: 500 })); });
afterEach(() => db.close());
async function post(path: string, input: unknown) {
  return app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
}
async function create() {
  const response = await post("/scripts", { body: "v1", at });
  return (await response.json() as { id: string }).id;
}

it("falha na versão inicial não deixa roteiro órfão e permite retry", async () => {
  db.exec("CREATE TRIGGER fail_write BEFORE INSERT ON versions BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  expect((await post("/scripts", { body: "v1", at })).status).toBe(500);
  expect(db.prepare("SELECT COUNT(*) AS n FROM scripts").get()).toEqual({ n: 0 });
  db.exec("DROP TRIGGER fail_write");
  expect((await post("/scripts", { body: "v1", at })).status).toBe(201);
  expect(db.prepare("SELECT COUNT(*) AS n FROM scripts").get()).toEqual({ n: 1 });
});

it.each(["change-requests", "versions", "approval"])("falha no status de %s desfaz toda a transição e permite retry", async (action) => {
  const id = await create();
  if (action === "versions") expect((await post(`/scripts/${id}/change-requests`, change)).status).toBe(201);
  const before = await (await app.request(`/scripts/${id}`)).json();
  db.exec("CREATE TRIGGER fail_write BEFORE UPDATE ON scripts BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  const input = action === "change-requests" ? change : action === "versions" ? { body: "v2", at } : { at };
  expect((await post(`/scripts/${id}/${action}`, input)).status).toBe(500);
  expect(await (await app.request(`/scripts/${id}`)).json()).toEqual(before);
  db.exec("DROP TRIGGER fail_write");
  expect((await post(`/scripts/${id}/${action}`, input)).status).toBe(201);
});
