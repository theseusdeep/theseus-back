import { logger } from './utils/logger';

const EXTERNAL_API_KEY = process.env.SEARCH_API_KEY || '';

/**
 * Outsourced service to retrieve search results and scrape their contents
 * from an external API (https://google-twitter-scraper.vercel.app).
 */
export class GoogleService {
  constructor() {
    logger.info('GoogleService initialized using external API for search & scraping', { apiKeyPresent: !!EXTERNAL_API_KEY });
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
    let timeframe = "week"; // default timeframe
    if (/latest|new|current/i.test(query)) {
      timeframe = "24h";
    }

    let searchUrl = `https://google-twitter-scraper.vercel.app/google/search?query=${encodeURIComponent(query)}&max_results=${maxResults}&timeframe=${timeframe}`;
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
      logger.info('External search API succeeded', { resultsCount: results.length });

      // If very few results, try a fallback with "month" timeframe.
      if (results.length < 3) {
        logger.info('Few results obtained from primary search, trying fallback with "month" timeframe', { currentTimeframe: timeframe });
        const fallbackMonthTimeframe = "month";
        let fallbackMonthUrl = `https://google-twitter-scraper.vercel.app/google/search?query=${encodeURIComponent(query)}&max_results=${maxResults}&timeframe=${fallbackMonthTimeframe}`;
        if (sites && sites.length > 0) {
          for (const site of sites) {
            fallbackMonthUrl += `&sites=${encodeURIComponent(site)}`;
          }
        }
        const fallbackMonthResponse = await fetch(fallbackMonthUrl, {
          headers: {
            'x-api-key': EXTERNAL_API_KEY,
          },
        });
        if (fallbackMonthResponse.ok) {
          const fallbackMonthJson = await fallbackMonthResponse.json();
          const fallbackMonthResults: string[] = Array.isArray(fallbackMonthJson.results) ? fallbackMonthJson.results : [];

          // If "month" fallback returns too few results, try with "year"
          if (fallbackMonthResults.length < 3) {
            logger.info('Fallback with "month" timeframe returned few results, trying fallback with "year" timeframe');
            const fallbackYearTimeframe = "year";
            let fallbackYearUrl = `https://google-twitter-scraper.vercel.app/google/search?query=${encodeURIComponent(query)}&max_results=${maxResults}&timeframe=${fallbackYearTimeframe}`;
            if (sites && sites.length > 0) {
              for (const site of sites) {
                fallbackYearUrl += `&sites=${encodeURIComponent(site)}`;
              }
            }
            const fallbackYearResponse = await fetch(fallbackYearUrl, {
              headers: {
                'x-api-key': EXTERNAL_API_KEY,
              },
            });
            if (fallbackYearResponse.ok) {
              const fallbackYearJson = await fallbackYearResponse.json();
              const fallbackYearResults: string[] = Array.isArray(fallbackYearJson.results) ? fallbackYearJson.results : [];

              // If "year" fallback still returns too few results, try with no timeframe.
              if (fallbackYearResults.length < 3) {
                logger.info('Fallback with "year" timeframe returned few results, trying extra fallback with no timeframe');
                let extraFallbackUrl = `https://google-twitter-scraper.vercel.app/google/search?query=${encodeURIComponent(query)}&max_results=${maxResults}`;
                if (sites && sites.length > 0) {
                  for (const site of sites) {
                    extraFallbackUrl += `&sites=${encodeURIComponent(site)}`;
                  }
                }
                const extraFallbackResponse = await fetch(extraFallbackUrl, {
                  headers: {
                    'x-api-key': EXTERNAL_API_KEY,
                  },
                });
                if (extraFallbackResponse.ok) {
                  const extraFallbackJson = await extraFallbackResponse.json();
                  const extraFallbackResults: string[] = Array.isArray(extraFallbackJson.results) ? extraFallbackJson.results : [];
                  const mergedResults = Array.from(new Set([...results, ...fallbackMonthResults, ...fallbackYearResults, ...extraFallbackResults]));
                  logger.info('Merged extra fallback results', { mergedCount: mergedResults.length });
                  return mergedResults.slice(0, maxResults);
                }
              } else {
                const mergedResults = Array.from(new Set([...results, ...fallbackMonthResults, ...fallbackYearResults]));
                logger.info('Merged fallback results from primary, month and year', { mergedCount: mergedResults.length });
                return mergedResults.slice(0, maxResults);
              }
            }
          } else {
            const mergedResults = Array.from(new Set([...results, ...fallbackMonthResults]));
            logger.info('Merged fallback results from primary and month', { mergedCount: mergedResults.length });
            return mergedResults.slice(0, maxResults);
          }
        }
      }

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
   * If a bulk call returns a 504 (Gateway Timeout), fall back to individual calls.
   * @param urls An array of URLs to scrape
   * @returns An array of strings or null values, parallel to the input URLs
   */
  public async scrape(urls: string[]): Promise<(string | null)[]> {
    logger.debug('GoogleService: scrape called', { urlsCount: urls.length });
    if (!EXTERNAL_API_KEY) {
      logger.error('Missing SEARCH_API_KEY environment variable');
      return urls.map(() => null);
    }

    if (urls.length === 0) {
      return [];
    }

    const endpoint = 'https://google-twitter-scraper.vercel.app/web/scrape';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': EXTERNAL_API_KEY,
        },
        body: JSON.stringify({ urls }),
      });

      if (!response.ok) {
        if (response.status === 504) {
          logger.warn('Bulk scrape API call timed out (504). Falling back to individual URL scraping.');
          const results = await Promise.all(
            urls.map(async (url) => {
              try {
                const singleResponse = await fetch(endpoint, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': EXTERNAL_API_KEY,
                  },
                  body: JSON.stringify({ urls: [url] }),
                });
                if (!singleResponse.ok) {
                  logger.error('Individual scrape API call failed', {
                    url,
                    status: singleResponse.status,
                    statusText: singleResponse.statusText,
                  });
                  return null;
                }
                const json = await singleResponse.json();
                if (!Array.isArray(json.scraped) || json.scraped.length === 0) {
                  logger.error('Unexpected individual scrape API response format', { url });
                  return null;
                }
                const item = json.scraped[0];
                if (item && item.status === 200 && !item.error) {
                  return item.Summary || '';
                }
                return null;
              } catch (error: any) {
                logger.error('Error calling individual scrape API', {
                  url,
                  error: error.toString(),
                  stack: error.stack,
                });
                return null;
              }
            })
          );
          return results;
        } else {
          logger.error('External scrape API returned a non-OK response', {
            status: response.status,
            statusText: response.statusText,
          });
          return urls.map(() => null);
        }
      }

      const json = await response.json();
      if (!Array.isArray(json.scraped)) {
        logger.error('Unexpected scrape API response format');
        return urls.map(() => null);
      }
      return json.scraped.map((item: any) => {
        if (item && item.status === 200 && !item.error) {
          return item.Summary || '';
        }
        return null;
      });
    } catch (e: any) {
      logger.error('Error calling external scrape API', {
        error: e.toString(),
        stack: e.stack,
      });
      return urls.map(() => null);
    }
  }
}
