import { logger } from './utils/logger';

const EXTERNAL_API_KEY = process.env.SEARCH_API_KEY || '';

// Parse the list of endpoints from SEARCH_SCRAPE_ENDPOINTS (comma-separated). Fallback to the original single endpoint if empty.
const endpointsEnv = process.env.SEARCH_SCRAPE_ENDPOINTS || '';
const parsedEndpoints = endpointsEnv
  .split(',')
  .map(e => e.trim())
  .filter(Boolean);
const SEARCH_SCRAPE_ENDPOINTS = parsedEndpoints.length
  ? parsedEndpoints
  : ['google-twitter-scraper.vercel.app'];

// Simple round-robin index
let roundRobinIndex = 0;

/**
 * Returns the next endpoint in the round-robin list.
 */
function getNextEndpoint(): string {
  const endpoint = SEARCH_SCRAPE_ENDPOINTS[roundRobinIndex % SEARCH_SCRAPE_ENDPOINTS.length];
  roundRobinIndex++;
  return endpoint;
}

/**
 * Outsourced service to retrieve Google search results and scrape their contents
 * from an external API (e.g. https://google-twitter-scraper.vercel.app).
 */
export class GoogleService {
  constructor() {
    logger.info('GoogleService initialized using external API for search & scraping', {
      apiKeyPresent: !!EXTERNAL_API_KEY,
      endpoints: SEARCH_SCRAPE_ENDPOINTS,
    });
  }

  /**
   * Use the external API to retrieve Google search results for the given query.
   * @param query The search query
   * @param maxResults Maximum number of results to retrieve
   * @param sites Optional array of website URLs to restrict the search.
   * @returns An array of result URLs
   */
  public async googleSearch(query: string, maxResults: number, sites?: string[]): Promise<string[]> {
    logger.debug('GoogleService: googleSearch called', { query, maxResults, sites });
    if (!EXTERNAL_API_KEY) {
      logger.error('Missing SEARCH_API_KEY environment variable');
      return [];
    }

    // Determine timeframe heuristically based on query keywords.
    let timeframe = 'week'; // default timeframe
    if (/latest|new|current/i.test(query)) {
      timeframe = '24h';
    }

    // Pick the next endpoint in round-robin
    const baseEndpoint = getNextEndpoint();
    let searchUrl = `https://${baseEndpoint}/google/search?query=${encodeURIComponent(
      query,
    )}&max_results=${maxResults}&timeframe=${timeframe}`;
    if (sites && sites.length > 0) {
      for (const site of sites) {
        searchUrl += `&sites=${encodeURIComponent(site)}`;
      }
    }

    try {
      const response = await fetch(searchUrl, {
        headers: {
          'x-api-key': EXTERNAL_API_KEY,
        },
      });

      if (!response.ok) {
        logger.error('External search API returned a non-OK response', {
          status: response.status,
          statusText: response.statusText,
        });
        return [];
      }

      const json = await response.json();
      const results: string[] = Array.isArray(json.results) ? json.results : [];
      logger.info('External search API succeeded', {
        resultsCount: results.length,
        effectiveTimeframe: json.timeframe,
      });

      return results.slice(0, maxResults);
    } catch (e: any) {
      logger.error('Error calling external search API', {
        error: e.toString(),
        stack: e.stack,
      });
      return [];
    }
  }

  /**
   * Use the external API to scrape the content from a list of URLs.
   * Now includes the search query in the request body.
   * Returns an array of objects with properties: url, summary, and isQueryRelated.
   * If a bulk call returns a 504 (Gateway Timeout), fall back to individual calls.
   * Additionally, if any scraped result includes a non-empty relatedURLs array,
   * it will perform an extra scraping call for those URLs and merge their content
   * into the current research step.
   * @param urls An array of URLs to scrape
   * @param query The search query used for filtering relevance
   * @returns An array of objects containing scraped summary and relatedness flag for each URL.
   */
  public async scrape(
    urls: string[],
    query: string,
  ): Promise<Array<{ url: string; summary: string | null; isQueryRelated: boolean }>> {
    logger.debug('GoogleService: scrape called', { urlsCount: urls.length, query });
    if (!EXTERNAL_API_KEY) {
      logger.error('Missing SEARCH_API_KEY environment variable');
      return urls.map(url => ({ url, summary: null, isQueryRelated: false }));
    }

    if (urls.length === 0) {
      return [];
    }

    // Pick the next endpoint in round-robin
    const baseEndpoint = getNextEndpoint();
    const endpoint = `https://${baseEndpoint}/web/scrape`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': EXTERNAL_API_KEY,
        },
        body: JSON.stringify({ urls, query }),
      });

      if (!response.ok) {
        if (response.status === 504) {
          logger.warn('Bulk scrape API call timed out (504). Falling back to individual URL scraping.');
          const results = await Promise.all(
            urls.map(async url => {
              try {
                // Round-robin again for each single scrape call
                const singleBase = getNextEndpoint();
                const singleEndpoint = `https://${singleBase}/web/scrape`;
                const singleResponse = await fetch(singleEndpoint, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': EXTERNAL_API_KEY,
                  },
                  body: JSON.stringify({ urls: [url], query }),
                });
                if (!singleResponse.ok) {
                  logger.error('Individual scrape API call failed', {
                    url,
                    status: singleResponse.status,
                    statusText: singleResponse.statusText,
                  });
                  return { url, summary: null, isQueryRelated: false };
                }
                const json = await singleResponse.json();
                if (!Array.isArray(json.scraped) || json.scraped.length === 0) {
                  logger.error('Unexpected individual scrape API response format', { url });
                  return { url, summary: null, isQueryRelated: false };
                }
                const item = json.scraped[0];
                if (item && item.status === 200 && !item.error) {
                  return {
                    url,
                    summary: item.Summary || '',
                    isQueryRelated: item.IsQueryRelated === true,
                  };
                }
                return { url, summary: null, isQueryRelated: false };
              } catch (error: any) {
                logger.error('Error calling individual scrape API', {
                  url,
                  error: error.toString(),
                  stack: error.stack,
                });
                return { url, summary: null, isQueryRelated: false };
              }
            }),
          );
          return results;
        } else {
          logger.error('External scrape API returned a non-OK response', {
            status: response.status,
            statusText: response.statusText,
          });
          return urls.map(url => ({ url, summary: null, isQueryRelated: false }));
        }
      }

      const json = await response.json();
      if (!Array.isArray(json.scraped)) {
        logger.error('Unexpected scrape API response format');
        return urls.map(url => ({ url, summary: null, isQueryRelated: false }));
      }

      // Process primary scraped results and include relatedURLs if present
      const primaryResults = json.scraped.map((item: any) => {
        return {
          url: item.url,
          summary: item && item.status === 200 && !item.error ? item.Summary || '' : null,
          isQueryRelated: item && item.status === 200 && !item.error && item.IsQueryRelated === true,
          relatedURLs: Array.isArray(item.relatedURLs) ? item.relatedURLs : [],
        };
      });

      // Collect additional URLs from relatedURLs
      const additionalURLsSet = new Set<string>();
      primaryResults.forEach(item => {
        if (item.relatedURLs && item.relatedURLs.length > 0) {
          item.relatedURLs.forEach((relatedUrl: string) => {
            additionalURLsSet.add(relatedUrl);
          });
        }
      });
      // Remove URLs already present in primaryResults to avoid duplicates
      primaryResults.forEach(item => {
        additionalURLsSet.delete(item.url);
      });
      const additionalURLs = Array.from(additionalURLsSet);
      let additionalResults: Array<{ url: string; summary: string | null; isQueryRelated: boolean }> = [];
      if (additionalURLs.length > 0) {
        logger.info('Scraping related URLs', { count: additionalURLs.length });
        // Round-robin for the related scrape call
        const relatedBase = getNextEndpoint();
        const relatedEndpoint = `https://${relatedBase}/web/scrape`;
        const relatedResponse = await fetch(relatedEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': EXTERNAL_API_KEY,
          },
          body: JSON.stringify({ urls: additionalURLs, query }),
        });
        if (relatedResponse.ok) {
          const relatedJson = await relatedResponse.json();
          if (Array.isArray(relatedJson.scraped)) {
            additionalResults = relatedJson.scraped.map((item: any) => {
              return {
                url: item.url,
                summary: item && item.status === 200 && !item.error ? item.Summary || '' : null,
                isQueryRelated:
                  item && item.status === 200 && !item.error && item.IsQueryRelated === true,
              };
            });
          } else {
            logger.error('Unexpected related scrape API response format');
          }
        } else {
          logger.error('Related scrape API call failed', {
            status: relatedResponse.status,
            statusText: relatedResponse.statusText,
          });
        }
      }

      // Merge primaryResults and additionalResults, deduplicating by URL
      const mergedMap = new Map<
        string,
        { url: string; summary: string | null; isQueryRelated: boolean }
      >();
      primaryResults.forEach(item => {
        mergedMap.set(item.url, {
          url: item.url,
          summary: item.summary,
          isQueryRelated: item.isQueryRelated,
        });
      });
      additionalResults.forEach(item => {
        if (!mergedMap.has(item.url)) {
          mergedMap.set(item.url, item);
        }
      });

      const mergedResults = Array.from(mergedMap.values());
      logger.info('Scrape API succeeded', { totalResults: mergedResults.length });
      return mergedResults;
    } catch (e: any) {
      logger.error('Error calling external scrape API', {
        error: e.toString(),
        stack: e.stack,
      });
      return urls.map(url => ({ url, summary: null, isQueryRelated: false }));
    }
  }
}

export const googleService = new GoogleService();
