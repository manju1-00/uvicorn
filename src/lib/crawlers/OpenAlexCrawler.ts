import axios from 'axios'

export interface OpenAlexPublication {
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
  abstract?: string
  source: 'OPENALEX'
}

export interface OpenAlexAuthor {
  id: string
  displayName: string
  orcid?: string
}

export class OpenAlexCrawler {
  private static readonly BASE_URL = 'https://api.openalex.org'
  private static readonly DEFAULT_PER_PAGE = 100
  private static readonly MAX_PER_PAGE = 200
  private static readonly USER_AGENT = process.env.USER_AGENT || 'Faculty Publication Bot 1.0'

  private async makeRequest(url: string): Promise<any> {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': OpenAlexCrawler.USER_AGENT,
          'Accept': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      })

      return response.data
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
          throw new Error('OpenAlex service temporarily unavailable')
        } else if (error.response?.status === 429) {
          throw new Error('OpenAlex rate limit exceeded. Please try again later.')
        } else if (error.response?.status >= 500) {
          throw new Error('OpenAlex server error. Please try again later.')
        }
      }
      throw error
    }
  }

  private extractAuthors(authorships: any[]): string[] {
    if (!authorships || !Array.isArray(authorships)) {
      return []
    }

    return authorships
      .map(authorship => authorship.author?.display_name)
      .filter(author => author && typeof author === 'string')
      .map(author => author.trim())
  }

  private determinePublicationType(type: string, primaryLocation?: any): 'JOURNAL' | 'CONFERENCE' {
    if (!type) {
      return 'JOURNAL'
    }

    const normalizedType = type.toLowerCase()

    // OpenAlex specific types
    if (normalizedType === 'journal-article') {
      return 'JOURNAL'
    }

    if (normalizedType === 'conference-paper' || normalizedType === 'proceedings-article') {
      return 'CONFERENCE'
    }

    // Fallback: check venue type
    if (primaryLocation?.source?.type) {
      const venueType = primaryLocation.source.type.toLowerCase()
      if (venueType.includes('journal')) {
        return 'JOURNAL'
      }
      if (venueType.includes('conference') || venueType.includes('proceedings')) {
        return 'CONFERENCE'
      }
    }

    // Default to journal for unknown types
    return 'JOURNAL'
  }

  private extractVenue(primaryLocation?: any): string {
    if (!primaryLocation) {
      return 'Unknown Venue'
    }

    if (primaryLocation.display_name) {
      return primaryLocation.display_name
    }

    if (primaryLocation.source?.display_name) {
      return primaryLocation.source.display_name
    }

    return 'Unknown Venue'
  }

  private extractVolumeIssuePages(primaryLocation?: any): {
    volume?: string
    issue?: string
    pages?: string
  } {
    const result: { volume?: string; issue?: string; pages?: string } = {}

    if (primaryLocation) {
      result.volume = primaryLocation.volume || undefined
      result.issue = primaryLocation.issue || undefined
      result.pages = primaryLocation.pages || undefined
    }

    return result
  }

  private cleanTitle(title: string): string {
    if (!title) {
      return ''
    }

    return title
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
  }

  public async searchAuthors(authorName: string): Promise<OpenAlexAuthor[]> {
    if (!authorName || authorName.trim().length < 2) {
      throw new Error('Author name must be at least 2 characters long')
    }

    const searchUrl = new URL(`${OpenAlexCrawler.BASE_URL}/authors`)
    searchUrl.searchParams.set('search', authorName.trim())
    searchUrl.searchParams.set('per-page', '10') // Get top 10 results

    try {
      const data = await this.makeRequest(searchUrl.toString())

      if (data.results && Array.isArray(data.results)) {
        return data.results.map((author: any) => ({
          id: author.id,
          displayName: author.display_name,
          orcid: author.orcid
        }))
      }

      return []
    } catch (error) {
      console.error(`Error searching OpenAlex authors for "${authorName}":`, error)
      throw error
    }
  }

  public async getAuthorWorks(
    authorId: string,
    startYear?: number,
    endYear?: number,
    publicationType?: 'JOURNAL' | 'CONFERENCE'
  ): Promise<OpenAlexPublication[]> {
    if (!authorId) {
      throw new Error('Author ID is required')
    }

    const publications: OpenAlexPublication[] = []
    let cursor = '*'
    let hasMore = true

    try {
      while (hasMore) {
        const searchUrl = new URL(`${OpenAlexCrawler.BASE_URL}/works`)
        searchUrl.searchParams.set('filter', `author.id:${authorId}`)
        searchUrl.searchParams.set('per-page', OpenAlexCrawler.MAX_PER_PAGE.toString())
        searchUrl.searchParams.set('cursor', cursor)

        // Add year filters if specified
        const yearFilters: string[] = []
        if (startYear) {
          yearFilters.push(`from_publication_date:${startYear}-01-01`)
        }
        if (endYear) {
          yearFilters.push(`to_publication_date:${endYear}-12-31`)
        }
        if (yearFilters.length > 0) {
          searchUrl.searchParams.set('filter', `author.id:${authorId},${yearFilters.join(',')}`)
        }

        const data = await this.makeRequest(searchUrl.toString())

        if (data.results && Array.isArray(data.results)) {
          for (const work of data.results) {
            if (!work.title || !work.publication_year) {
              continue
            }

            const type = this.determinePublicationType(work.type, work.primary_location)

            // Apply publication type filter if specified
            if (publicationType && type !== publicationType) {
              continue
            }

            const venue = this.extractVenue(work.primary_location)
            const { volume, issue, pages } = this.extractVolumeIssuePages(work.primary_location)

            const publication: OpenAlexPublication = {
              title: this.cleanTitle(work.title),
              authors: this.extractAuthors(work.authorships),
              year: work.publication_year,
              type: type,
              venue: venue,
              volume: volume,
              issue: issue,
              pages: pages,
              doi: work.doi,
              url: work.primary_location?.landing_page_url,
              abstract: work.abstract,
              source: 'OPENALEX'
            }

            publications.push(publication)
          }

          // Check for pagination
          if (data.meta?.next_cursor) {
            cursor = data.meta.next_cursor
          } else {
            hasMore = false
          }
        } else {
          hasMore = false
        }

        // Prevent infinite loops
        if (publications.length >= 1000) {
          console.warn(`Reached maximum limit of 1000 publications for author ${authorId}`)
          break
        }
      }

      return publications
    } catch (error) {
      console.error(`Error fetching OpenAlex works for author ${authorId}:`, error)
      throw error
    }
  }

  public async crawlByAuthorName(
    authorName: string,
    startYear?: number,
    endYear?: number,
    publicationType?: 'JOURNAL' | 'CONFERENCE'
  ): Promise<OpenAlexPublication[]> {
    // First, search for the author
    const authors = await this.searchAuthors(authorName)

    if (authors.length === 0) {
      console.warn(`No authors found in OpenAlex for name: "${authorName}"`)
      return []
    }

    // If multiple authors found, try to find the best match
    let bestMatch = authors[0]

    // Simple matching: prefer exact matches
    const exactMatches = authors.filter(author =>
      author.displayName.toLowerCase() === authorName.toLowerCase().trim()
    )

    if (exactMatches.length > 0) {
      bestMatch = exactMatches[0]
    } else {
      // Try fuzzy matching
      const normalizedSearch = authorName.toLowerCase().replace(/[^a-z0-9\s]/g, '')
      const fuzzyMatches = authors.filter(author => {
        const normalizedAuthor = author.displayName.toLowerCase().replace(/[^a-z0-9\s]/g, '')
        return normalizedAuthor.includes(normalizedSearch) || normalizedSearch.includes(normalizedAuthor)
      })

      if (fuzzyMatches.length > 0) {
        bestMatch = fuzzyMatches[0]
      }
    }

    console.log(`Crawling OpenAlex for author: "${bestMatch.displayName}" (ID: ${bestMatch.id})`)

    return await this.getAuthorWorks(bestMatch.id, startYear, endYear, publicationType)
  }

  public async crawlByAuthorNameWithRetry(
    authorName: string,
    startYear?: number,
    endYear?: number,
    publicationType?: 'JOURNAL' | 'CONFERENCE',
    maxRetries: number = 3
  ): Promise<OpenAlexPublication[]> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.crawlByAuthorName(authorName, startYear, endYear, publicationType)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error')

        if (attempt < maxRetries) {
          // Exponential backoff: wait 2^attempt seconds before retry
          const waitTime = Math.pow(2, attempt) * 1000
          console.warn(`OpenAlex crawler attempt ${attempt} failed for "${authorName}", retrying in ${waitTime}ms...`)
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
      const authors = await this.searchAuthors(authorName)
      return authors.length > 0
    } catch (error) {
      console.error(`Error validating author name "${authorName}":`, error)
      return false
    }
  }

  public getApiInfo() {
    return {
      baseUrl: OpenAlexCrawler.BASE_URL,
      maxPerPage: OpenAlexCrawler.MAX_PER_PAGE,
      userAgent: OpenAlexCrawler.USER_AGENT
    }
  }
}