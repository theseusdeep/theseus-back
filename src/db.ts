import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}
const sql = neon(connectionString);

// Initialization: Create tables if they don't exist and add any missing columns.
async function initDb() {
  // Create users table
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      last_research TEXT,
      input_tokens_usage INTEGER DEFAULT 0,
      output_tokens_usage INTEGER DEFAULT 0,
      total_tokens_usage INTEGER DEFAULT 0
    )
  `;

  // Create research table with new column for initial query.
  await sql`
    CREATE TABLE IF NOT EXISTS research (
      researchId TEXT PRIMARY KEY,
      requester TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      status TEXT NOT NULL,
      progress TEXT,
      report TEXT,
      input_query TEXT NOT NULL
    )
  `;

  // Add additional columns if they do not exist
  await sql`ALTER TABLE research ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0`;
  await sql`ALTER TABLE research ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0`;
  await sql`ALTER TABLE research ADD COLUMN IF NOT EXISTS total_tokens INTEGER DEFAULT 0`;
  await sql`ALTER TABLE research ADD COLUMN IF NOT EXISTS research_breadth INTEGER DEFAULT 0`;
  await sql`ALTER TABLE research ADD COLUMN IF NOT EXISTS research_depth INTEGER DEFAULT 0`;
  // Ensure input_query column exists in case the table was created earlier
  await sql`ALTER TABLE research ADD COLUMN IF NOT EXISTS input_query TEXT DEFAULT ''`;
}

initDb().catch(err => {
  console.error('Failed to initialize database', err);
});

// Type definitions
export interface User {
  id: number;
  username: string;
  password: string;
  last_research: string | null;
  input_tokens_usage: number;
  output_tokens_usage: number;
  total_tokens_usage: number;
}

export interface ResearchRecord {
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
  input_query: string;
}

// User functions
export async function getUserByUsername(username: string): Promise<User | undefined> {
  const rows = await sql`SELECT * FROM users WHERE username = ${username}`;
  if (rows.length === 0) return undefined;
  return rows[0] as User;
}

export async function createUser(username: string, password: string): Promise<User> {
  const saltRounds = 10;
  const hashedPassword = bcrypt.hashSync(password, saltRounds);
  const result = await sql`INSERT INTO users (username, password) VALUES (${username}, ${hashedPassword}) RETURNING id`;
  const id = result[0].id;
  return {
    id,
    username,
    password: hashedPassword,
    last_research: null,
    input_tokens_usage: 0,
    output_tokens_usage: 0,
    total_tokens_usage: 0,
  };
}

export async function updateUserTokens(username: string, inputTokens: number, outputTokens: number): Promise<void> {
  const user = await getUserByUsername(username);
  if (!user) return;
  const newInput = user.input_tokens_usage + inputTokens;
  const newOutput = user.output_tokens_usage + outputTokens;
  const newTotal = newInput + newOutput;
  const now = new Date().toISOString();
  await sql`
    UPDATE users 
    SET input_tokens_usage = ${newInput}, output_tokens_usage = ${newOutput}, total_tokens_usage = ${newTotal}, last_research = ${now} 
    WHERE username = ${username}
  `;
}

export async function updateLastResearch(username: string): Promise<void> {
  const now = new Date().toISOString();
  await sql`UPDATE users SET last_research = ${now} WHERE username = ${username}`;
}

export async function getAllUsers(): Promise<User[]> {
  const rows = await sql`SELECT * FROM users`;
  return rows as User[];
}

export async function updateUser(
  username: string,
  fields: {
    password?: string;
    last_research?: string;
    input_tokens_usage?: number;
    output_tokens_usage?: number;
    total_tokens_usage?: number;
  }
): Promise<User | undefined> {
  const user = await getUserByUsername(username);
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
  
  await sql`
    UPDATE users
    SET password = ${newPassword}, last_research = ${newLastResearch}, input_tokens_usage = ${newInputTokens}, output_tokens_usage = ${newOutputTokens}, total_tokens_usage = ${newTotalTokens}
    WHERE username = ${username}
  `;
  
  return getUserByUsername(username);
}

export async function deleteUser(username: string): Promise<boolean> {
  await sql`DELETE FROM users WHERE username = ${username}`;
  const user = await getUserByUsername(username);
  return !user;
}

// Research functions
export async function createResearchRecord(requester: string, breadth: number, depth: number, inputQuery: string): Promise<string> {
  const researchId = randomUUID();
  const now = new Date().toISOString();
  await sql`
    INSERT INTO research (researchId, requester, started_at, updated_at, status, progress, research_breadth, research_depth, input_query)
    VALUES (${researchId}, ${requester}, ${now}, ${now}, 'in_progress', ${JSON.stringify([])}, ${breadth}, ${depth}, ${inputQuery})
  `;
  return researchId;
}

export async function updateResearchProgress(researchId: string, message: string): Promise<void> {
  const now = new Date().toISOString();
  const rows = await sql`SELECT progress FROM research WHERE researchId = ${researchId}`;
  let progressArray: string[] = [];
  if (rows.length > 0 && rows[0].progress) {
    try {
      progressArray = JSON.parse(rows[0].progress);
    } catch (e) {
      progressArray = [];
    }
  }
  progressArray.push(message);
  await sql`
    UPDATE research 
    SET progress = ${JSON.stringify(progressArray)}, updated_at = ${now}
    WHERE researchId = ${researchId}
  `;
}

export async function setResearchFinalReport(researchId: string, report: string): Promise<void> {
  const now = new Date().toISOString();
  const status = report.startsWith('ERROR:') ? 'failed' : 'completed';
  await sql`
    UPDATE research 
    SET report = ${report}, status = ${status}, updated_at = ${now}
    WHERE researchId = ${researchId}
  `;
}

export async function updateResearchTokens(researchId: string, inputTokens: number, outputTokens: number): Promise<void> {
  const totalTokens = inputTokens + outputTokens;
  const now = new Date().toISOString();
  await sql`
    UPDATE research 
    SET input_tokens = ${inputTokens}, output_tokens = ${outputTokens}, total_tokens = ${totalTokens}, updated_at = ${now}
    WHERE researchId = ${researchId}
  `;
}

export async function getResearchRecord(researchId: string): Promise<ResearchRecord | undefined> {
  const rows = await sql`SELECT * FROM research WHERE researchId = ${researchId}`;
  if (rows.length === 0) return undefined;
  const row = rows[0];
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
    research_depth: row.research_depth || 0,
    input_query: row.input_query || '',
  };
}

export async function getAllResearches(): Promise<ResearchRecord[]> {
  const rows = await sql`SELECT * FROM research`;
  return rows.map((row: any) => {
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
      research_depth: row.research_depth || 0,
      input_query: row.input_query || '',
    };
  });
}

// New function: get research history for a specific user
export async function getResearchHistory(username: string): Promise<ResearchRecord[]> {
  const rows = await sql`SELECT * FROM research WHERE requester = ${username} ORDER BY started_at DESC`;
  return rows.map((row: any) => {
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
      research_depth: row.research_depth || 0,
      input_query: row.input_query || '',
    };
  });
}
