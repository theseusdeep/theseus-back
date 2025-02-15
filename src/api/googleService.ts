import { logger } from './utils/logger';

const EXTERNAL_API_KEY = process.env.SEARCH_API_KEY || '';

/**
 * Outsourced service to retrieve search results and scrape their contents
 * from an external API (https://google-twitter-scraper.vercel.app).
 */
export class GoogleService {
  constructor() {
    logger.info(
      'GoogleService initialized using external API for search & scraping',
      { apiKeyPresent: !!EXTERNAL_API_KEY },
    );
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

    // Decide on a default timeframe based on the query content.
    // If the query mentions "latest", "new", or "recent", use the last 24h; otherwise default to "week".
    let defaultTimeframe = /latest|new|recent/i.test(query) ? '24h' : 'week';

    let searchUrl = `https://google-twitter-scraper.vercel.app/google/search?query=${encodeURIComponent(query)}&max_results=${maxResults}&timeframe=${defaultTimeframe}`;

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
          // Use only the Summary property for scraped content
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
