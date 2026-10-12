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
