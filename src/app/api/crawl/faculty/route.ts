import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/database'
import { DBLPCrawler } from '@/lib/crawlers/DBLPCrawler'
import { OpenAlexCrawler } from '@/lib/crawlers/OpenAlexCrawler'
import { GoogleScholarCrawler } from '@/lib/crawlers/GoogleScholarCrawler'
import { PublicationDeduplicator } from '@/lib/utils/deduplication'
import { ValidationError, CrawlingError, createErrorResponse } from '@/lib/error-handling/errorHandler'
import { validatePublicationData } from '@/lib/validation/validation'

interface CrawlRequest {
  facultyList: Array<{
    facultyName: string
    email: string
  }>
  dateRange: {
    startYear?: number
    endYear?: number
  }
  databases: Array<'dblp' | 'google_scholar' | 'openalex'>
  options?: {
    maxConcurrent?: number
    saveToDatabase?: boolean
    deduplicateResults?: boolean
  }
}

interface CrawlResult {
  facultyName: string
  email: string
  totalPublications: number
  publications: Array<{
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
    source: 'DBLP' | 'GOOGLE_SCHOLAR' | 'OPENALEX'
  }>
  databaseResults: {
    dblp?: { found: number; errors?: string[] }
    openalex?: { found: number; errors?: string[] }
    googleScholar?: { found: number; errors?: string[] }
  }
  errors?: string[]
}

interface CrawlResponse {
  success: boolean
  data?: {
    results: CrawlResult[]
    summary: {
      totalFaculty: number
      totalPublications: number
      uniquePublications: number
      duplicatesRemoved: number
      databaseStats: {
        dblp: number
        openalex: number
        googleScholar: number
      }
    }
    duplicateStats?: {
      duplicateGroups: number
      totalDuplicates: number
      averageGroupSize: number
      matchReasons: Record<string, number>
    }
  }
  error?: string
  message?: string
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    // Parse and validate request
    const body: CrawlRequest = await request.json()

    if (!body.facultyList || !Array.isArray(body.facultyList)) {
      throw new ValidationError('facultyList is required and must be an array')
    }

    if (body.facultyList.length === 0) {
      throw new ValidationError('facultyList cannot be empty')
    }

    if (!body.databases || !Array.isArray(body.databases)) {
      throw new ValidationError('databases is required and must be an array')
    }

    // Validate faculty list
    for (const faculty of body.facultyList) {
      if (!faculty.facultyName || typeof faculty.facultyName !== 'string') {
        throw new ValidationError('Each faculty must have a valid facultyName')
      }
      if (!faculty.email || typeof faculty.email !== 'string') {
        throw new ValidationError('Each faculty must have a valid email')
      }
    }

    // Validate date range
    const currentYear = new Date().getFullYear()
    if (body.dateRange?.startYear && (body.dateRange.startYear < 1900 || body.dateRange.startYear > currentYear)) {
      throw new ValidationError('startYear must be between 1900 and current year')
    }
    if (body.dateRange?.endYear && (body.dateRange.endYear < 1900 || body.dateRange.endYear > currentYear + 1)) {
      throw new ValidationError('endYear must be between 1900 and current year + 1')
    }

    const options = {
      maxConcurrent: body.options?.maxConcurrent || 3,
      saveToDatabase: body.options?.saveToDatabase ?? true,
      deduplicateResults: body.options?.deduplicateResults ?? true
    }

    // Initialize crawlers
    const dblpCrawler = new DBLPCrawler()
    const openAlexCrawler = new OpenAlexCrawler()
    const googleScholarCrawler = new GoogleScholarCrawler()

    console.log(`Starting crawl for ${body.facultyList.length} faculty members`)

    // Process faculty members with concurrency control
    const results: CrawlResult[] = []
    const facultyBatches = []

    // Create batches for concurrent processing
    for (let i = 0; i < body.facultyList.length; i += options.maxConcurrent) {
      facultyBatches.push(body.facultyList.slice(i, i + options.maxConcurrent))
    }

    for (const batch of facultyBatches) {
      const batchPromises = batch.map(async (faculty) => {
        console.log(`Processing faculty: ${faculty.facultyName}`)

        const result: CrawlResult = {
          facultyName: faculty.facultyName,
          email: faculty.email,
          totalPublications: 0,
          publications: [],
          databaseResults: {},
          errors: []
        }

        try {
          // Get faculty from database
          const facultyRecord = await prisma.faculty.findUnique({
            where: { email: faculty.email }
          })

          if (!facultyRecord) {
            result.errors?.push(`Faculty record not found for ${faculty.email}`)
            return result
          }

          let allPublications: any[] = []

          // Crawl DBLP
          if (body.databases.includes('dblp')) {
            try {
              console.log(`Crawling DBLP for ${faculty.facultyName}`)
              const dblpPublications = await dblpCrawler.crawlByAuthorWithRetry(
                faculty.facultyName,
                body.dateRange?.startYear,
                body.dateRange?.endYear
              )

              result.databaseResults.dblp = { found: dblpPublications.length }

              allPublications.push(...dblpPublications.map(pub => ({
                ...pub,
                facultyId: facultyRecord.id
              })))

              console.log(`DBLP found ${dblpPublications.length} publications for ${faculty.facultyName}`)
            } catch (error) {
              console.error(`DBLP error for ${faculty.facultyName}:`, error)
              result.databaseResults.dblp = { found: 0, errors: [error instanceof Error ? error.message : 'Unknown error'] }
              result.errors?.push(`DBLP: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
          }

          // Crawl OpenAlex
          if (body.databases.includes('openalex')) {
            try {
              console.log(`Crawling OpenAlex for ${faculty.facultyName}`)
              const openAlexPublications = await openAlexCrawler.crawlByAuthorNameWithRetry(
                faculty.facultyName,
                body.dateRange?.startYear,
                body.dateRange?.endYear
              )

              result.databaseResults.openalex = { found: openAlexPublications.length }

              allPublications.push(...openAlexPublications.map(pub => ({
                ...pub,
                facultyId: facultyRecord.id
              })))

              console.log(`OpenAlex found ${openAlexPublications.length} publications for ${faculty.facultyName}`)
            } catch (error) {
              console.error(`OpenAlex error for ${faculty.facultyName}:`, error)
              result.databaseResults.openalex = { found: 0, errors: [error instanceof Error ? error.message : 'Unknown error'] }
              result.errors?.push(`OpenAlex: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
          }

          // Crawl Google Scholar
          if (body.databases.includes('google_scholar')) {
            try {
              console.log(`Crawling Google Scholar for ${faculty.facultyName}`)
              const googleScholarPublications = await googleScholarCrawler.crawlByAuthorWithRetry(
                faculty.facultyName,
                body.dateRange?.startYear,
                body.dateRange?.endYear
              )

              result.databaseResults.googleScholar = { found: googleScholarPublications.length }

              allPublications.push(...googleScholarPublications.map(pub => ({
                ...pub,
                facultyId: facultyRecord.id
              })))

              console.log(`Google Scholar found ${googleScholarPublications.length} publications for ${faculty.facultyName}`)
            } catch (error) {
              console.error(`Google Scholar error for ${faculty.facultyName}:`, error)
              result.databaseResults.googleScholar = { found: 0, errors: [error instanceof Error ? error.message : 'Unknown error'] }
              result.errors?.push(`Google Scholar: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
          }

          // Deduplicate results
          let finalPublications = allPublications
          if (options.deduplicateResults && allPublications.length > 1) {
            try {
              const deduplicator = new PublicationDeduplicator()
              const deduplicationResult = deduplicator.deduplicate(allPublications)
              finalPublications = deduplicationResult.uniquePublications

              console.log(`Deduplicated ${allPublications.length} publications to ${finalPublications.length} unique publications for ${faculty.facultyName}`)
            } catch (error) {
              console.error(`Deduplication error for ${faculty.facultyName}:`, error)
              result.errors?.push(`Deduplication: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
          }

          // Save to database if requested
          if (options.saveToDatabase && finalPublications.length > 0) {
            try {
              const savedCount = await savePublicationsToDatabase(finalPublications)
              console.log(`Saved ${savedCount} publications to database for ${faculty.facultyName}`)
            } catch (error) {
              console.error(`Database save error for ${faculty.facultyName}:`, error)
              result.errors?.push(`Database save: ${error instanceof Error ? error.message : 'Unknown error'}`)
            }
          }

          result.totalPublications = finalPublications.length
          result.publications = finalPublications.map(pub => ({
            title: pub.title,
            authors: Array.isArray(pub.authors) ? pub.authors : JSON.parse(pub.authors || '[]'),
            year: pub.year,
            type: pub.type,
            venue: pub.venue,
            volume: pub.volume,
            issue: pub.issue,
            pages: pub.pages,
            doi: pub.doi,
            url: pub.url,
            abstract: pub.abstract,
            source: pub.source
          }))

        } catch (error) {
          console.error(`Faculty processing error for ${faculty.facultyName}:`, error)
          result.errors?.push(`Processing: ${error instanceof Error ? error.message : 'Unknown error'}`)
        }

        return result
      })

      // Wait for current batch to complete
      const batchResults = await Promise.allSettled(batchPromises)

      // Process batch results
      for (const promiseResult of batchResults) {
        if (promiseResult.status === 'fulfilled') {
          results.push(promiseResult.value)
        } else {
          console.error('Batch processing failed:', promiseResult.reason)
          results.push({
            facultyName: 'Unknown',
            email: 'unknown@example.com',
            totalPublications: 0,
            publications: [],
            databaseResults: {},
            errors: [`Batch processing failed: ${promiseResult.reason}`]
          })
        }
      }
    }

    // Clean up Google Scholar crawler
    await googleScholarCrawler.close()

    // Calculate summary statistics
    const totalPublications = results.reduce((sum, result) => sum + result.totalPublications, 0)
    const allPublications = results.flatMap(result => result.publications)

    // Deduplicate across all faculty members
    let uniquePublications = allPublications
    let duplicateStats: any = null

    if (options.deduplicateResults && allPublications.length > 1) {
      try {
        const deduplicator = new PublicationDeduplicator()
        const deduplicationResult = deduplicator.deduplicate(allPublications)
        uniquePublications = deduplicationResult.uniquePublications
        duplicateStats = deduplicator.getDeduplicationStats(deduplicationResult.duplicateGroups)
      } catch (error) {
        console.error('Global deduplication error:', error)
      }
    }

    const databaseStats = {
      dblp: results.reduce((sum, result) => sum + (result.databaseResults.dblp?.found || 0), 0),
      openalex: results.reduce((sum, result) => sum + (result.databaseResults.openalex?.found || 0), 0),
      googleScholar: results.reduce((sum, result) => sum + (result.databaseResults.googleScholar?.found || 0), 0)
    }

    const summary = {
      totalFaculty: body.facultyList.length,
      totalPublications,
      uniquePublications: uniquePublications.length,
      duplicatesRemoved: totalPublications - uniquePublications.length,
      databaseStats
    }

    const duration = Date.now() - startTime
    console.log(`Crawl completed in ${duration}ms`)

    return NextResponse.json({
      success: true,
      data: {
        results,
        summary,
        ...(duplicateStats && { duplicateStats })
      },
      message: `Successfully crawled ${summary.totalFaculty} faculty members and found ${summary.totalPublications} publications.`
    } as CrawlResponse)

  } catch (error) {
    console.error('Crawl orchestration error:', error)

    if (error instanceof ValidationError || error instanceof CrawlingError) {
      return NextResponse.json(
        createErrorResponse(error),
        { status: error.statusCode }
      )
    }

    // Generic server error
    return NextResponse.json(
      createErrorResponse({
        statusCode: 500,
        code: 'SERVER_ERROR' as any,
        message: 'Internal server error occurred during crawling',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      }),
      { status: 500 }
    )
  }
}

async function savePublicationsToDatabase(publications: any[]): Promise<number> {
  let savedCount = 0

  for (const pub of publications) {
    try {
      // Validate publication data
      const validation = validatePublicationData(pub)
      if (!validation.isValid) {
        console.warn(`Publication validation failed for "${pub.title}":`, validation.errors)
        continue
      }

      // Check for existing publication (duplicate check)
      const existingPub = await prisma.publication.findFirst({
        where: {
          title: pub.title,
          year: pub.year,
          facultyId: pub.facultyId
        }
      })

      if (existingPub) {
        continue // Skip duplicates
      }

      // Save new publication
      await prisma.publication.create({
        data: {
          title: pub.title,
          authors: Array.isArray(pub.authors) ? JSON.stringify(pub.authors) : pub.authors,
          year: pub.year,
          type: pub.type,
          venue: pub.venue,
          volume: pub.volume,
          issue: pub.issue,
          pages: pub.pages,
          doi: pub.doi,
          url: pub.url,
          abstract: pub.abstract,
          source: pub.source,
          facultyId: pub.facultyId
        }
      })

      savedCount++
    } catch (error) {
      console.error(`Error saving publication "${pub.title}":`, error)
      // Continue with other publications
    }
  }

  return savedCount
}