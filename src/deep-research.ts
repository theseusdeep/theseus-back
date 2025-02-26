import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';
import {
  trimPrompt,
  encoder,
  createModel,
  deepSeekModel,
  summarizationModel,
  DEFAULT_MODEL,
} from './ai/providers';
import { systemPrompt } from './prompt';
import { reportPrompt } from './report_prompt';
import { googleService } from './api/googleService';
import { logger } from './api/utils/logger';

function getMaxContextTokens(model?: string) {
  return model === DEFAULT_MODEL ? 131072 : 8000;
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
  learnings: string[];
  visitedUrls: string[];
  topUrls: Array<{ url: string; description: string }>;
  relevantUrls: string[];
}

export function sanitizeDeepSeekOutput(raw: string): string {
  // Remove all <think> blocks and their contents
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Find the substring between the first '{' and the last '}'
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  // If both braces are found and the positions are valid, extract the JSON substring
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1).trim();
  }

  // If no valid JSON object is found, return an empty string to trigger fallback
  return '';
}

export async function generateObjectSanitized<T>(params: any): Promise<{ object: T }> {
  let res;
  logger.debug('generateObjectSanitized called', {
    model: params.model.modelId,
    system: params.system,
    prompt: params.prompt,
  });

  params.venice_parameters = { include_venice_system_prompt: false };

  res = await params.model(params);

  if (params.model.modelId === DEFAULT_MODEL) {
    logger.info('Received response from Venice API', { response: res });
    const rawText = res.choices && res.choices[0]?.message?.content;
    if (!rawText) {
      throw new Error('No response text received from Venice API');
    }
    logger.debug('Raw text from Venice API', { rawText: rawText.substring(0, 300) });

    // Sanitize the response to remove <think> blocks and extract JSON
    const sanitized = sanitizeDeepSeekOutput(rawText);
    if (!sanitized) {
      logger.warn('No valid JSON found in response after sanitization', {
        rawTextSnippet: rawText.substring(0, 200),
      });
      // Provide context-specific fallback
      if (params.prompt.includes('queries')) {
        return { object: { queries: [] } as T };
      } else if (params.prompt.includes('summary')) {
        return { object: { summary: 'No se pudo generar el resumen debido a una respuesta incompleta.' } as T };
      } else if (params.prompt.includes('reportMarkdown')) {
        return { object: { reportMarkdown: 'No se pudo generar el informe debido a una respuesta incompleta.' } as T };
      } else {
        return { object: {} as T }; // Generic fallback
      }
    }
    logger.debug('Sanitized text', {
      snippet: sanitized.substring(0, 200),
      length: sanitized.length,
    });

    try {
      const parsed = JSON.parse(sanitized);
      if (params.schema) {
        params.schema.parse(parsed); // Validate with Zod schema if provided
      }
      logger.debug('Parsed sanitized output', { parsed });
      return { object: parsed };
    } catch (error: any) {
      logger.error('Error parsing sanitized output', {
        error: error.message,
        sanitizedSnippet: sanitized.substring(0, 200),
        sanitizedLength: sanitized.length,
      });
      // Provide context-specific fallback
      if (params.prompt.includes('queries')) {
        return { object: { queries: [] } as T };
      } else if (params.prompt.includes('summary')) {
        return { object: { summary: 'No se pudo generar el resumen debido a un error de análisis.' } as T };
      } else if (params.prompt.includes('reportMarkdown')) {
        return { object: { reportMarkdown: 'No se pudo generar el informe debido a un error de análisis.' } as T };
      } else {
        throw new Error('Failed to parse JSON from model response');
      }
    }
  } else {
    return { object: res } as { object: T };
  }
}

interface SerpQuery {
  query: string;
  researchGoal: string;
}

interface SerpResponse {
  queries: SerpQuery[];
}

async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
  selectedModel,
}: {
  query: string;
  numQueries?: number;
  learnings?: string[];
  selectedModel?: string;
}) {
  try {
    const promptText = `Generate ${numQueries} professional, rigorously crafted, and innovative search queries to explore the following research topic. Each query should be descriptive and of optimal length (approximately 8-12 words) and must be paired with a brief, actionable research goal that leverages modern analytical frameworks and adheres to industry best practices.
    
Topic: "${query}"
${learnings ? `Previous insights:\n${learnings.join('\n')}` : ''}
Ensure that the queries are directly aligned with the user's original intent and any provided feedback.

Required JSON format:
{
  "queries": [
    {
      "query": "example search query 1",
      "researchGoal": "a precise and innovative research direction for query 1"
    },
    {
      "query": "example search query 2",
      "researchGoal": "a precise and innovative research direction for query 2"
    }
  ]
};`;
    const tokenCount = encoder.encode(promptText).length;
    logger.debug('generateSerpQueries prompt token count', { tokenCount });

    if (tokenCount > getMaxContextTokens(selectedModel)) {
      logger.warn(`Prompt too long (${tokenCount} tokens), truncating learnings...`);
      if (learnings && learnings.length > 0) {
        const truncatedLearnings = learnings.slice(-3);
        return generateSerpQueries({
          query,
          numQueries,
          learnings: truncatedLearnings,
          selectedModel,
        });
      }
      throw new Error('Prompt too long even after truncation');
    }

    const res = await generateObjectSanitized({
      model: selectedModel ? createModel(selectedModel) : deepSeekModel,
      system: systemPrompt(),
      prompt: promptText,
      schema: z.object({
        queries: z
          .array(
            z.object({
              query: z.string().describe('The search query to use'),
              researchGoal: z.string().describe('Precise and innovative research goal for this query'),
            }),
          )
          .min(1)
          .max(numQueries),
      }),
      temperature: 0.6,
      maxTokens: 1000,
    });

    const serpResponse = res.object as SerpResponse;
    logger.info(`Created ${serpResponse.queries.length} queries`, { queries: serpResponse.queries });
    return serpResponse.queries.slice(0, numQueries);
  } catch (error) {
    logger.error('Error generating SERP queries', { error });
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
  const validContents = validResults.map(item => item.summary);
  const visitedUrls = validResults.map(item => item.url);
  const relevantUrls = scrapedResults.filter(item => item.IsQueryRelated === true).map(item => item.url);
  logger.debug('processSerpResult valid URLs', { validUrls: visitedUrls });
  logger.info(`Ran "${query}", retrieved content for ${visitedUrls.length} URLs`, { visitedUrls });

  const flaggedResults = scrapedResults.filter(item => item.IsQueryRelated === true);
  const computedTopUrls = flaggedResults.map(item => ({
    url: item.url,
    description: item.summary || '',
  }));

  try {
    let trimmedContents = validContents.join('\n\n');
    let promptText = `Conduct a rigorous and scholarly analysis of the following search results for "${query}". Generate ${numLearnings} key insights and ${numFollowUpQuestions} thought‑provoking follow‑up questions that are deeply grounded in current research trends and critical evaluation.${includeTopUrls ? ' Also, identify candidate top recommendations with clear, evidence‑based justification.' : ''}

Search Results:
${trimmedContents}

Required JSON format:
{
  "learnings": [
    "First key insight derived from the analysis",
    "Second key insight derived from the analysis",
    "Third key insight derived from the analysis"
  ],
  "followUpQuestions": [
    "First probing follow‑up question",
    "Second probing follow‑up question",
    "Third probing follow‑up question"
  ]${includeTopUrls ? `,
  "topUrls": [
    { "url": "http://example.com", "description": "Evidence‑based justification for this recommendation" }
  ]` : ''}
};`;
    let tokenCount = encoder.encode(promptText).length;
    logger.debug('processSerpResult initial prompt token count', { tokenCount });
    const trimSizes = [8000, 4000, 2000, 1000, 500];
    for (const trimSize of trimSizes) {
      if (tokenCount <= getMaxContextTokens(selectedModel)) break;
      logger.warn(`Prompt too long (${tokenCount} tokens), trimming to ${trimSize} per content...`);
      const reTrimmed = validContents.map((content) => trimPrompt(content ?? '', trimSize)).join('\n\n');
      promptText = `Conduct a rigorous and scholarly analysis of the following search results for "${query}". Generate ${numLearnings} key insights and ${numFollowUpQuestions} thought‑provoking follow‑up questions that are deeply grounded in current research trends and critical evaluation.${includeTopUrls ? ' Also, identify candidate top recommendations with clear, evidence‑based justification.' : ''}

Search Results:
${reTrimmed}

Required JSON format:
{
  "learnings": [
    "First key insight derived from the analysis",
    "Second key insight derived from the analysis",
    "Third key insight derived from the analysis"
  ],
  "followUpQuestions": [
    "First probing follow‑up question",
    "Second probing follow‑up question",
    "Third probing follow‑up question"
  ]${includeTopUrls ? `,
  "topUrls": [
    { "url": "http://example.com", "description": "Evidence‑based justification for this recommendation" }
  ]` : ''}
};`;
      tokenCount = encoder.encode(promptText).length;
      logger.debug(`processSerpResult prompt token count after trimming to ${trimSize}`, { tokenCount });
    }
    if (tokenCount > getMaxContextTokens(selectedModel)) {
      throw new Error(`Prompt too long (${tokenCount} tokens) even after aggressive trimming`);
    }
    const res = await generateObjectSanitized({
      model: selectedModel ? createModel(selectedModel) : deepSeekModel,
      system: systemPrompt(),
      prompt: promptText,
      schema: z.object({
        learnings: z.array(z.string()).describe('Key insights from the search results'),
        followUpQuestions: z.array(z.string()).describe('Follow‑up questions to explore the topic further'),
        topUrls: z.array(z.object({ url: z.string(), description: z.string() })).optional(),
      }),
    });
    const safeResult = res.object as {
      learnings: string[];
      followUpQuestions: string[];
      topUrls?: Array<{ url: string; description: string }>;
    };
    return {
      learnings: safeResult.learnings,
      followUpQuestions: safeResult.followUpQuestions,
      visitedUrls: visitedUrls,
      topUrls: safeResult.topUrls && safeResult.topUrls.length > 0 ? safeResult.topUrls : computedTopUrls,
      relevantUrls,
    };
  } catch (error) {
    logger.error('Error processing SERP result', { error });
    return {
      learnings: [
        `Found preliminary insights about ${query}`,
        'Additional research may be needed for deeper analysis',
        'Consider exploring related areas for further information',
      ].slice(0, numLearnings),
      followUpQuestions: [
        `What are the most critical aspects of ${query}?`,
        'What recent developments impact this topic?',
        'How does this compare with alternative perspectives?',
      ].slice(0, numFollowUpQuestions),
      topUrls: [],
      visitedUrls: visitedUrls,
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
    const promptText = `Based on the following research learnings, generate an executive summary in bullet points. Each bullet point should be a concise statement. Return your answer as a valid JSON object with a single key "summary", where the value is a string containing the bullet points separated by newlines. Do not include any extra text outside the JSON object. For example: {"summary": "- First key insight\\n- Second key insight\\n- Third key insight"}

Research Learnings:
${content}`;
    const res = await generateObjectSanitized({
      model: selectedModel ? createModel(selectedModel) : summarizationModel,
      system: systemPrompt(),
      prompt: promptText,
      schema: z.object({
        summary: z.string().describe('Executive summary in bullet points'),
      }),
      temperature: 0.5,
      maxTokens: 1000,
    });
    return res.object.summary;
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
  learnings: string[];
  visitedUrls: string[];
  selectedModel?: string;
  language?: string;
  topUrls?: Array<{ url: string; description: string }>;
  relevantUrls?: string[];
}) {
  try {
    const combinedLearnings = learnings.join('\n');
    const executiveSummary = await generateSummary(combinedLearnings, selectedModel);

    const promptText = `Executive Summary:
${executiveSummary}

User Input: "${prompt}"
Research Learnings:
${learnings.join('\n')}

Your task is to generate a detailed, comprehensive final report that integrates all the meaningful data retrieved during the research. Incorporate citations and quotes contextually within the report, ensuring that each claim or piece of data is accompanied by a relevant citation with a brief explanation of its source and its relevance. Do not simply list URLs at the end. Instead, embed the references naturally in the text. At the end of the report, include a "References" section that provides a contextual summary for each cited source.

Provided Relevant URLs:
${relevantUrls.join('\n')}
`;
    
    const res = await generateObjectSanitized({
      model: selectedModel ? createModel(selectedModel) : deepSeekModel,
      system: reportPrompt(new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), language || 'Spanish'),
      prompt: promptText,
      schema: z.object({
        reportMarkdown: z.string().describe('Informe final sobre el tema en formato Markdown con saltos de línea explícitos'),
      }),
      temperature: 0.6,
      maxTokens: 8192,
    });
    const safeResult = res.object as { reportMarkdown: string };
    return safeResult.reportMarkdown.replace(/\\n/g, '\n');
  } catch (error) {
    logger.error('Error generating final report', { error });
    return `# Informe de Investigación\n\nEntrada del Usuario: ${prompt}\n\nAprendizajes Clave:\n${learnings.join('\n')}\n\n## References:\n${relevantUrls.join('\n')}`;
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
  const promptText = `You are a research assistant tasked with selecting the final best recommendations from the following candidate recommendations. Consider quality, relevance, and reliability. Please select the final best ${count} recommendations.

Candidate Recommendations:
${JSON.stringify(candidates, null, 2)}

Return the result as a JSON object with a key "finalTopUrls" that is an array of objects, each having "url" and "description".`;
  const res = await generateObjectSanitized({
    model: selectedModel ? createModel(selectedModel) : deepSeekModel,
    system: systemPrompt(),
    prompt: promptText,
    schema: z.object({
      finalTopUrls: z.array(z.object({ url: z.string(), description: z.string() })),
    }),
    temperature: 0.6,
    maxTokens: 1000,
  });
  return res.object.finalTopUrls;
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
  learnings?: string[];
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

  const allLearnings = [...new Set(results.flatMap((r) => r.learnings))];
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

import { generateObject } from 'ai';
import { feedbackPrompt } from './feedback_prompt';

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
    const userFeedback = await generateObjectSanitized({
      model: selectedModel ? createModel(selectedModel) : deepSeekModel,
      system: feedbackPrompt(),
      prompt: `Dada la siguiente consulta del usuario, genera ${numQuestions} preguntas de seguimiento para aclarar la dirección de la investigación. También detecta y devuelve el idioma de la consulta. Formatea tu respuesta como un objeto JSON con dos claves: "questions" (un arreglo de preguntas) y "language" (una cadena que representa el idioma detectado).

Consulta: "${query}"

Formato de respuesta de ejemplo:
{"questions": ["¿Qué aspectos específicos de este tema te interesan más?", "¿Buscas desarrollos actuales o contexto histórico?", "¿Cuál es tu caso de uso previsto para esta información?"], "language": "Spanish"}`,
      schema: z.object({
        questions: z.array(z.string()).min(1).max(numQuestions).describe('Preguntas de seguimiento para aclarar la dirección de la investigación'),
        language: z.string().describe('Idioma detectado de la consulta del usuario'),
      }),
      maxTokens: 8192,
      temperature: 0.7,
    });

    const typedFeedback = userFeedback.object as FeedbackResponse;
    logger.info('Feedback generado', { questions: typedFeedback.questions, language: typedFeedback.language });
    return { questions: typedFeedback.questions.slice(0, numQuestions), language: typedFeedback.language };
  } catch (error) {
    logger.error('Error generando feedback', { error });
    return fallback;
  }
}
