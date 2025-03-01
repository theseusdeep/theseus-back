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
  learnings: Array<{ insight: string; sourceTitle: string; sourceUrl: string }>;
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
  learnings?: Array<{ insight: string; sourceTitle: string; sourceUrl: string }>;
  selectedModel?: string;
}) {
  try {
    const learningsText = learnings ? learnings.map(l => l.insight).join('\n') : '';
    const promptText = `Generate ${numQueries} professional, rigorously crafted, and innovative search queries to explore the following research topic. Each query should be descriptive and of optimal length (approximately 8-12 words) and must be paired with a brief, actionable research goal that leverages modern analytical frameworks and adheres to industry best practices.
    
Topic: "${query}"
${learningsText ? `Previous insights:\n${learningsText}` : ''}
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
    let promptText = `Conduct a rigorous and scholarly analysis of the following search results for "${query}". Generate ${numLearnings} key insights, each with the title and URL of the source that supports it, and ${numFollowUpQuestions} thought-provoking follow-up questions that are deeply grounded in current research trends and critical evaluation.${includeTopUrls ? ' Also, identify candidate top recommendations with clear, evidence-based justification.' : ''}

Search Results:
${trimmedContents}

Required JSON format:
{
  "learnings": [
    { "insight": "First key insight", "sourceTitle": "Title of the source", "sourceUrl": "http://example.com" },
    { "insight": "Second key insight", "sourceTitle": "Title of another source", "sourceUrl": "http://example2.com" }
  ],
  "followUpQuestions": [
    "First probing follow-up question",
    "Second probing follow-up question"
  ]${includeTopUrls ? `,
  "topUrls": [
    { "url": "http://example.com", "description": "Evidence-based justification" }
  ]` : ''}
};`;
    let tokenCount = encoder.encode(promptText).length;
    logger.debug('processSerpResult initial prompt token count', { tokenCount });
    const trimSizes = [8000, 4000, 2000, 1000, 500];
    for (const trimSize of trimSizes) {
      if (tokenCount <= getMaxContextTokens(selectedModel)) break;
      logger.warn(`Prompt too long (${tokenCount} tokens), trimming to ${trimSize} per content...`);
      const reTrimmed = validContents.map((content) => trimPrompt(content ?? '', trimSize)).join('\n\n');
      promptText = `Conduct a rigorous and scholarly analysis of the following search results for "${query}". Generate ${numLearnings} key insights, each with the title and URL of the source that supports it, and ${numFollowUpQuestions} thought-provoking follow-up questions that are deeply grounded in current research trends and critical evaluation.${includeTopUrls ? ' Also, identify candidate top recommendations with clear, evidence-based justification.' : ''}

Search Results:
${reTrimmed}

Required JSON format:
{
  "learnings": [
    { "insight": "First key insight", "sourceTitle": "Title of the source", "sourceUrl": "http://example.com" },
    { "insight": "Second key insight", "sourceTitle": "Title of another source", "sourceUrl": "http://example2.com" }
  ],
  "followUpQuestions": [
    "First probing follow-up question",
    "Second probing follow-up question"
  ]${includeTopUrls ? `,
  "topUrls": [
    { "url": "http://example.com", "description": "Evidence-based justification" }
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
        learnings: z.array(z.object({
          insight: z.string().describe('Key insight derived from the analysis'),
          sourceTitle: z.string().describe('Title of the source that supports this insight'),
          sourceUrl: z.string().describe('URL of the source that supports this insight'),
        })),
        followUpQuestions: z.array(z.string()).describe('Follow-up questions to explore the topic further'),
        topUrls: z.array(z.object({ url: z.string(), description: z.string() })).optional(),
      }),
    });
    const safeResult = res.object as {
      learnings: Array<{ insight: string; sourceTitle: string; sourceUrl: string }>;
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
      visitedUrls: visitedUrls,
      relevantUrls: [],
    };
  }
}

// NEW HELPER: Generate a report section using a dedicated API call.
// Now includes a "urls" parameter that passes the verified list of URLs.
async function generateReportSection(
  sectionTitle: string,
  sectionContext: string,
  urls: string[],
  selectedModel?: string,
  language?: string,
): Promise<string> {
  const urlsJoined = urls.join('\n');
  const promptText = `Please generate the "${sectionTitle}" section for a research report. The content of this section must be based exclusively on the following research findings and the verified URLs provided below. Use the context provided as input, and do not introduce any information unrelated to the research topic.

Research Context:
${sectionContext}

Verified URLs:
${urlsJoined}

Ensure that the output is a raw, valid JSON object with a key "section" whose value is the complete Markdown text for this section, including inline citations in the format [Source Title](URL) that refer only to the verified URLs above. Do not include any extra text or explanation.`;
  try {
    const res = await generateObjectSanitized({
      model: selectedModel ? createModel(selectedModel) : deepSeekModel,
      system: reportPrompt(language || 'English'),
      prompt: promptText,
      schema: z.object({
        section: z.string().describe('Markdown text for the section'),
      }),
      temperature: 0.6,
      maxTokens: 8192,
    });
    return res.object.section;
  } catch (error) {
    logger.error(`Error generating section "${sectionTitle}"`, { error });
    return `## ${sectionTitle}\n\n[No ${sectionTitle} generated due to an error.]`;
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
}): Promise<string> {
  try {
    // Format each learning so that if sourceUrl is missing or "undefined", use the first visited URL as fallback (if available)
    const formattedLearnings = learnings
      .map(l => {
        const title = l.sourceTitle || "Fuente desconocida";
        const url = (l.sourceUrl && l.sourceUrl !== "undefined") ? l.sourceUrl : (visitedUrls[0] || "URL not available");
        return `- ${l.insight} ([${title}](${url}))`;
      })
      .join('\n');
    const insightsText = learnings.map(l => l.insight).join('\n');

    // Generate an executive summary using the existing summary logic.
    const executiveSummary = await generateSummary(insightsText, selectedModel);

    // Generate each report section via separate API calls.
    const executiveSummarySection = await generateReportSection("Executive Summary", executiveSummary, visitedUrls, selectedModel, language);
    const introductionSection = await generateReportSection("Introduction", `User Input: "${prompt}"\n\nResearch Learnings with Sources:\n${formattedLearnings}`, visitedUrls, selectedModel, language);
    const methodologySection = await generateReportSection("Methodology", "Based on the research learnings and analysis process, describe the research methodology used including data collection, analytical methods, and critical evaluation of sources. Mention any limitations encountered.", visitedUrls, selectedModel, language);
    const keyInsightsSection = await generateReportSection("Key Insights", formattedLearnings, visitedUrls, selectedModel, language);
    const recommendationsSection = await generateReportSection("Recommendations", "Based on the research findings, provide actionable recommendations for future research and decision-making. Include any strategic considerations.", visitedUrls, selectedModel, language);
    const conclusionSection = await generateReportSection("Conclusion", "Summarize the overall research findings, implications, and final reflections.", visitedUrls, selectedModel, language);
    const referencesSection = await generateReportSection("References", "List all the sources cited in the report with their titles and URLs.", visitedUrls, selectedModel, language);

    const finalReportMarkdown = `${executiveSummarySection}\n\n${introductionSection}\n\n${methodologySection}\n\n${keyInsightsSection}\n\n${recommendationsSection}\n\n${conclusionSection}\n\n${referencesSection}`;
    return finalReportMarkdown;
  } catch (error) {
    logger.error('Error generating final report', { error });
    const formattedLearningsFallback = learnings
      .map(l => {
        const title = l.sourceTitle || "Fuente desconocida";
        const url = (l.sourceUrl && l.sourceUrl !== "undefined") ? l.sourceUrl : (visitedUrls[0] || "URL not available");
        return `- ${l.insight} ([${title}](${url}))`;
      })
      .join('\n');
    return `# Research Report\n\nUser Input: ${prompt}\n\nKey Learnings:\n${formattedLearningsFallback}`;
  }
}

async function generateSummary(content: string, selectedModel?: string): Promise<string> {
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
      prompt: `Given the following query from the user, generate ${numQuestions} follow-up questions to clarify the research direction. Also, detect and return the language of the query. Format your response as a JSON object with two keys: "questions" (an array of questions) and "language" (a string representing the detected language).

Query: "${query}"

Example response format:
{"questions": ["What specific aspects of this topic interest you most?", "Are you looking for current developments or historical context?", "What is your intended use case for this information?"], "language": "English"}`,
      schema: z.object({
        questions: z.array(z.string()).min(1).max(numQuestions).describe('Follow up questions to clarify the research direction'),
        language: z.string().describe('Detected language of the user query'),
      }),
      maxTokens: 8192,
      temperature: 0.7,
    });
    const typedFeedback = userFeedback.object as FeedbackResponse;
    logger.info('Feedback generated', { questions: typedFeedback.questions, language: typedFeedback.language });
    return { questions: typedFeedback.questions.slice(0, numQuestions), language: typedFeedback.language };
  } catch (error) {
    logger.error('Error generating feedback', { error });
    return fallback;
  }
}
