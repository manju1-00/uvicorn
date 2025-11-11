import axios from 'axios'
import { PublicationData } from '@/lib/validation/validation'

export interface DBLPPublication {
  title: string
  authors: string[]
  year: number
  type: 'JOURNAL' | 'CONFERENCE'
  venue: string
  volume?: string
  issue?: string
  pages?: string
  doi?: string
  url?: string
  source: 'DBLP'
}

export class DBLPCrawler {
  private static readonly BASE_URL = 'https://dblp.org/search/publ/api'
  private static readonly RATE_LIMIT = 1000 // 1 second between requests
  private static readonly MAX_RESULTS = 1000
  private static readonly USER_AGENT = process.env.USER_AGENT || 'Faculty Publication Bot 1.0'

  private lastRequestTime = 0

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime

    if (timeSinceLastRequest < DBLPCrawler.RATE_LIMIT) {
      const waitTime = DBLPCrawler.RATE_LIMIT - timeSinceLastRequest
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }

    this.lastRequestTime = Date.now()
  }

  private async makeRequest(url: string): Promise<any> {
    await this.enforceRateLimit()

    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': DBLPCrawler.USER_AGENT
        },
        timeout: 30000 // 30 second timeout
      })

      return response.data
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
          throw new Error('DBLP service temporarily unavailable')
        } else if (error.response?.status === 429) {
          throw new Error('DBLP rate limit exceeded. Please try again later.')
        } else if (error.response?.status >= 500) {
          throw new Error('DBLP server error. Please try again later.')
        }
      }
      throw error
    }
  }

  private parseAuthorString(authorsString: string): string[] {
    if (!authorsString) {
      return []
    }

    // DBLP author format: "John Doe and Jane Smith"
    return authorsString
      .split(' and ')
      .map(author => author.trim())
      .filter(author => author.length > 0)
  }

  private extractVenueFromInfo(info: any): string {
    // Extract venue from different possible fields
    if (info.venue) {
      return info.venue
    }

    if (info.journal) {
      return info.journal
    }

    if (info.booktitle) {
      return info.booktitle
    }

    return 'Unknown Venue'
  }

  private determinePublicationType(info: any): 'JOURNAL' | 'CONFERENCE' {
    const type = info.type?.toLowerCase()

    if (type === 'article' || info.journal) {
      return 'JOURNAL'
    }

    if (type === 'inproceedings' || type === 'proceedings' || info.booktitle) {
      return 'CONFERENCE'
    }

    // Default determination based on common patterns
    const venue = this.extractVenueFromInfo(info).toLowerCase()
    if (venue.includes('conference') || venue.includes('proceedings') || venue.includes('workshop')) {
      return 'CONFERENCE'
    }

    return 'JOURNAL'
  }

  private extractDOI(info: any): string | undefined {
    // Try to find DOI in various fields
    if (info.doi) {
      return info.doi
    }

    if (info.ee) {
      // Check if ee field contains DOI
      const doiMatch = info.ee.match(/10\.\d+\/.+/)
      if (doiMatch) {
        return doiMatch[0]
      }
    }

    return undefined
  }

  private cleanTitle(title: string): string {
    if (!title) {
      return ''
    }

    // Remove common DBLP formatting artifacts
    return title
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim()
  }

  public async crawlByAuthor(
    authorName: string,
    startYear?: number,
    endYear?: number
  ): Promise<DBLPPublication[]> {
    if (!authorName || authorName.trim().length < 2) {
      throw new Error('Author name must be at least 2 characters long')
    }

    const publications: DBLPPublication[] = []
    let offset = 0
    let hasMore = true

    try {
      while (hasMore && publications.length < DBLPCrawler.MAX_RESULTS) {
        const searchUrl = new URL(DBLPCrawler.BASE_URL)
        searchUrl.searchParams.set('q', `author:"${authorName.trim()}"`)
        searchUrl.searchParams.set('format', 'json')
        searchUrl.searchParams.set('h', '100') // 100 results per request
        searchUrl.searchParams.set('f', offset.toString())

        if (startYear) {
          searchUrl.searchParams.set('year-start', startYear.toString())
        }

        if (endYear) {
          searchUrl.searchParams.set('year-end', endYear.toString())
        }

        const data = await this.makeRequest(searchUrl.toString())

        if (data.result && data.result.hits && data.result.hits.hit) {
          const hits = Array.isArray(data.result.hits.hit)
            ? data.result.hits.hit
            : [data.result.hits.hit]

          if (hits.length === 0) {
            hasMore = false
          } else {
            for (const hit of hits) {
              if (!hit.info) {
                continue
              }

              const info = hit.info
              const year = parseInt(info.year) || 0

              // Apply year filtering if specified (backup filter)
              if (startYear && year < startYear) {
                continue
              }
              if (endYear && year > endYear) {
                continue
              }

              // Skip entries without title or year
              if (!info.title || !info.year) {
                continue
              }

              const venue = this.extractVenueFromInfo(info)

              // Skip entries without proper venue
              if (venue === 'Unknown Venue') {
                continue
              }

              const publication: DBLPPublication = {
                title: this.cleanTitle(info.title),
                authors: this.parseAuthorString(info.authors?.author),
                year: year,
                type: this.determinePublicationType(info),
                venue: venue,
                volume: info.volume,
                issue: info.number || info.issue,
                pages: info.pages,
                doi: this.extractDOI(info),
                url: info.url || info.ee,
                source: 'DBLP'
              }

              publications.push(publication)
            }

            offset += hits.length
          }
        } else {
          hasMore = false
        }
      }

      return publications
    } catch (error) {
      console.error(`Error crawling DBLP for author "${authorName}":`, error)
      throw error
    }
  }

  public async crawlByAuthorWithRetry(
    authorName: string,
    startYear?: number,
    endYear?: number,
    maxRetries: number = 3
  ): Promise<DBLPPublication[]> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.crawlByAuthor(authorName, startYear, endYear)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error')

        if (attempt < maxRetries) {
          // Exponential backoff: wait 2^attempt seconds before retry
          const waitTime = Math.pow(2, attempt) * 1000
          console.warn(`DBLP crawler attempt ${attempt} failed for "${authorName}", retrying in ${waitTime}ms...`)
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      }
    }

    throw lastError || new Error('All retries failed')
  }

  public async validateAuthorName(authorName: string): Promise<boolean> {
    if (!authorName || authorName.trim().length < 2) {
      return false
    }

    try {
      const searchUrl = new URL(DBLPCrawler.BASE_URL)
      searchUrl.searchParams.set('q', `author:"${authorName.trim()}"`)
      searchUrl.searchParams.set('format', 'json')
      searchUrl.searchParams.set('h', '1') // Only check if any results exist

      const data = await this.makeRequest(searchUrl.toString())

      return !!(data.result && data.result.hits && data.result.hits.hit)
    } catch (error) {
      console.error(`Error validating author name "${authorName}":`, error)
      return false
    }
  }

  public getRateLimitInfo() {
    return {
      rateLimit: DBLPCrawler.RATE_LIMIT,
      maxResults: DBLPCrawler.MAX_RESULTS,
      userAgent: DBLPCrawler.USER_AGENT
    }
  }
}