import fs from 'fs';
import path from 'path';

const logFilePath = path.join(process.cwd(), 'logs.txt');

// At the beginning of every execution, overwrite any existing log file.
try {
  fs.writeFileSync(logFilePath, '');
} catch (err) {
  console.error('Failed to initialize log file:', err);
}

function getTimestamp(): string {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

function appendLog(level: string, message: string, meta?: Record<string, any>) {
  const logMessage = `${getTimestamp()} [${level}] ${message} ${meta ? JSON.stringify(meta) : ''}\n`;
  try {
    fs.appendFileSync(logFilePath, logMessage);
  } catch (err) {
    console.error('Failed to write log to file:', err);
  }
}

const startTime = new Date();
let totalPromptTokens = 0;
let totalCompletionTokens = 0;

export function addTokenUsage(usage: { prompt_tokens?: number, completion_tokens?: number, total_tokens?: number }) {
  if (usage.prompt_tokens) {
    totalPromptTokens += usage.prompt_tokens;
  }
  if (usage.completion_tokens) {
    totalCompletionTokens += usage.completion_tokens;
  }
}

export function getTotalPromptTokens(): number {
  return totalPromptTokens;
}

export function getTotalCompletionTokens(): number {
  return totalCompletionTokens;
}

export function finalizeLogs() {
  const endTime = new Date();
  const diffMs = endTime.getTime() - startTime.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const executionTimeStr = `Execution time: ${diffDays} days, ${diffHours} hours, ${diffMinutes} minutes`;
  const totalTokens = totalPromptTokens + totalCompletionTokens;
  const tokenUsageStr = `Token usage: prompt tokens: ${totalPromptTokens}, completion tokens: ${totalCompletionTokens}, total tokens: ${totalTokens}`;
  
  appendLog('INFO', executionTimeStr);
  appendLog('INFO', tokenUsageStr);
}

export const logger: {
  info: (message: string, meta?: Record<string, any>) => void;
  debug: (message: string, meta?: Record<string, any>) => void;
  warn: (message: string, meta?: Record<string, any>) => void;
  error: (message: string, meta?: Record<string, any>) => void;
  getTotalPromptTokens: () => number;
  getTotalCompletionTokens: () => number;
} = {
  info: (message: string, meta?: Record<string, any>) => {
    console.info(`[INFO] ${message}`, meta);
    appendLog('INFO', message, meta);
  },
  debug: (message: string, meta?: Record<string, any>) => {
    console.debug(`[DEBUG] ${message}`, meta);
    appendLog('DEBUG', message, meta);
  },
  warn: (message: string, meta?: Record<string, any>) => {
    console.warn(`[WARN] ${message}`, meta);
    appendLog('WARN', message, meta);
  },
  error: (message: string, meta?: Record<string, any>) => {
    console.error(`[ERROR] ${message}`, meta);
    appendLog('ERROR', message, meta);
  },
  getTotalPromptTokens,
  getTotalCompletionTokens
};
