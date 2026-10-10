import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { civilDay, TIMEZONE } from "./civil-day.ts";

export type Status = "awaiting_review" | "changes_requested" | "approved";
export type Outcome = { status: 200 | 201 | 400 | 404 | 409; body: unknown };

type ScriptRow = { id: string; status: Status; timezone: string; created_at: string };
type VersionRow = { id: string; script_id: string; number: number; body: string; created_at: string };
type RequestRow = {
  id: string;
  version_id: string;
  reason: string;
  deadline_date: string;
  requested_at: string;
  answered_by_version_id: string | null;
};
type ApprovalRow = { version_id: string; approved_at: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function validCivilDate(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function fail(status: 400 | 404 | 409, error: string): Outcome {
  return { status, body: { error } };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function instant(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function findScript(db: DatabaseSync, id: string): ScriptRow | undefined {
  return db.prepare("SELECT * FROM scripts WHERE id = ?").get(id) as ScriptRow | undefined;
}

function currentVersion(db: DatabaseSync, scriptId: string): VersionRow {
  return db
    .prepare("SELECT * FROM versions WHERE script_id = ? ORDER BY number DESC LIMIT 1")
    .get(scriptId) as VersionRow;
}

function openRequest(db: DatabaseSync, scriptId: string): RequestRow | undefined {
  return db
    .prepare("SELECT * FROM change_requests WHERE script_id = ? AND answered_by_version_id IS NULL")
    .get(scriptId) as RequestRow | undefined;
}

export function createScript(db: DatabaseSync, input: { body?: unknown; at?: unknown }): Outcome {
  const body = text(input.body);
  if (!body) return fail(400, "texto do roteiro é obrigatório");
  const at = instant(input.at);
  if (!at) return fail(400, "at é obrigatório");

  const id = `scr_${randomUUID()}`;
  db.prepare("INSERT INTO scripts (id, status, timezone, created_at) VALUES (?, 'awaiting_review', ?, ?)").run(
    id,
    TIMEZONE,
    at.toISOString(),
  );
  db.prepare("INSERT INTO versions (id, script_id, number, body, created_at) VALUES (?, ?, 1, ?, ?)").run(
    `ver_${randomUUID()}`,
    id,
    body,
    at.toISOString(),
  );
  return { status: 201, body: readScript(db, id) };
}

export function requestChanges(
  db: DatabaseSync,
  scriptId: string,
  input: { reason?: unknown; deadline_date?: unknown; at?: unknown },
): Outcome {
  const script = findScript(db, scriptId);
  if (!script) return fail(404, "roteiro não encontrado");

  const reason = text(input.reason);
  if (!reason) return fail(400, "motivo é obrigatório");
  const deadline = text(input.deadline_date);
  if (!deadline) return fail(400, "prazo é obrigatório");
  if (!validCivilDate(deadline)) return fail(400, "prazo deve ser uma data válida em YYYY-MM-DD");
  const at = instant(input.at);
  if (!at) return fail(400, "at é obrigatório");

  if (script.status === "approved") return fail(409, "roteiro aprovado não reabre");
  if (script.status === "changes_requested") return fail(409, "já existe pedido de mudança aberto");
  // O prazo vale até o fim do dia civil em São Paulo.
  if (civilDay(at) > deadline) return fail(409, "prazo encerrado");

  const version = currentVersion(db, scriptId);
  db.prepare(
    "INSERT INTO change_requests (id, script_id, version_id, reason, deadline_date, requested_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(`chg_${randomUUID()}`, scriptId, version.id, reason, deadline, at.toISOString());
  db.prepare("UPDATE scripts SET status = 'changes_requested' WHERE id = ?").run(scriptId);
  return { status: 201, body: readScript(db, scriptId) };
}

export function submitVersion(
  db: DatabaseSync,
  scriptId: string,
  input: { body?: unknown; at?: unknown },
): Outcome {
  const script = findScript(db, scriptId);
  if (!script) return fail(404, "roteiro não encontrado");

  const body = text(input.body);
  if (!body) return fail(400, "texto do roteiro é obrigatório");
  const at = instant(input.at);
  if (!at) return fail(400, "at é obrigatório");

  if (script.status === "approved") return fail(409, "roteiro aprovado não reabre");
  const request = openRequest(db, scriptId);
  if (script.status !== "changes_requested" || !request) {
    return fail(409, "não há pedido de mudança aberto");
  }

  const versionId = `ver_${randomUUID()}`;
  const number = currentVersion(db, scriptId).number + 1;
  db.prepare("INSERT INTO versions (id, script_id, number, body, created_at) VALUES (?, ?, ?, ?, ?)").run(
    versionId,
    scriptId,
    number,
    body,
    at.toISOString(),
  );
  db.prepare("UPDATE change_requests SET answered_by_version_id = ? WHERE id = ?").run(versionId, request.id);
  db.prepare("UPDATE scripts SET status = 'awaiting_review' WHERE id = ?").run(scriptId);
  return { status: 201, body: readScript(db, scriptId) };
}

export function approve(db: DatabaseSync, scriptId: string, input: { at?: unknown }): Outcome {
  const script = findScript(db, scriptId);
  if (!script) return fail(404, "roteiro não encontrado");
  const at = instant(input.at);
  if (!at) return fail(400, "at é obrigatório");

  if (script.status === "approved") return fail(409, "roteiro aprovado não reabre");
  if (script.status === "changes_requested") return fail(409, "pedido de mudança aberto sem versão nova");

  const version = currentVersion(db, scriptId);
  db.prepare("INSERT INTO approvals (script_id, version_id, approved_at) VALUES (?, ?, ?)").run(
    scriptId,
    version.id,
    at.toISOString(),
  );
  db.prepare("UPDATE scripts SET status = 'approved' WHERE id = ?").run(scriptId);
  return { status: 201, body: readScript(db, scriptId) };
}

export function readScript(db: DatabaseSync, scriptId: string) {
  const script = findScript(db, scriptId);
  if (!script) return null;
  const versions = db
    .prepare("SELECT * FROM versions WHERE script_id = ? ORDER BY number ASC")
    .all(scriptId) as VersionRow[];
  const requests = db
    .prepare("SELECT * FROM change_requests WHERE script_id = ? ORDER BY requested_at ASC, id ASC")
    .all(scriptId) as RequestRow[];
  const approval = db
    .prepare("SELECT version_id, approved_at FROM approvals WHERE script_id = ?")
    .get(scriptId) as ApprovalRow | undefined;

  return {
    id: script.id,
    status: script.status,
    timezone: script.timezone,
    versions: versions.map((version) => ({
      id: version.id,
      number: version.number,
      body: version.body,
      created_at: version.created_at,
      change_requests: requests
        .filter((request) => request.version_id === version.id)
        .map((request) => ({
          id: request.id,
          reason: request.reason,
          deadline_date: request.deadline_date,
          requested_at: request.requested_at,
          answered_by_version_id: request.answered_by_version_id,
        })),
    })),
    approval: approval ?? null,
  };
}
