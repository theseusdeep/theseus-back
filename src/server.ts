import dotenv from 'dotenv';
dotenv.config({ override: true });

import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { deepResearch, writeFinalReport } from './deep-research';
import { generateFeedback } from './feedback';
import { fetchModels } from './ai/providers';
import { logger } from './api/utils/logger';
import { getUserByUsername, updateUserTokens } from './db';
import bcrypt from 'bcrypt';

const app = express();
app.use(express.json());
app.use(cookieParser());

const internalApiMiddleware: express.RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  // Allow login endpoint without API key
  if (req.path === '/login') {
    return next();
  }
  // Allow if the user is already authenticated via cookie
  const authCookie = req.cookies?.auth;
  if (authCookie && getUserByUsername(authCookie)) {
    return next();
  }
  // Otherwise, check for API key header (accept either header name)
  const apiKeyHeader = req.headers['x-api-key'] || req.headers['x-internal-api-key'];
  const providedKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  if (providedKey !== process.env.INTERNAL_API_KEY) {
    logger.warn('Unauthorized API access: missing or invalid API key', { ip: req.ip });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

app.use('/api', internalApiMiddleware);

// Simple asyncHandler to wrap async route handlers
function asyncHandler(fn: any): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Authentication middleware: only allows requests with a valid auth cookie.
const authMiddleware: express.RequestHandler = (req, res, next) => {
  const username = req.cookies.auth;
  if (!username) {
    logger.warn('Unauthorized access attempt: no auth cookie', { ip: req.ip });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const user = getUserByUsername(username);
  if (!user) {
    logger.warn('Unauthorized access attempt: invalid user', { username, ip: req.ip });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  (req as any).user = user;
  next();
};

// Login endpoint
app.post('/api/login', asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = req.body;
  logger.debug('Login attempt', { providedUsername: username });
  const user = getUserByUsername(username);
  if (!user) {
    logger.warn('Invalid login credentials: user not found', { providedUsername: username });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const valid = await bcrypt.compare(password, user.password);
  if (valid) {
    res.cookie('auth', username, { httpOnly: true });
    logger.info('User logged in successfully', { username });
    res.json({ success: true });
  } else {
    logger.warn('Invalid login credentials: wrong password', { providedUsername: username });
    res.status(401).json({ error: 'Invalid credentials' });
  }
}));

// Protect research-related endpoints with auth middleware.
app.use('/api/research', authMiddleware);
app.use('/api/feedback', authMiddleware);
app.use('/api/models', authMiddleware);

// Updated models endpoint: always returns valid JSON.
app.get('/api/models', asyncHandler(async (_req: Request, res: Response) => {
  try {
    const models = await fetchModels();
    res.json(models);
  } catch (error) {
    logger.error('Error fetching models', { error });
    res.status(500).json([
      {
        id: 'deepseek-r1-671b',
        name: 'deepseek-r1-671b',
        available_on_current_plan: true,
        description: '',
        model_class: 'venice',
        context_length: 30000,
        max_completion_tokens: 4096,
      },
    ]);
  }
}));

// The research endpoint
app.post('/api/research', asyncHandler(async (req: Request, res: Response) => {
  const { query, breadth, depth, selectedModel, concurrency, sites } = req.body;
  // Get current user from auth middleware
  const user = (req as any).user;
  // Record starting token usage
  const startPrompt = logger.getTotalPromptTokens();
  const startCompletion = logger.getTotalCompletionTokens();

  res.setHeader('Content-Type', 'text/plain');
  res.flushHeaders();

  const sendUpdate = (message: string) => {
    res.write(message + '\n');
  };

  try {
    logger.info('Research request received', { query, breadth, depth, selectedModel, concurrency, sites });
    const { learnings, visitedUrls } = await deepResearch({
      query,
      breadth,
      depth,
      selectedModel,
      concurrency,
      progressCallback: (msg: string) => sendUpdate(msg),
      sites,
    });

    const report = await writeFinalReport({
      prompt: query,
      learnings,
      visitedUrls,
      selectedModel,
    });

    sendUpdate(`REPORT:${report}`);
    logger.info('Research completed successfully');

    // After research, calculate token usage difference
    const endPrompt = logger.getTotalPromptTokens();
    const endCompletion = logger.getTotalCompletionTokens();
    const diffPrompt = endPrompt - startPrompt;
    const diffCompletion = endCompletion - startCompletion;
    // Update user tokens usage in the database
    updateUserTokens(user.username, diffPrompt, diffCompletion);
  } catch (error) {
    logger.error('Research failed', { error });
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    sendUpdate('ERROR:Research failed - ' + errorMessage);
  } finally {
    res.end();
  }
}));

// The feedback endpoint
app.post('/api/feedback', asyncHandler(async (req: Request, res: Response) => {
  const { query, selectedModel } = req.body;
  try {
    logger.info('Feedback request received', { query, selectedModel });
    const questions = await generateFeedback({ query, selectedModel });
    res.json(questions);
  } catch (error) {
    logger.error('Error generating feedback', { error });
    res.status(500).json({ error: 'Failed to generate feedback questions' });
  }
}));

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
