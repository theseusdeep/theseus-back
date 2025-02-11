import Database from 'better-sqlite3';
import path from 'path';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const dbPath = path.join(process.cwd(), 'users.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    last_research TEXT,
    input_tokens_usage INTEGER DEFAULT 0,
    output_tokens_usage INTEGER DEFAULT 0,
    total_tokens_usage INTEGER DEFAULT 0
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS research (
    researchId TEXT PRIMARY KEY,
    requester TEXT NOT NULL,
    started_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL,
    progress TEXT,
    report TEXT
  );
`);

function addColumnIfNotExists(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((col: any) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfNotExists("research", "input_tokens", "INTEGER DEFAULT 0");
addColumnIfNotExists("research", "output_tokens", "INTEGER DEFAULT 0");
addColumnIfNotExists("research", "total_tokens", "INTEGER DEFAULT 0");
addColumnIfNotExists("research", "research_breadth", "INTEGER DEFAULT 0");
addColumnIfNotExists("research", "research_depth", "INTEGER DEFAULT 0");

export interface User {
  id: number;
  username: string;
  password: string;
  last_research: string | null;
  input_tokens_usage: number;
  output_tokens_usage: number;
  total_tokens_usage: number;
}

export function getUserByUsername(username: string): User | undefined {
  const stmt = db.prepare("SELECT * FROM users WHERE username = ?");
  const result = stmt.get(username) as User | undefined;
  return result;
}

export function createUser(username: string, password: string): User {
  const saltRounds = 10;
  const hashedPassword = bcrypt.hashSync(password, saltRounds);
  const stmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)');
  const info = stmt.run(username, hashedPassword);
  return {
    id: info.lastInsertRowid as number,
    username,
    password: hashedPassword,
    last_research: null,
    input_tokens_usage: 0,
    output_tokens_usage: 0,
    total_tokens_usage: 0
  };
}

export function updateUserTokens(username: string, inputTokens: number, outputTokens: number) {
  const user = getUserByUsername(username);
  if (!user) return;
  const newInput = user.input_tokens_usage + inputTokens;
  const newOutput = user.output_tokens_usage + outputTokens;
  const newTotal = newInput + newOutput;
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE users 
    SET input_tokens_usage = ?, output_tokens_usage = ?, total_tokens_usage = ?, last_research = ? 
    WHERE username = ?
  `);
  stmt.run(newInput, newOutput, newTotal, now, username);
}

export function updateLastResearch(username: string) {
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE users SET last_research = ? WHERE username = ?');
  stmt.run(now, username);
}

export function getAllUsers(): User[] {
  const stmt = db.prepare("SELECT * FROM users");
  return stmt.all() as User[];
}

export function updateUser(username: string, fields: {
  password?: string;
  last_research?: string;
  input_tokens_usage?: number;
  output_tokens_usage?: number;
  total_tokens_usage?: number;
}): User | undefined {
  const user = getUserByUsername(username);
  if (!user) return undefined;
  
  let newPassword = user.password;
  if (fields.password !== undefined) {
    const saltRounds = 10;
    newPassword = bcrypt.hashSync(fields.password, saltRounds);
  }
  
  const newLastResearch = fields.last_research !== undefined ? fields.last_research : user.last_research;
  const newInputTokens = fields.input_tokens_usage !== undefined ? fields.input_tokens_usage : user.input_tokens_usage;
  const newOutputTokens = fields.output_tokens_usage !== undefined ? fields.output_tokens_usage : user.output_tokens_usage;
  const newTotalTokens = fields.total_tokens_usage !== undefined ? fields.total_tokens_usage : user.total_tokens_usage;

  const stmt = db.prepare(`
    UPDATE users
    SET password = ?, last_research = ?, input_tokens_usage = ?, output_tokens_usage = ?, total_tokens_usage = ?
    WHERE username = ?
  `);
  stmt.run(newPassword, newLastResearch, newInputTokens, newOutputTokens, newTotalTokens, username);
  
  return getUserByUsername(username);
}

export function deleteUser(username: string): boolean {
  const stmt = db.prepare("DELETE FROM users WHERE username = ?");
  const result = stmt.run(username);
  return result.changes > 0;
}

export function createResearchRecord(requester: string, breadth: number, depth: number): string {
  const researchId = randomUUID();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO research (researchId, requester, started_at, updated_at, status, progress, research_breadth, research_depth)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(researchId, requester, now, now, 'in_progress', JSON.stringify([]), breadth, depth);
  return researchId;
}

export function updateResearchProgress(researchId: string, message: string): void {
  const now = new Date().toISOString();
  const selectStmt = db.prepare(`SELECT progress FROM research WHERE researchId = ?`);
  const row = selectStmt.get(researchId);
  let progressArray: string[] = [];
  if (row && row.progress) {
    try {
      progressArray = JSON.parse(row.progress);
    } catch (e) {
      progressArray = [];
    }
  }
  progressArray.push(message);
  const updateStmt = db.prepare(`
    UPDATE research 
    SET progress = ?, updated_at = ? 
    WHERE researchId = ?
  `);
  updateStmt.run(JSON.stringify(progressArray), now, researchId);
}

export function setResearchFinalReport(researchId: string, report: string): void {
  const now = new Date().toISOString();
  const status = report.startsWith('ERROR:') ? 'failed' : 'completed';
  const stmt = db.prepare(`
    UPDATE research 
    SET report = ?, status = ?, updated_at = ? 
    WHERE researchId = ?
  `);
  stmt.run(report, status, now, researchId);
}

export function updateResearchTokens(researchId: string, inputTokens: number, outputTokens: number): void {
  const totalTokens = inputTokens + outputTokens;
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE research 
    SET input_tokens = ?, output_tokens = ?, total_tokens = ?, updated_at = ? 
    WHERE researchId = ?
  `);
  stmt.run(inputTokens, outputTokens, totalTokens, now, researchId);
}

export function getResearchRecord(researchId: string): {
  researchId: string;
  requester: string;
  started_at: string;
  updated_at: string;
  status: string;
  progress: string[];
  report: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  research_breadth: number;
  research_depth: number;
} | undefined {
  const stmt = db.prepare(`SELECT * FROM research WHERE researchId = ?`);
  const row = stmt.get(researchId);
  if (!row) return undefined;
  let progressArray: string[] = [];
  if (row.progress) {
    try {
      progressArray = JSON.parse(row.progress);
    } catch (e) {
      progressArray = [];
    }
  }
  return {
    researchId: row.researchId,
    requester: row.requester,
    started_at: row.started_at,
    updated_at: row.updated_at,
    status: row.status,
    progress: progressArray,
    report: row.report || null,
    input_tokens: row.input_tokens || 0,
    output_tokens: row.output_tokens || 0,
    total_tokens: row.total_tokens || 0,
    research_breadth: row.research_breadth || 0,
    research_depth: row.research_depth || 0
  };
}
