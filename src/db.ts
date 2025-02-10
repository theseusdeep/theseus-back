import Database from 'better-sqlite3';
import path from 'path';
import bcrypt from 'bcrypt';

const dbPath = path.join(process.cwd(), 'users.db');
const db = new Database(dbPath);

// Create table if not exists
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

// New function to update a user's details
export function updateUser(username: string, fields: {
  password?: string;
  last_research?: string;
  input_tokens_usage?: number;
  output_tokens_usage?: number;
  total_tokens_usage?: number;
}): User | undefined {
  const user = getUserByUsername(username);
  if (!user) return undefined;
  
  // Prepare new values, if not provided, use existing ones
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

// New function to delete a user
export function deleteUser(username: string): boolean {
  const stmt = db.prepare("DELETE FROM users WHERE username = ?");
  const result = stmt.run(username);
  return result.changes > 0;
}
