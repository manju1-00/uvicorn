import puppeteer, { Browser, Page } from 'puppeteer'
import { JSDOM } from 'jsdom'

export interface GoogleScholarPublication {
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
  source: 'GOOGLE_SCHOLAR'
}

export class GoogleScholarCrawler {
  private static readonly BASE_URL = 'https://scholar.google.com'
  private static readonly MIN_DELAY = 5000 // 5 seconds minimum between requests
  private static readonly MAX_DELAY = 15000 // 15 seconds maximum between requests
  private static readonly MAX_PAGES = 10 // Maximum pages to crawl per author
  private static readonly USER_AGENT = process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

  private browser: Browser | null = null
  private lastRequestTime = 0

  private async enforceRateLimit(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime

    if (timeSinceLastRequest < GoogleScholarCrawler.MIN_DELAY) {
      const waitTime = GoogleScholarCrawler.MIN_DELAY - timeSinceLastRequest
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }

    this.lastRequestTime = Date.now()
  }

  private async getRandomDelay(): Promise<void> {
    const delay = Math.random() * (GoogleScholarCrawler.MAX_DELAY - GoogleScholarCrawler.MIN_DELAY) + GoogleScholarCrawler.MIN_DELAY
    await new Promise(resolve => setTimeout(resolve, delay))
  }

  private async initBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--user-agent=' + GoogleScholarCrawler.USER_AGENT,
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-ipc-flooding-protection'
        ]
      })
    }
    return this.browser
  }

  private async createPage(): Promise<Page> {
    const browser = await this.initBrowser()
    const page = await browser.newPage()

    // Set viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 })
    await page.setUserAgent(GoogleScholarCrawler.USER_AGENT)

    // Set extra headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    })

    // Add stealth behaviors
    await page.evaluateOnNewDocument(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      })

      // Override permissions
      const originalQuery = window.navigator.permissions.query
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      )
    })

    return page
  }

  private async simulateHumanBehavior(page: Page): Promise<void> {
    // Random mouse movements
    await page.mouse.move(
      Math.random() * 1920,
      Math.random() * 1080
    )

    // Random scroll
    if (Math.random() > 0.7) {
      await page.evaluate(() => {
        window.scrollBy(0, Math.random() * 500)
      })
    }

    // Small delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500))
  }

  private extractAuthorsFromDOM(element: Element): string[] {
    const authorElement = element.querySelector('.gs_a')
    if (!authorElement) {
      return []
    }

    const authorText = authorElement.textContent || ''
    // Format: "A Smith, B Jones - Journal, 2023 - scholar.google.com"
    const parts = authorText.split(' - ')
    if (parts.length === 0) {
      return []
    }

    const authorPart = parts[0]
    return authorPart
      .split(',')
      .map(author => author.trim())
      .filter(author => author.length > 0)
  }

  private extractVenueFromDOM(element: Element): string {
    const venueElement = element.querySelector('.gs_a')
    if (!venueElement) {
      return 'Unknown Venue'
    }

    const venueText = venueElement.textContent || ''
    // Extract venue from the middle part
    const parts = venueText.split(' - ')
    if (parts.length >= 2) {
      // Remove author names and site info
      const venueParts = parts.slice(1, -1)
      return venueParts.join(' - ').trim()
    }

    return 'Unknown Venue'
  }

  private extractYearFromDOM(element: Element): number {
    const venueElement = element.querySelector('.gs_a')
    if (!venueElement) {
      return 0
    }

    const venueText = venueElement.textContent || ''
    // Look for 4-digit year patterns
    const yearMatch = venueText.match(/\b(19|20)\d{2}\b/)
    if (yearMatch) {
      return parseInt(yearMatch[0])
    }

    return 0
  }

  private extractUrlFromDOM(element: Element): string | undefined {
    const linkElement = element.querySelector('.gs_rt a')
    if (!linkElement) {
      return undefined
    }

    const href = (linkElement as HTMLAnchorElement).href
    if (href && href.startsWith('http')) {
      return href
    }

    return undefined
  }

  private determinePublicationTypeFromVenue(venue: string): 'JOURNAL' | 'CONFERENCE' {
    const normalizedVenue = venue.toLowerCase()

    if (normalizedVenue.includes('conference') ||
        normalizedVenue.includes('proceedings') ||
        normalizedVenue.includes('workshop') ||
        normalizedVenue.includes('symposium') ||
        normalizedVenue.includes('intl') ||
        normalizedVenue.includes('international')) {
      return 'CONFERENCE'
    }

    return 'JOURNAL'
  }

  private async checkForCAPTCHA(page: Page): Promise<boolean> {
    try {
      await page.waitForSelector('form[action*="captcha"]', { timeout: 2000 })
      return true
    } catch {
      return false
    }
  }

  private async handleCAPTCHA(page: Page): Promise<void> {
    console.warn('CAPTCHA detected. Manual intervention required.')

    // Take screenshot for debugging
    try {
      const screenshot = await page.screenshot({ encoding: 'base64' })
      console.log('CAPTCHA screenshot taken:', screenshot.slice(0, 100) + '...')
    } catch (error) {
      console.error('Failed to take CAPTCHA screenshot:', error)
    }

    throw new Error('CAPTCHA detected. Please solve manually or try again later.')
  }

  public async crawlByAuthor(
    authorName: string,
    startYear?: number,
    endYear?: number
  ): Promise<GoogleScholarPublication[]> {
    if (!authorName || authorName.trim().length < 2) {
      throw new Error('Author name must be at least 2 characters long')
    }

    const publications: GoogleScholarPublication[] = []
    let page: Page | null = null

    try {
      await this.enforceRateLimit()

      page = await this.createPage()
      await this.simulateHumanBehavior(page)

      // Construct search URL
      const searchQuery = `"${authorName.trim()}"`
      const searchUrl = new URL(`${GoogleScholarCrawler.BASE_URL}/scholar`)
      searchUrl.searchParams.set('q', searchQuery)
      searchUrl.searchParams.set('hl', 'en')
      searchUrl.searchParams.set('as_sdt', '0,5') // Include patents

      // Add year filters if specified
      if (startYear || endYear) {
        const yearRange = `${startYear || ''}-${endYear || ''}`
        searchUrl.searchParams.set('as_ylo', (startYear || '').toString())
        searchUrl.searchParams.set('as_yhi', (endYear || '').toString())
      }

      console.log(`Crawling Google Scholar for author: "${authorName}"`)

      let currentPage = 1
      let hasMorePages = true

      while (hasMorePages && currentPage <= GoogleScholarCrawler.MAX_PAGES) {
        // Navigate to search results
        await page.goto(searchUrl.toString(), {
          waitUntil: 'networkidle2',
          timeout: 30000
        })

        // Check for CAPTCHA
        if (await this.checkForCAPTCHA(page)) {
          await this.handleCAPTCHA(page)
        }

        // Simulate human behavior
        await this.simulateHumanBehavior(page)

        // Wait for results to load
        await page.waitForSelector('.gs_r', { timeout: 10000 })

        // Extract publications from current page
        const pagePublications = await page.evaluate(() => {
          const results = []
          const resultElements = document.querySelectorAll('.gs_r.gs_or.gs_scl')

          for (const element of resultElements) {
            try {
              const titleElement = element.querySelector('.gs_rt')
              if (!titleElement) continue

              const title = titleElement.textContent?.replace(/^\[PDF\]|\[HTML\]|\[BOOK\]/, '').trim()
              if (!title) continue

              const authorsElement = element.querySelector('.gs_a')
              const authorsText = authorsElement?.textContent || ''

              // Extract authors (text before first dash)
              const authorMatch = authorsText.match(/^(.*?)\s*-\s*/)
              const authors = authorMatch ? authorMatch[1].split(',').map((a: string) => a.trim()).filter((a: string) => a) : []

              // Extract year
              const yearMatch = authorsText.match(/\b(19|20)\d{2}\b/)
              const year = yearMatch ? parseInt(yearMatch[0]) : 0

              // Extract venue
              const venueMatch = authorsText.match(/-\s*(.*?)\s*,?\s*\d{4}/)
              const venue = venueMatch ? venueMatch[1].trim() : 'Unknown Venue'

              // Extract URL
              const linkElement = titleElement.querySelector('a')
              const url = linkElement ? (linkElement as HTMLAnchorElement).href : undefined

              results.push({
                title,
                authors,
                year,
                venue,
                url
              })
            } catch (error) {
              console.error('Error parsing result element:', error)
            }
          }

          return results
        })

        // Process and filter results
        for (const pub of pagePublications) {
          // Apply year filtering (backup)
          if (startYear && pub.year < startYear) continue
          if (endYear && pub.year > endYear) continue

          // Skip invalid entries
          if (!pub.title || pub.year === 0 || pub.venue === 'Unknown Venue') {
            continue
          }

          const publication: GoogleScholarPublication = {
            title: pub.title,
            authors: pub.authors,
            year: pub.year,
            type: this.determinePublicationTypeFromVenue(pub.venue),
            venue: pub.venue,
            url: pub.url,
            source: 'GOOGLE_SCHOLAR'
          }

          publications.push(publication)
        }

        console.log(`Page ${currentPage}: Found ${pagePublications.length} publications`)

        // Check if there are more pages
        try {
          const nextButton = await page.$('.gs_ico.gs_ico_nav_next')
          if (nextButton && currentPage < GoogleScholarCrawler.MAX_PAGES) {
            // Click next button and continue
            await nextButton.click()
            await this.getRandomDelay()
            currentPage++
          } else {
            hasMorePages = false
          }
        } catch (error) {
          console.log('No more pages found or error navigating to next page')
          hasMorePages = false
        }
      }

      return publications
    } catch (error) {
      console.error(`Error crawling Google Scholar for author "${authorName}":`, error)
      throw error
    } finally {
      if (page) {
        await page.close()
      }
    }
  }

  public async crawlByAuthorWithRetry(
    authorName: string,
    startYear?: number,
    endYear?: number,
    maxRetries: number = 2
  ): Promise<GoogleScholarPublication[]> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.crawlByAuthor(authorName, startYear, endYear)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error')

        if (attempt < maxRetries && !lastError.message.includes('CAPTCHA')) {
          // Exponential backoff
          const waitTime = Math.pow(2, attempt) * 10000
          console.warn(`Google Scholar crawler attempt ${attempt} failed for "${authorName}", retrying in ${waitTime}ms...`)
          await new Promise(resolve => setTimeout(resolve, waitTime))
        }
      }
    }

    throw lastError || new Error('All retries failed')
  }

  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }

  public getCrawlerInfo() {
    return {
      baseUrl: GoogleScholarCrawler.BASE_URL,
      minDelay: GoogleScholarCrawler.MIN_DELAY,
      maxDelay: GoogleScholarCrawler.MAX_DELAY,
      maxPages: GoogleScholarCrawler.MAX_PAGES,
      userAgent: GoogleScholarCrawler.USER_AGENT
    }
  }
}