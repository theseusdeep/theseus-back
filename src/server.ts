import dotenv from 'dotenv';
dotenv.config({ override: true });

import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { deepResearch, writeFinalReport } from './deep-research';
import { generateFeedback } from './feedback';
import { fetchModels } from './ai/providers';
import { logger, finalizeLogs } from './api/utils/logger';
import {
  getUserByUsername,
  updateUserTokens,
  createResearchRecord,
  updateResearchProgress,
  setResearchFinalReport,
  getResearchRecord,
  updateResearchTokens,
  getResearchHistory,
} from './db';
import bcrypt from 'bcrypt';
import { sendEmail } from './api/emailService';
import { generatePDF } from './generatePDF';

const ongoingResearch = new Map<string, AbortController>();

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}

const app = express();

app.use((req: Request, res: Response, next: NextFunction): void => {
  if (req.method === 'OPTIONS') {
    return next();
  }
  logger.info('Incoming request', { method: req.method, url: req.url });
  next();
});

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'https://theseus-deep.vercel.app',
    credentials: true,
  }),
);

app.use(express.json());
app.use(cookieParser());

const internalApiMiddleware: express.RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (req.path === '/login') {
    return next();
  }
  const authCookie = req.cookies?.auth;
  if (authCookie && (await getUserByUsername(authCookie))) {
    return next();
  }
  const providedKey = Array.isArray(req.headers['x-api-key'])
    ? req.headers['x-api-key'][0]
    : req.headers['x-api-key'];
  if (providedKey !== process.env.INTERNAL_API_KEY) {
    logger.warn('Unauthorized API access: missing or invalid API key', { ip: req.ip });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

app.use('/api', internalApiMiddleware);

function asyncHandler(fn: any): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const authMiddleware: express.RequestHandler = async (req, res, next) => {
  const username = req.cookies.auth;
  if (!username) {
    logger.warn('Unauthorized access attempt: no auth cookie', { ip: req.ip });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const user = await getUserByUsername(username);
  if (!user) {
    logger.warn('Unauthorized access attempt: invalid user', { username, ip: req.ip });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  (req as any).user = user;
  next();
};

app.post(
  '/api/login',
  asyncHandler(async (req: Request, res: Response) => {
    const { username, password } = req.body;
    logger.debug('Login attempt', { providedUsername: username });
    const user = await getUserByUsername(username);
    if (!user) {
      logger.warn('Invalid login credentials: user not found', {
        providedUsername: username,
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (valid) {
      res.cookie('auth', username, { httpOnly: true, secure: true, sameSite: 'none' });
      logger.info('User logged in successfully', { username });
      res.json({ success: true });
    } else {
      logger.warn('Invalid login credentials: wrong password', {
        providedUsername: username,
      });
      res.status(401).json({ error: 'Invalid credentials' });
    }
  }),
);

app.use('/api/research', authMiddleware);
app.use('/api/feedback', authMiddleware);
app.use('/api/models', authMiddleware);

app.get(
  '/api/models',
  asyncHandler(async (_req: Request, res: Response) => {
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
  }),
);

app.post(
  '/api/research',
  asyncHandler(async (req: Request, res: Response) => {
    const { query, breadth, depth, selectedModel, concurrency, sites, previousContext, language, continuous, email } = req.body;
    const user = (req as any).user;
    const requester = user.username;
    const researchId = await createResearchRecord(requester, breadth, depth, query);

    logger.info('Research request received', {
      researchId,
      query,
      breadth,
      depth,
      selectedModel,
      concurrency,
      sites,
      continuous,
      email,
    });
    res.json({ researchId });

    const abortController = new AbortController();
    ongoingResearch.set(researchId, abortController);

    (async () => {
      let currentLearnings: string[] = previousContext ? (Array.isArray(previousContext) ? previousContext : [previousContext]) : [];
      let iteration = 1;

      while (true) {
        if (abortController.signal.aborted) {
          updateResearchProgress(researchId, 'Research aborted by user.');
          setResearchFinalReport(researchId, 'Research aborted by user.');
          ongoingResearch.delete(researchId);
          return;
        }

        const startPrompt = logger.getTotalPromptTokens();
        const startCompletion = logger.getTotalCompletionTokens();

        const progressCallback = (msg: string) => {
          logger.info('Research progress update', { researchId, msg });
          updateResearchProgress(researchId, msg);
        };

        try {
          const researchPromise = deepResearch({
            query,
            breadth,
            depth,
            learnings: currentLearnings,
            selectedModel,
            concurrency,
            progressCallback,
            sites,
            abortSignal: abortController.signal,
          });
          const researchTimeoutMs = 15 * 60 * 1000; // 15 minutes
          const fallbackResult = {
            learnings: ['Fallback: Research timed out. Partial results may be incomplete.'],
            visitedUrls: [],
            topUrls: [],
          };
          const { learnings, visitedUrls, topUrls } = await withTimeout(
            researchPromise,
            researchTimeoutMs,
            fallbackResult,
          );

          currentLearnings = learnings;

          const reportPromise = writeFinalReport({
            prompt: query,
            learnings,
            visitedUrls,
            selectedModel,
            language,
            topUrls,
          });
          const reportTimeoutMs = 5 * 60 * 1000; // 5 minutes
          const fallbackReport = `# Research Report\n\nFallback report generated due to timeout. Learnings: ${learnings.join(', ')}`;
          const report = await withTimeout(reportPromise, reportTimeoutMs, fallbackReport);

          if (continuous) {
            const subject = `Research Iteration ${iteration} for "${query}"`;
            // For continuous mode, the report is emailed directly
            await sendEmail(email, subject, report);
            updateResearchProgress(researchId, `Iteration ${iteration} completed and emailed.`);
            iteration++;
          } else {
            updateResearchProgress(researchId, `REPORT:${report}`);
            setResearchFinalReport(researchId, report);
            logger.info('Research completed successfully', { researchId });
            const endPrompt = logger.getTotalPromptTokens();
            const endCompletion = logger.getTotalCompletionTokens();
            const diffPrompt = endPrompt - startPrompt;
            const diffCompletion = endCompletion - startCompletion;
            updateUserTokens(user.username, diffPrompt, diffCompletion);
            updateResearchTokens(researchId, diffPrompt, diffCompletion);
            ongoingResearch.delete(researchId);
            break;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          updateResearchProgress(researchId, `ERROR:Research failed - ${errorMessage}`);
          setResearchFinalReport(researchId, `ERROR:Research failed - ${errorMessage}`);
          logger.error('Research failed', { researchId, error });
          ongoingResearch.delete(researchId);
          break;
        }
      }
    })();
  }),
);

app.get(
  '/api/research',
  asyncHandler(async (req: Request, res: Response) => {
    const researchId = req.query.id;
    if (!researchId || typeof researchId !== 'string') {
      res.status(400).json({ error: 'Missing or invalid researchId' });
      return;
    }
    const researchRecord = await getResearchRecord(researchId);
    if (!researchRecord) {
      res.status(404).json({ error: 'Research record not found' });
      return;
    }
    res.json(researchRecord);
  }),
);

app.get(
  '/api/research/history',
  asyncHandler(async (req: Request, res: Response) => {
    const user = (req as any).user;
    const history = await getResearchHistory(user.username);
    res.json(history);
  }),
);

app.post(
  '/api/research/abort',
  asyncHandler(async (req: Request, res: Response) => {
    const { researchId } = req.body;
    if (!researchId || typeof researchId !== 'string') {
      res.status(400).json({ error: 'Missing or invalid researchId' });
      return;
    }
    const controller = ongoingResearch.get(researchId);
    if (controller) {
      controller.abort();
      ongoingResearch.delete(researchId);
      updateResearchProgress(researchId, 'Research aborted by user.');
      setResearchFinalReport(researchId, 'Research aborted by user.');
      logger.info('Research aborted', { researchId });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Research task not found or already completed' });
    }
  }),
);

app.post(
  '/api/feedback',
  asyncHandler(async (req: Request, res: Response) => {
    const { query, selectedModel } = req.body;
    try {
      logger.info('Feedback request received', { query, selectedModel });
      const feedback = await generateFeedback({ query, selectedModel });
      res.json(feedback);
    } catch (error) {
      logger.error('Error generating feedback', { error });
      res.status(500).json({ error: 'Failed to generate feedback questions' });
    }
  }),
);

app.get(
  '/api/research/pdf',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const researchId = req.query.id;
    if (!researchId || typeof researchId !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid researchId' });
    }
    const researchRecord = await getResearchRecord(researchId);
    if (!researchRecord) {
      return res.status(404).json({ error: 'Research record not found' });
    }
    if (!researchRecord.report) {
      return res.status(400).json({ error: 'No final report found for this research. Please complete it first.' });
    }

    try {
      const reportTitle = researchRecord.query || 'Research Report';
      const pdfBuffer = await generatePDF(reportTitle, researchRecord.report, researchId);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const sanitizedTitle = reportTitle.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 30);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizedTitle}-${timestamp}.pdf"`);
      res.send(pdfBuffer);
      logger.info('PDF generated successfully', { researchId });
    } catch (error) {
      logger.error('Error generating PDF', { error, researchId });
      return res.status(500).json({ 
        error: 'Failed to generate PDF', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }),
);

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

process.on('exit', () => {
  finalizeLogs();
});
