import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';
import { trimPrompt, encoder, createModel, deepSeekModel, DEFAULT_MODEL } from './ai/providers';
import { systemPrompt } from './prompt';
import { reportPrompt } from './report_prompt';
import { googleService } from './api/googleService';
import { logger } from './api/utils/logger';

function getMaxContextTokens(model?: string) {
  return model === DEFAULT_MODEL ? 131072 : 8000;
}

function getMaxConcurrency(modelId: string): number {
  const modelIdLower = modelId.toLowerCase();

  // Large models (70B+)
  if (modelIdLower.match(/(70b|72b|claude-3|deepseek-r1)/)) {
    return 1;
  }

  // Medium models (32-34B)
  if (modelIdLower.match(/(32b|34b)/)) {
    return 1;
  }

  // Small models (≤15B)
  return 4;
}

export interface ResearchResult {
  learnings: string[];
  visitedUrls: string[];
  topUrls: Array<{ url: string; description: string }>;
}

/**
 * Updated sanitation helper.
 * First, remove any <think>...</think> blocks.
 * Then, if a "{" exists in the remainder, return the substring from the first "{" to the last "}" (if present).
 */
export function sanitizeDeepSeekOutput(raw: string): string {
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const firstBrace = withoutThink.indexOf('{');
  if (firstBrace === -1) {
    return withoutThink;
  }
  // Find the last closing brace
  const lastBrace = withoutThink.lastIndexOf('}');
  if (lastBrace === -1 || lastBrace < firstBrace) {
    // If no closing brace is found, return from the first brace onward
    return withoutThink.slice(firstBrace).trim();
  }
  return withoutThink.slice(firstBrace, lastBrace + 1).trim();
}

/**
 * A wrapper for model calls that ensures the Venice parameter is always included.
 * It also logs the system and user prompts.
 *
 * For the default model, we expect the API response to follow the chat completion format.
 * We extract the assistant message content, sanitize it, and parse it as JSON.
 */
export async function generateObjectSanitized<T>(params: any): Promise<{ object: T }> {
  let res;
  logger.debug('generateObjectSanitized called', {
    model: params.model.modelId,
    system: params.system,
    prompt: params.prompt,
  });

  // Always force include_venice_system_prompt to false.
  params.venice_parameters = { include_venice_system_prompt: false };

  // Call the model (our custom function returned from providers)
  res = await params.model(params);

  if (params.model.modelId === DEFAULT_MODEL) {
    logger.info('Received response from Venice API', { response: res });
    // Expecting the response in Venice format:
    // { choices: [ { message: { content: "..." }, ... } ], ... }
    const rawText = res.choices && res.choices[0]?.message?.content;
    if (!rawText) {
      throw new Error('No response text received from Venice API');
    }
    logger.debug('Raw text from Venice API', { rawText: rawText.substring(0, 300) });
    const sanitized = sanitizeDeepSeekOutput(rawText);
    // Log a snippet and length of the sanitized text for debugging
    logger.debug('Sanitized text', {
      snippet: sanitized.substring(0, 200),
      length: sanitized.length,
    });
    try {
      const parsed = JSON.parse(sanitized);
      logger.debug('Parsed sanitized output', { parsed });
      return { object: parsed };
    } catch (error: any) {
      logger.error('Error parsing sanitized output', {
        error: error.message,
        sanitizedSnippet: sanitized.substring(0, 200),
        sanitizedLength: sanitized.length,
      });
      throw error;
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

/**
 * Updated function to generate SERP queries.
 * It now instructs the assistant to produce balanced search queries that are neither too short nor too lengthy.
 */
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
    const promptText = `Generate ${numQueries} balanced and professional search queries to research the following topic. Each query should be concise yet descriptive (ideally between 5 to 10 words) and include a brief research goal for further investigation.

Topic: "${query}"
${learnings ? `Previous learnings:\n${learnings.join('\n')}` : ''}

Required JSON format:
{
  "queries": [
    {
      "query": "example search query 1",
      "researchGoal": "goal and additional research directions for query 1"
    },
    {
      "query": "example search query 2",
      "researchGoal": "goal and additional research directions for query 2"
    }
  ]
}`;
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
              researchGoal: z.string().describe('Research goal and additional directions for this query'),
            }),
          )
          .min(1)
          .max(numQueries),
      }),
      temperature: 0.7,
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
        researchGoal: 'Understand the basic concepts and current developments',
      },
      {
        query: `${query} latest developments`,
        researchGoal: 'Focus on recent updates and changes in the field',
      },
      {
        query: `${query} detailed analysis`,
        researchGoal: 'Deep dive into specific aspects and implications',
      },
    ].slice(0, numQueries);
  }
}

/**
 * Processes SERP results by scraping URLs and generating key learnings and follow-up questions.
 * The prompt instructs the assistant to produce a detailed, balanced analysis.
 */
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
  const rawContents = await googleService.scrape(result);

  const validIndexes: number[] = [];
  rawContents.forEach((content, index) => {
    if (content !== null) {
      validIndexes.push(index);
    }
  });

  const validUrls = validIndexes.map(i => result[i]!);

  logger.info(`Ran "${query}", retrieved content for ${validUrls.length} URLs`);

  try {
    let trimmedContents = rawContents.map(content => content ?? '').join('\n\n');
    let promptText = `Analyze the search results for "${query}" and generate ${numLearnings} key learnings and ${numFollowUpQuestions} follow-up questions${includeTopUrls ? ' and identify candidate top recommendations from the results' : ''}. Ensure that your analysis is detailed, balanced, and professional. Your follow-up questions should be clear and of moderate length.${includeTopUrls ? ' Additionally, return a field "topUrls" as an array of objects with keys "url" and "description" representing candidate top recommendations.' : ''}
  
Search Results:
${trimmedContents}
  
Required JSON format:
{
  "learnings": [
    "First key learning point about the topic",
    "Second key learning point about the topic",
    "Third key learning point about the topic"
  ],
  "followUpQuestions": [
    "First follow-up question to explore further",
    "Second follow-up question to explore further",
    "Third follow-up question to explore further"
  ]${includeTopUrls ? `,
  "topUrls": [
    { "url": "http://example.com", "description": "Explanation why this URL is candidate" }
  ]` : ''}
}`;
    let tokenCount = encoder.encode(promptText).length;
    logger.debug('processSerpResult initial prompt token count', { tokenCount });
    const trimSizes = [8000, 4000, 2000, 1000, 500];
    for (const trimSize of trimSizes) {
      if (tokenCount <= getMaxContextTokens(selectedModel)) break;
      logger.warn(`Prompt too long (${tokenCount} tokens), trimming to ${trimSize} per content...`);
      const reTrimmed = rawContents.map(content => trimPrompt(content ?? '', trimSize)).join('\n\n');
      promptText = `Analyze the search results for "${query}" and generate ${numLearnings} key learnings and ${numFollowUpQuestions} follow-up questions${includeTopUrls ? ' and identify candidate top recommendations from the results' : ''}. Ensure that your analysis is detailed, balanced and professional.
  
Search Results:
${reTrimmed}
  
Required JSON format:
{
  "learnings": [
    "First key learning point about the topic",
    "Second key learning point about the topic",
    "Third key learning point about the topic"
  ],
  "followUpQuestions": [
    "First follow-up question to explore further",
    "Second follow-up question to explore further",
    "Third follow-up question to explore further"
  ]${includeTopUrls ? `,
  "topUrls": [
    { "url": "http://example.com", "description": "Explanation why this URL is candidate" }
  ]` : ''}
}`;
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
      maxTokens: 8192,
      schema: z.object({
        learnings: z.array(z.string()).describe('Key learnings from the search results'),
        followUpQuestions: z.array(z.string()).describe('Follow-up questions to explore the topic further'),
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
      topUrls: safeResult.topUrls || [],
      visitedUrls: validUrls,
    };
  } catch (error) {
    logger.error('Error processing SERP result', { error });
    return {
      learnings: [
        `Found information about ${query}`,
        'Additional research may be needed',
        'Consider exploring related topics',
      ].slice(0, numLearnings),
      followUpQuestions: [
        `What are the most important aspects of ${query}?`,
        'What are the latest developments in this area?',
        'How does this compare to alternatives?',
      ].slice(0, numFollowUpQuestions),
      topUrls: [],
      visitedUrls: validUrls,
    };
  }
}

/**
 * Generates the final research report.
 * The prompt instructs the assistant to compile a hyper professional and detailed Markdown report.
 */
export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
  selectedModel,
  language,
  topUrls,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
  selectedModel?: string;
  language?: string;
  topUrls?: Array<{ url: string; description: string }>;
}) {
  try {
    let promptText = `Given the following prompt from the user, compile a hyper professional and detailed final research report on the topic using the provided learnings${topUrls && topUrls.length > 0 ? ' and top recommendations' : ''}. The report must be thorough, insightful, and written in Markdown with explicit newline characters (\\n) for newlines.
IMPORTANT: Do not include any URLs or hyperlinks in the body of the report; only use the real URLs provided in the citations section appended after your report.

Prompt: "${prompt}"

Learnings from research:
${learnings.map((learning, i) => `${i + 1}. ${learning}`).join('\n')}${
  topUrls && topUrls.length > 0
    ? `

Top Recommendations:
${topUrls.map((item, i) => `${i + 1}. ${item.url} - ${item.description}`).join('\n')}`
    : ''
}

Required JSON format:
{
  "reportMarkdown": "# Research Report\\n\\n## Summary\\n\\nYour summary here...\\n\\n## Key Findings\\n\\n1. First finding\\n2. Second finding"
}`;
    const tokenCount = encoder.encode(promptText).length;
    logger.debug('writeFinalReport prompt token count', { tokenCount });
    if (tokenCount > getMaxContextTokens(selectedModel)) {
      logger.warn(`WriteFinalReport prompt too long (${tokenCount} tokens), truncating learnings...`);
      const truncatedLearnings = learnings.slice(-5);
      const newPromptText = promptText.replace(
        learnings.map((learning, i) => `${i + 1}. ${learning}`).join('\n'),
        truncatedLearnings.map((learning, i) => `${i + 1}. ${learning}`).join('\n'),
      );
      const newTokenCount = encoder.encode(newPromptText).length;
      if (newTokenCount > getMaxContextTokens(selectedModel)) {
        throw new Error('Prompt too long even after truncating learnings');
      }
      promptText = newPromptText;
    }
    const res = await generateObjectSanitized({
      model: selectedModel ? createModel(selectedModel) : deepSeekModel,
      system: reportPrompt(language),
      prompt: promptText,
      schema: z.object({
        reportMarkdown: z.string().describe('Final report on the topic in Markdown format with escaped newlines'),
      }),
      temperature: 0.7,
      maxTokens: 8192,
    });
    const safeResult = res.object as { reportMarkdown: string };
    const reportWithNewlines = safeResult.reportMarkdown.replace(/\\n/g, '\n');
    const topSection = topUrls && topUrls.length > 0
      ? `\n\n## Top Recommendations\n\n${topUrls.map(item => `- <span class="break-words">${item.url}</span>: ${item.description}`).join('\n')}`
      : '';
    const urlsSection = `\n\n## Citations\n\n${visitedUrls.map(url => `- <span class="break-words">${url}</span>`).join('\n')}`;
    logger.info('Final report generated');
    return reportWithNewlines + topSection + urlsSection;
  } catch (error) {
    logger.error('Error generating final report', { error });
    const fallbackReport = `# Research Report

## Summary
${prompt}

## Key Findings
${learnings.map((learning, i) => `${i + 1}. ${learning}`).join('\n')}

## Citations
${visitedUrls.map(url => `- ${url}`).join('\n')}`;
    return fallbackReport;
  }
}

/**
 * Finalizes candidate top recommendations by performing a final LLM query to select the best ones.
 * @param candidates Array of candidate recommendations.
 * @param count Number of final recommendations desired (default 5 if not specified by the user).
 * @param selectedModel Optional model identifier.
 * @returns An array of final top recommendation objects.
 */
async function finalizeTopRecommendations(
  candidates: Array<{ url: string; description: string }>,
  count: number,
  selectedModel?: string,
): Promise<Array<{ url: string; description: string }>> {
  const promptText = `You are a research assistant tasked with selecting the final best recommendations from the following candidate top recommendations. Consider quality, relevance, and reliability. Please select the final best ${count} recommendations.

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
    temperature: 0.7,
    maxTokens: 1000,
  });
  return res.object.finalTopUrls;
}

/**
 * Modified deepResearch function with an optional progressCallback to send progress updates.
 * Added an optional sites parameter to restrict searches to specific websites.
 * Also supports continuation research via previous context (learned so far).
 */
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
}): Promise<ResearchResult> {
  logger.info('deepResearch started', { query, breadth, depth, selectedModel, sites });
  progressCallback && progressCallback(`PROGRESS: Depth: ${depth}, Breadth: ${breadth}`);

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
    serpQueries.map(serpQuery =>
      requestLimit(async () => {
        try {
          progressCallback && progressCallback(`Searching for "${serpQuery.query}"...`);
          const urls = await googleService.googleSearch(serpQuery.query, 10, sites);
          progressCallback && progressCallback(`Found ${urls.length} results for "${serpQuery.query}". Processing...`);
          logger.info('Processing SERP result', { query: serpQuery.query, urlsCount: urls.length });
          // Determine whether to include top URLs based on the query content
          const lowerSerpQuery = serpQuery.query.toLowerCase();
          const includeTopUrls = lowerSerpQuery.includes('best') && (lowerSerpQuery.includes('price') || lowerSerpQuery.includes('quality'));
          const newLearnings = await processSerpResult({
            query: serpQuery.query,
            result: urls,
            numFollowUpQuestions: Math.ceil(breadth / 2),
            selectedModel,
            includeTopUrls,
          });
          progressCallback && progressCallback(`Processed "${serpQuery.query}" and generated ${newLearnings.learnings.length} learnings.`);
          const allLearnings = [...learnings, ...newLearnings.learnings];
          const allUrls: string[] = [...visitedUrls, ...newLearnings.visitedUrls].filter(
            (u): u is string => u !== undefined,
          );
          // Collect topUrls from each SERP result
          const currentTopUrls = newLearnings.topUrls || [];
          const newDepth = depth - 1;
          if (newDepth > 0) {
            logger.info('Researching deeper', { nextBreadth: Math.ceil(breadth / 2), nextDepth: newDepth });
            progressCallback && progressCallback(`PROGRESS: Depth: ${newDepth}, Breadth: ${Math.ceil(breadth / 2)}`);
            const nextQuery = `
            Previous research goal: ${serpQuery.researchGoal}
            Follow-up research directions: ${newLearnings.followUpQuestions.map(q => `\n${q}`).join('')}
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
            });
            return {
              learnings: deeperResult.learnings,
              visitedUrls: deeperResult.visitedUrls,
              topUrls: [...currentTopUrls, ...deeperResult.topUrls],
            };
          } else {
            return {
              learnings: allLearnings,
              visitedUrls: allUrls,
              topUrls: currentTopUrls,
            };
          }
        } catch (e) {
          logger.error(`Error running query: ${serpQuery.query}`, { error: e });
          return {
            learnings: [],
            visitedUrls: [],
            topUrls: [],
          };
        }
      })
    )
  );

  const allLearnings = [...new Set(results.flatMap(r => r.learnings))];
  const allVisitedUrls = [
    ...new Set(results.flatMap(r => r.visitedUrls.filter((u): u is string => u !== undefined))),
  ];
  const allTopUrls = results.flatMap(r => r.topUrls);
  const uniqueTopUrls = Array.from(new Map(allTopUrls.map(item => [item.url, item])).values());

  let finalTopUrls = uniqueTopUrls;
  if (finalTopUrls.length > 0) {
    // Check if the query specifies a number for top recommendations using a regex e.g., "top 3" or "top 7"
    const match = query.match(/top\s+(\d+)/i);
    const recommendedCount = match && match[1] ? parseInt(match[1]) : 5;
    finalTopUrls = await finalizeTopRecommendations(uniqueTopUrls, recommendedCount, selectedModel);
  }

  const finalResult: ResearchResult = {
    learnings: allLearnings,
    visitedUrls: allVisitedUrls,
    topUrls: finalTopUrls,
  };
  logger.info('deepResearch completed', {
    learningsCount: finalResult.learnings.length,
    visitedUrlsCount: finalResult.visitedUrls.length,
    topUrlsCount: finalResult.topUrls.length,
  });
  return finalResult;
}
