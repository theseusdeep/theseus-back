import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { baml } from './baml_client';
import { trimPrompt, encoder } from './ai/providers';
import { googleService } from './api/googleService';
import { logger } from './api/utils/logger';

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

// Model-to-client mapping for dynamic selection
const modelToClientMap: Record<string, string> = {
  'deepseek-r1-671b': 'DeepSeekClient',
  'gpt-4o': 'GPT4Client',
  // Add other models as needed
};

function getClientName(selectedModel?: string): string {
  return selectedModel ? modelToClientMap[selectedModel] || 'DeepSeekClient' : 'DeepSeekClient';
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

export async function generateSerpQueries({
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
  const learningsText = learnings ? learnings.map(l => l.insight) : [];
  const clientName = getClientName(selectedModel);
  try {
    // Trim prompt if necessary (simplified check based on original logic)
    const promptText = `Generate ${numQueries} search queries for "${query}"${learningsText.length ? `\nPrevious insights:\n${learningsText.join('\n')}` : ''}`;
    const tokenCount = encoder.encode(promptText).length;
    if (tokenCount > getMaxContextTokens(selectedModel)) {
      logger.warn(`Prompt too long (${tokenCount} tokens), truncating learnings...`);
      const truncatedLearnings = learnings ? learnings.slice(-3) : [];
      return generateSerpQueries({ query, numQueries, learnings: truncatedLearnings, selectedModel });
    }

    const res = await baml.GenerateSerpQueries.withClient(clientName)(query, numQueries, learningsText);
    logger.info(`Created ${res.length} queries`, { queries: res });
    return res.slice(0, numQueries);
  } catch (error) {
    logger.error('Error generating SERP queries with BAML', { error });
    return [
      {
        query: query,
        researchGoal: 'Explore basic concepts and current trends',
      },
      {
        query: `${query} latest developments`,
        researchGoal: 'Focus on recent innovations and updates',
      },
      {
        query: `${query} detailed analysis`,
        researchGoal: 'Deep dive into specific aspects and implications',
      },
    ].slice(0, numQueries);
  }
}

export async function processSerpResult({
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
  const validContents = validResults.map(item => item.summary).join('\n\n');
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
    // Trim searchResults if necessary
    let searchResults = validContents;
    let tokenCount = encoder.encode(searchResults).length;
    const maxPromptTokens = getMaxContextTokens(selectedModel) - 1000; // Reserve tokens
    const trimSizes = [8000, 4000, 2000, 1000, 500];
    for (const trimSize of trimSizes) {
      if (tokenCount <= maxPromptTokens) break;
      logger.warn(`Prompt too long (${tokenCount} tokens), trimming to ${trimSize} per content...`);
      searchResults = validResults
        .map(item => trimPrompt(item.summary ?? '', trimSize))
        .join('\n\n');
      tokenCount = encoder.encode(searchResults).length;
    }
    if (tokenCount > maxPromptTokens) {
      throw new Error(`Prompt too long (${tokenCount} tokens) even after trimming`);
    }

    const clientName = getClientName(selectedModel);
    const res = await baml.ProcessSerpResult.withClient(clientName)(
      query,
      searchResults,
      numLearnings,
      numFollowUpQuestions,
      includeTopUrls,
    );
    return {
      learnings: res.learnings,
      followUpQuestions: res.followUpQuestions,
      visitedUrls,
      topUrls: res.topUrls && res.topUrls.length > 0 ? res.topUrls : computedTopUrls,
      relevantUrls,
    };
  } catch (error) {
    logger.error('Error processing SERP result with BAML', { error });
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
      visitedUrls,
      topUrls: [],
      relevantUrls: [],
    };
  }
}

export async function generateSummary(content: string, selectedModel?: string): Promise<string> {
  if (!content.trim()) {
    logger.warn('generateSummary called with empty content, returning empty summary');
    return '';
  }
  const clientName = getClientName(selectedModel);
  try {
    const summary = await baml.GenerateSummary.withClient(clientName)(content);
    return summary;
  } catch (error) {
    logger.error('Error generating summary with BAML', { error });
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
  const formattedLearnings = learnings.map(l => `- ${l.insight} ([${l.sourceTitle}](${l.sourceUrl}))`).join('\n');
  const insightsText = learnings.map(l => l.insight).join('\n');
  const executiveSummary = await generateSummary(insightsText, selectedModel);

  const clientName = getClientName(selectedModel);
  try {
    const report = await baml.WriteFinalReport.withClient(clientName)(prompt, executiveSummary, formattedLearnings);
    return report.replace(/\\n/g, '\n'); // Normalize newlines
  } catch (error) {
    logger.error('Error generating final report with BAML', { error });
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
  // Kept as a separate function using existing logic, could be converted to BAML if needed
  const promptText = `You are a research assistant tasked with selecting the final best recommendations from the following candidate recommendations. Consider quality, relevance, and reliability. Please select the final best ${count} recommendations.

Candidate Recommendations:
${JSON.stringify(candidates, null, 2)}

Return the result as a JSON object with a key "finalTopUrls" that is an array of objects, each having "url" and "description".`;
  const res = await baml.WriteFinalReport.withClient(getClientName(selectedModel))(
    promptText,
    '', // No executive summary needed
    '', // No formatted learnings
  );
  const parsed = JSON.parse(res); // Assuming BAML returns JSON string here
  return parsed.finalTopUrls || candidates.slice(0, count); // Fallback to top candidates
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

export async function generateFeedback({
  query,
  numQuestions = 3,
  selectedModel,
}: {
  query: string;
  numQuestions?: number;
  selectedModel?: string;
}): Promise<{ questions: string[]; language: string }> {
  const clientName = getClientName(selectedModel);
  try {
    logger.info('generateFeedback called', { query, numQuestions, selectedModel });
    const res = await baml.GenerateFeedback.withClient(clientName)(query, numQuestions);
    logger.info('Feedback generated', { questions: res.questions, language: res.language });
    return { questions: res.questions.slice(0, numQuestions), language: res.language };
  } catch (error) {
    logger.error('Error generating feedback with BAML', { error });
    return {
      questions: [
        'Could you provide more specific details about what you want to learn?',
        'What is your main goal with this research?',
        'Are there any specific aspects you want to focus on?',
      ].slice(0, numQuestions),
      language: 'English',
    };
  }
}
