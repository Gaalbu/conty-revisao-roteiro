import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

type App = ReturnType<typeof createApp>;

function post(app: App, path: string, payload: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function createScript(app: App): Promise<string> {
  const res = await post(app, "/scripts", { body: "Abre com o produto na mão.", at: "2026-03-10T12:00:00.000Z" });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("revisão de roteiro", () => {
  let app: App;

  beforeEach(() => {
    app = createApp(openDatabase());
  });

  it("percorre o fluxo inteiro e termina aprovado com as duas versões", async () => {
    const id = await createScript(app);

    const change = await post(app, `/scripts/${id}/change-requests`, {
      reason: "Mostrar o preço no primeiro terço",
      deadline_date: "2026-03-12",
      at: "2026-03-11T15:00:00.000Z",
    });
    expect(change.status).toBe(201);
    expect(((await change.json()) as { status: string }).status).toBe("changes_requested");

    const version = await post(app, `/scripts/${id}/versions`, {
      body: "Abre com o preço na tela.",
      at: "2026-03-12T10:00:00.000Z",
    });
    expect(version.status).toBe(201);

    const approval = await post(app, `/scripts/${id}/approval`, { at: "2026-03-12T18:00:00.000Z" });
    expect(approval.status).toBe(201);

    const res = await app.request(`/scripts/${id}`);
    const script = (await res.json()) as {
      status: string;
      timezone: string;
      versions: Array<{ id: string; number: number; change_requests: Array<{ reason: string }> }>;
      approval: { version_id: string } | null;
    };
    expect(script.status).toBe("approved");
    expect(script.timezone).toBe("America/Sao_Paulo");
    expect(script.versions.map((v) => v.number)).toEqual([1, 2]);
    expect(script.versions[0]?.change_requests[0]?.reason).toBe("Mostrar o preço no primeiro terço");
    expect(script.approval?.version_id).toBe(script.versions[1]?.id);
  });

  it("recusa pedido com motivo em branco e com prazo vazio", async () => {
    const id = await createScript(app);

    const noReason = await post(app, `/scripts/${id}/change-requests`, {
      reason: "   ",
      deadline_date: "2026-03-12",
      at: "2026-03-11T15:00:00.000Z",
    });
    expect(noReason.status).toBe(400);
    expect(await noReason.json()).toEqual({ error: "motivo é obrigatório" });

    const noDeadline = await post(app, `/scripts/${id}/change-requests`, {
      reason: "Trocar a trilha",
      deadline_date: "",
      at: "2026-03-11T15:00:00.000Z",
    });
    expect(noDeadline.status).toBe(400);
    expect(await noDeadline.json()).toEqual({ error: "prazo é obrigatório" });
  });

  it("aceita o pedido no último milissegundo do dia do prazo em São Paulo (02:59:59.999Z)", async () => {
    const id = await createScript(app);
    const res = await post(app, `/scripts/${id}/change-requests`, {
      reason: "Trocar a trilha",
      deadline_date: "2026-03-12",
      at: "2026-03-13T02:59:59.999Z",
    });
    expect(res.status).toBe(201);
  });

  it("recusa o pedido à meia-noite seguinte em São Paulo (03:00:00.000Z) com prazo encerrado", async () => {
    const id = await createScript(app);
    const res = await post(app, `/scripts/${id}/change-requests`, {
      reason: "Trocar a trilha",
      deadline_date: "2026-03-12",
      at: "2026-03-13T03:00:00.000Z",
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "prazo encerrado" });
  });

  it("roteiro aprovado recusa versão, pedido de mudança e segunda aprovação", async () => {
    const id = await createScript(app);
    expect((await post(app, `/scripts/${id}/approval`, { at: "2026-03-11T12:00:00.000Z" })).status).toBe(201);

    const version = await post(app, `/scripts/${id}/versions`, { body: "outra", at: "2026-03-11T13:00:00.000Z" });
    expect(version.status).toBe(409);

    const change = await post(app, `/scripts/${id}/change-requests`, {
      reason: "Trocar a trilha",
      deadline_date: "2026-03-20",
      at: "2026-03-11T13:00:00.000Z",
    });
    expect(change.status).toBe(409);

    const again = await post(app, `/scripts/${id}/approval`, { at: "2026-03-11T14:00:00.000Z" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "roteiro aprovado não reabre" });
  });

  it("não pula estado: versão sem pedido aberto, segundo pedido aberto e aprovação com pedido pendente dão 409", async () => {
    const id = await createScript(app);
    expect((await post(app, `/scripts/${id}/versions`, { body: "v2", at: "2026-03-11T12:00:00.000Z" })).status).toBe(
      409,
    );

    const request = { reason: "Trocar a trilha", deadline_date: "2026-03-20", at: "2026-03-11T12:00:00.000Z" };
    expect((await post(app, `/scripts/${id}/change-requests`, request)).status).toBe(201);
    expect((await post(app, `/scripts/${id}/change-requests`, request)).status).toBe(409);
    expect((await post(app, `/scripts/${id}/approval`, { at: "2026-03-11T13:00:00.000Z" })).status).toBe(409);
  });

  it("responde 404 para roteiro inexistente e 400 para roteiro vazio", async () => {
    expect((await app.request("/scripts/scr_nao_existe")).status).toBe(404);
    expect((await post(app, "/scripts", { body: "", at: "2026-03-10T12:00:00.000Z" })).status).toBe(400);
  });
});
