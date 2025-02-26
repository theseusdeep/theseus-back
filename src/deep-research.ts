import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { b } from 'baml_client'; // Import BAML client
import { systemPrompt } from './prompt';
import { reportPrompt } from './report_prompt';
import { googleService } from './api/googleService';
import { logger } from './api/utils/logger';
import { encoder, trimPrompt } from './ai/providers';

function getMaxContextTokens(model?: string) {
  return model === 'deepseek-r1-671b' ? 131072 : 8000;
}

function getMaxConcurrency(modelId: string): number {
  const modelIdLower = modelId.toLowerCase();
  if (modelIdLower.match(/(70b|72b|claude-3|deepseek-r1)/)) {
    return 1;
  }
  if (modelIdLower.match(/(32b|34b)/)) {
    return 1;
  }
  return 4;
}

export interface ResearchResult {
  learnings: Array<{ insight: string; sourceTitle: string; sourceUrl: string }>;
  visitedUrls: string[];
  topUrls: Array<{ url: string; description: string }>;
  relevantUrls: string[];
}

interface SerpQuery {
  query: string;
  researchGoal: string;
}

async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
  selectedModel,
}: {
  query: string;
  numQueries?: number;
  learnings?: Array<{ insight: string; sourceTitle: string; sourceUrl: string }>;
  selectedModel?: string;
}) {
  try {
    const serpQueries = await b.GenerateSerpQueries({ query, numQueries, learnings: learnings || [] });
    logger.info(`Created ${serpQueries.length} queries`, { queries: serpQueries });
    return serpQueries.slice(0, numQueries);
  } catch (error) {
    logger.error('Error generating SERP queries', { error });
    return [
      { query: query, researchGoal: 'Explore basic concepts and current trends' },
      { query: `${query} latest developments`, researchGoal: 'Focus on recent innovations and updates' },
      { query: `${query} detailed analysis`, researchGoal: 'Deep dive into specific aspects and implications' },
    ].slice(0, numQueries);
  }
}

async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
  selectedModel,
  includeTopUrls = false,
}: {
  query: string;
  result: string[];
  numLearnings?: number;
  numFollowUpQuestions?: number;
  selectedModel?: string;
  includeTopUrls?: boolean;
}) {
  const scrapedResults = await googleService.scrape(result, query);
  const validResults = scrapedResults.filter(item => item.summary);
  const summaries = validResults.map(item => item.summary);
  const visitedUrls = validResults.map(item => item.url);
  const relevantUrls = scrapedResults.filter(item => item.isQueryRelated).map(item => item.url);
  logger.debug('processSerpResult valid URLs', { validUrls: visitedUrls });
  logger.info(`Ran "${query}", retrieved content for ${visitedUrls.length} URLs`, { visitedUrls });

  const flaggedResults = scrapedResults.filter(item => item.isQueryRelated);
  const computedTopUrls = flaggedResults.map(item => ({
    url: item.url,
    description: item.summary || '',
  }));

  try {
    const serpResult = await b.ProcessSerpResult({
      query,
      summaries,
      numLearnings,
      numFollowUpQuestions,
      includeTopUrls,
    });
    return {
      learnings: serpResult.learnings,
      followUpQuestions: serpResult.followUpQuestions,
      visitedUrls,
      topUrls: serpResult.topUrls || computedTopUrls,
      relevantUrls,
    };
  } catch (error) {
    logger.error('Error processing SERP result', { error });
    return {
      learnings: [
        { insight: `Found preliminary insights about ${query}`, sourceTitle: 'Unknown', sourceUrl: 'http://example.com' },
        { insight: 'Additional research may be needed for deeper analysis', sourceTitle: 'Unknown', sourceUrl: 'http://example.com' },
        { insight: 'Consider exploring related areas for further information', sourceTitle: 'Unknown', sourceUrl: 'http://example.com' },
      ].slice(0, numLearnings),
      followUpQuestions: [
        `What are the most critical aspects of ${query}?`,
        'What recent developments impact this topic?',
        'How does this compare with alternative perspectives?',
      ].slice(0, numFollowUpQuestions),
      topUrls: [],
      visitedUrls,
      relevantUrls: [],
    };
  }
}

export async function generateSummary(content: string, selectedModel?: string): Promise<string> {
  if (!content.trim()) {
    logger.warn('generateSummary called with empty content, returning empty summary');
    return '';
  }
  try {
    const summary = await b.GenerateSummary({ content });
    return summary;
  } catch (error) {
    logger.error('Error generating summary', { error });
    return 'No se pudo generar el resumen ejecutivo debido a un error.';
  }
}

export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
  selectedModel,
  language,
  topUrls = [],
  relevantUrls = [],
}: {
  prompt: string;
  learnings: Array<{ insight: string; sourceTitle: string; sourceUrl: string }>;
  visitedUrls: string[];
  selectedModel?: string;
  language?: string;
  topUrls?: Array<{ url: string; description: string }>;
  relevantUrls?: string[];
}) {
  try {
    const insightsText = learnings.map(l => l.insight).join('\n');
    const executiveSummary = await generateSummary(insightsText, selectedModel);
    const report = await b.WriteFinalReport({
      executiveSummary,
      prompt,
      learnings,
      language: language || 'Spanish',
    });
    return report.replace(/\\n/g, '\n');
  } catch (error) {
    logger.error('Error generating final report', { error });
    const formattedLearnings = learnings.map(l => `- ${l.insight} ([${l.sourceTitle}](${l.sourceUrl}))`).join('\n');
    return `# Informe de Investigación\n\nEntrada del Usuario: ${prompt}\n\nAprendizajes Clave:\n${formattedLearnings}`;
  }
}

interface SerpCandidates {
  finalTopUrls: Array<{ url: string; description: string }>;
}

async function finalizeTopRecommendations(
  candidates: Array<{ url: string; description: string }>,
  count: number,
  selectedModel?: string,
): Promise<Array<{ url: string; description: string }>> {
  // For simplicity, return top candidates as BAML integration here is optional
  return candidates.slice(0, count);
}

export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
  selectedModel,
  concurrency = 1,
  progressCallback,
  sites,
  abortSignal,
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: Array<{ insight: string; sourceTitle: string; sourceUrl: string }>;
  visitedUrls?: string[];
  selectedModel?: string;
  concurrency?: number;
  progressCallback?: (msg: string) => void;
  sites?: string[];
  abortSignal?: AbortSignal;
}): Promise<ResearchResult> {
  logger.info('deepResearch started', { query, breadth, depth, selectedModel, sites });
  progressCallback && progressCallback(`PROGRESO: Profundidad: ${depth}, Amplitud: ${breadth}`);

  if (abortSignal?.aborted) {
    throw new Error('Investigación abortada por el usuario');
  }

  const maxAllowedConcurrency = selectedModel ? getMaxConcurrency(selectedModel) : 1;
  const effectiveConcurrency = Math.min(concurrency, maxAllowedConcurrency);
  const requestLimit = pLimit(effectiveConcurrency);

  const serpQueries = await generateSerpQueries({
    query,
    learnings,
    numQueries: breadth,
    selectedModel,
  });

  const results = await Promise.all(
    serpQueries.map((serpQuery) =>
      requestLimit(async () => {
        if (abortSignal?.aborted) {
          throw new Error('Investigación abortada por el usuario');
        }
        try {
          progressCallback && progressCallback(`Buscando "${serpQuery.query}"...`);
          const urls = await googleService.googleSearch(serpQuery.query, 10, sites);
          progressCallback && progressCallback(`Encontrados ${urls.length} resultados para "${serpQuery.query}". Procesando...`);
          logger.info('Processing SERP result', { query: serpQuery.query, urlsCount: urls.length });
          const lowerSerpQuery = serpQuery.query.toLowerCase();
          const includeTopUrls =
            lowerSerpQuery.includes('best') &&
            (lowerSerpQuery.includes('price') || lowerSerpQuery.includes('quality'));
          const newLearnings = await processSerpResult({
            query: serpQuery.query,
            result: urls,
            numFollowUpQuestions: Math.ceil(breadth / 2),
            selectedModel,
            includeTopUrls,
          });
          progressCallback && progressCallback(`Procesado "${serpQuery.query}" y generados ${newLearnings.learnings.length} aprendizajes.`);
          const allLearnings = [...learnings, ...newLearnings.learnings];
          const allUrls: string[] = [...visitedUrls, ...newLearnings.visitedUrls].filter(
            (u): u is string => u !== undefined,
          );
          const currentTopUrls = newLearnings.topUrls || [];
          const allRelevantUrls = newLearnings.relevantUrls || [];
          const newDepth = depth - 1;
          if (newDepth > 0) {
            logger.info('Researching deeper', { nextBreadth: Math.ceil(breadth / 2), nextDepth: newDepth });
            progressCallback && progressCallback(`PROGRESO: Profundidad: ${newDepth}, Amplitud: ${Math.ceil(breadth / 2)}`);
            const nextQuery = `
            Previous research goal: ${serpQuery.researchGoal}
            Follow-up research directions: ${newLearnings.followUpQuestions.map((q) => `\n${q}`).join('')}
          `.trim();
            const deeperResult = await deepResearch({
              query: nextQuery,
              breadth: Math.ceil(breadth / 2),
              depth: newDepth,
              learnings: allLearnings,
              visitedUrls: allUrls,
              selectedModel,
              concurrency,
              progressCallback,
              sites,
              abortSignal,
            });
            return {
              learnings: deeperResult.learnings,
              visitedUrls: deeperResult.visitedUrls,
              topUrls: [...currentTopUrls, ...deeperResult.topUrls],
              relevantUrls: [...allRelevantUrls, ...deeperResult.relevantUrls],
            };
          } else {
            return {
              learnings: allLearnings,
              visitedUrls: allUrls,
              topUrls: currentTopUrls,
              relevantUrls: allRelevantUrls,
            };
          }
        } catch (e) {
          logger.error(`Error running query: ${serpQuery.query}`, { error: e });
          return {
            learnings: [],
            visitedUrls: [],
            topUrls: [],
            relevantUrls: [],
          };
        }
      })
    )
  );

  const allLearnings = results.flatMap((r) => r.learnings);
  const allVisitedUrls = [
    ...new Set(results.flatMap((r) => r.visitedUrls.filter((u): u is string => u !== undefined))),
  ];
  const allTopUrls = results.flatMap((r) => r.topUrls);
  const uniqueTopUrls = Array.from(new Map(allTopUrls.map((item) => [item.url, item])).values());
  const allRelevantUrls = [...new Set(results.flatMap((r) => r.relevantUrls))];

  let finalTopUrls = uniqueTopUrls;
  if (uniqueTopUrls.length > 0) {
    const match = query.match(/top\s+(\d+)/i);
    const recommendedCount = match && match[1] ? parseInt(match[1]) : 5;
    finalTopUrls = await finalizeTopRecommendations(uniqueTopUrls, recommendedCount, selectedModel);
  }

  const finalResult: ResearchResult = {
    learnings: allLearnings,
    visitedUrls: allVisitedUrls,
    topUrls: finalTopUrls,
    relevantUrls: allRelevantUrls,
  };
  logger.info('deepResearch completed', {
    learningsCount: finalResult.learnings.length,
    visitedUrlsCount: finalResult.visitedUrls.length,
    topUrlsCount: finalResult.topUrls.length,
    relevantUrlsCount: finalResult.relevantUrls.length,
  });
  return finalResult;
}

interface FeedbackResponse {
  questions: string[];
  language: string;
}

export async function generateFeedback({
  query,
  numQuestions = 3,
  selectedModel,
}: {
  query: string;
  numQuestions?: number;
  selectedModel?: string;
}): Promise<{ questions: string[]; language: string }> {
  const fallback: { questions: string[]; language: string } = {
    questions: [
      '¿Podrías proporcionar más detalles específicos sobre lo que deseas aprender?',
      '¿Cuál es tu objetivo principal con esta investigación?',
      '¿Hay algún aspecto específico en el que quieras enfocarte?',
    ].slice(0, numQuestions),
    language: 'Spanish',
  };

  try {
    logger.info('generateFeedback called', { query, numQuestions, selectedModel });
    const feedback = await b.GenerateFeedback({ query, numQuestions });
    logger.info('Feedback generado', { questions: feedback.questions, language: feedback.language });
    return { questions: feedback.questions.slice(0, numQuestions), language: feedback.language };
  } catch (error) {
    logger.error('Error generando feedback', { error });
    return fallback;
  }
}
