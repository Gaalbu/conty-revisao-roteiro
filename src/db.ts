import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scripts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('awaiting_review', 'changes_requested', 'approved')),
  timezone TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES scripts(id),
  number INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (script_id, number)
);

CREATE TABLE IF NOT EXISTS change_requests (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL REFERENCES scripts(id),
  version_id TEXT NOT NULL REFERENCES versions(id),
  reason TEXT NOT NULL,
  deadline_date TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  answered_by_version_id TEXT REFERENCES versions(id)
);

CREATE TABLE IF NOT EXISTS approvals (
  script_id TEXT PRIMARY KEY REFERENCES scripts(id),
  version_id TEXT NOT NULL REFERENCES versions(id),
  approved_at TEXT NOT NULL
);
`;

export function openDatabase(path = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
