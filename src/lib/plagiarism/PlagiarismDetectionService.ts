import natural from 'natural'
import { v4 as uuidv4 } from 'uuid'
import { prisma } from '@/lib/database'

export interface PlagiarismSource {
  id: string
  title: string
  authors: string[]
  year: number
  venue: string
  url?: string
  similarityScore: number
  matchedText: string[]
  excerpt: string
}

export interface PlagiarismResult {
  scanId: string
  originalityScore: number
  similarityPercentage: number
  sources: PlagiarismSource[]
  status: 'COMPLETED' | 'PROCESSING' | 'FAILED'
  processingTime?: number
  totalWords?: number
  suspiciousPhrases?: string[]
}

export interface TextSegment {
  text: string
  startIndex: number
  endIndex: number
  type: 'sentence' | 'phrase'
}

export class PlagiarismDetectionService {
  private readonly SIMILARITY_THRESHOLD = 0.8
  private readonly MIN_TEXT_LENGTH = 500
  private readonly PHRASE_MIN_LENGTH = 5
  private readonly MAX_PHRASE_LENGTH = 30

  private tokenizer = new natural.WordTokenizer()
  private stemmer = natural.PorterStemmer

  /**
   * Preprocess text for analysis
   */
  private preprocessText(text: string): string {
    if (!text) {
      return ''
    }

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove special characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
  }

  /**
   * Extract text segments (sentences and phrases)
   */
  private extractTextSegments(text: string): TextSegment[] {
    const segments: TextSegment[] = []

    // Split into sentences
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0)

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim()
      if (trimmedSentence.length >= this.PHRASE_MIN_LENGTH) {
        segments.push({
          text: trimmedSentence,
          startIndex: text.indexOf(trimmedSentence),
          endIndex: text.indexOf(trimmedSentence) + trimmedSentence.length,
          type: 'sentence'
        })
      }

      // Extract phrases from long sentences
      if (trimmedSentence.length > this.MAX_PHRASE_LENGTH) {
        const words = this.tokenizer.tokenize(trimmedSentence) || []
        for (let i = 0; i <= words.length - this.PHRASE_MIN_LENGTH; i++) {
          const phrase = words.slice(i, i + this.PHRASE_MIN_LENGTH).join(' ')
          segments.push({
            text: phrase,
            startIndex: trimmedSentence.indexOf(phrase),
            endIndex: trimmedSentence.indexOf(phrase) + phrase.length,
            type: 'phrase'
          })
        }
      }
    }

    return segments
  }

  /**
   * Calculate TF-IDF vectors for text similarity
   */
  private calculateTFIDF(text: string): Map<string, number> {
    const tokens = this.tokenizer.tokenize(text.toLowerCase()) || []
    const termFreq = new Map<string, number>()

    // Calculate term frequency
    for (const token of tokens) {
      const stemmedToken = this.stemmer.stem(token)
      termFreq.set(stemmedToken, (termFreq.get(stemmedToken) || 0) + 1)
    }

    // Normalize
    const totalTerms = tokens.length
    for (const [term, freq] of termFreq) {
      termFreq.set(term, freq / totalTerms)
    }

    return termFreq
  }

  /**
   * Calculate cosine similarity between two TF-IDF vectors
   */
  private calculateCosineSimilarity(vector1: Map<string, number>, vector2: Map<string, number>): number {
    const intersection = new Set([...vector1.keys()].filter(x => vector2.has(x)))

    if (intersection.size === 0) {
      return 0
    }

    let dotProduct = 0
    let magnitude1 = 0
    let magnitude2 = 0

    for (const term of intersection) {
      dotProduct += (vector1.get(term) || 0) * (vector2.get(term) || 0)
    }

    for (const freq of vector1.values()) {
      magnitude1 += freq * freq
    }

    for (const freq of vector2.values()) {
      magnitude2 += freq * freq
    }

    magnitude1 = Math.sqrt(magnitude1)
    magnitude2 = Math.sqrt(magnitude2)

    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0
    }

    return dotProduct / (magnitude1 * magnitude2)
  }

  /**
   * Calculate Jaccard similarity between two texts
   */
  private calculateJaccardSimilarity(text1: string, text2: string): number {
    const tokens1 = new Set(this.tokenizer.tokenize(text1.toLowerCase()) || [])
    const tokens2 = new Set(this.tokenizer.tokenize(text2.toLowerCase()) || [])

    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)))
    const union = new Set([...tokens1, ...tokens2])

    if (union.size === 0) {
      return 0
    }

    return intersection.size / union.size
  }

  /**
   * Calculate Levenshtein similarity
   */
  private calculateLevenshteinSimilarity(text1: string, text2: string): number {
    const distance = natural.JaroWinklerDistance(text1, text2)
    return distance
  }

  /**
   * Calculate overall similarity score
   */
  private calculateOverallSimilarity(text1: string, text2: string): number {
    const tfidf1 = this.calculateTFIDF(text1)
    const tfidf2 = this.calculateTFIDF(text2)

    const cosineSimilarity = this.calculateCosineSimilarity(tfidf1, tfidf2)
    const jaccardSimilarity = this.calculateJaccardSimilarity(text1, text2)
    const levenshteinSimilarity = this.calculateLevenshteinSimilarity(text1, text2)

    // Weighted average (TF-IDF is most important)
    return (cosineSimilarity * 0.5) + (jaccardSimilarity * 0.3) + (levenshteinSimilarity * 0.2)
  }

  /**
   * Find suspicious phrases in text
   */
  private findSuspiciousPhrases(segments: TextSegment[], referenceTexts: string[]): string[] {
    const suspiciousPhrases: string[] = []

    for (const segment of segments) {
      if (segment.type !== 'phrase' || segment.text.length < this.PHRASE_MIN_LENGTH) {
        continue
      }

      for (const referenceText of referenceTexts) {
        const similarity = this.calculateOverallSimilarity(segment.text, referenceText)

        if (similarity >= this.SIMILARITY_THRESHOLD) {
          suspiciousPhrases.push(segment.text)
          break // Move to next segment once a match is found
        }
      }
    }

    return [...new Set(suspiciousPhrases)] // Remove duplicates
  }

  /**
   * Get reference publications from database for comparison
   */
  private async getReferencePublications(facultyId?: string, limit: number = 100): Promise<Array<{ id: string; title: string; abstract: string; content: string }>> {
    try {
      const publications = await prisma.publication.findMany({
        where: {
          ...(facultyId && { facultyId: { not: facultyId } }), // Exclude current faculty's publications
          OR: [
            { abstract: { not: null } },
            { title: { not: null } }
          ]
        },
        select: {
          id: true,
          title: true,
          abstract: true,
          authors: true,
          venue: true,
          year: true,
          url: true
        },
        take: limit,
        orderBy: {
          year: 'desc'
        }
      })

      return publications.map(pub => ({
        id: pub.id,
        title: pub.title || '',
        abstract: pub.abstract || '',
        content: `${pub.title || ''} ${pub.abstract || ''}`.trim()
      }))
    } catch (error) {
      console.error('Error fetching reference publications:', error)
      return []
    }
  }

  /**
   * Analyze text against reference publications
   */
  private async analyzeAgainstReferences(
    text: string,
    referencePublications: Array<{ id: string; title: string; abstract: string; content: string }>
  ): Promise<PlagiarismSource[]> {
    const sources: PlagiarismSource[] = []
    const textSegments = this.extractTextSegments(text)

    for (const reference of referencePublications) {
      const referenceContent = reference.content
      if (referenceContent.length < this.MIN_TEXT_LENGTH) {
        continue
      }

      // Calculate overall similarity
      const overallSimilarity = this.calculateOverallSimilarity(text, referenceContent)

      if (overallSimilarity >= this.SIMILARITY_THRESHOLD * 0.5) { // Lower threshold for initial screening
        const matchedSegments: string[] = []

        // Find specific matching segments
        for (const segment of textSegments) {
          const segmentSimilarity = this.calculateOverallSimilarity(segment.text, referenceContent)

          if (segmentSimilarity >= this.SIMILARITY_THRESHOLD) {
            matchedSegments.push(segment.text)
          }
        }

        if (matchedSegments.length > 0) {
          // Extract authors from database record
          const authors = [] // Would need to fetch from database properly

          sources.push({
            id: reference.id,
            title: reference.title,
            authors: authors,
            year: new Date().getFullYear(), // Would need to fetch from database
            venue: '', // Would need to fetch from database
            similarityScore: overallSimilarity,
            matchedText: matchedSegments,
            excerpt: referenceContent.substring(0, 200) + (referenceContent.length > 200 ? '...' : '')
          })
        }
      }
    }

    // Sort by similarity score (highest first)
    return sources.sort((a, b) => b.similarityScore - a.similarityScore)
  }

  /**
   * Perform plagiarism scan on publication content
   */
  public async scanPublication(
    publicationId: string,
    facultyId: string,
    content: string,
    options: {
      excludeSelfCitation?: boolean
      includeAbstractOnly?: boolean
      scanType?: 'quick' | 'thorough'
    } = {}
  ): Promise<PlagiarismResult> {
    const startTime = Date.now()
    const scanId = uuidv4()

    try {
      // Validate input
      if (!content || content.trim().length < this.MIN_TEXT_LENGTH) {
        throw new Error(`Text content must be at least ${this.MIN_TEXT_LENGTH} characters long`)
      }

      // Create scan record in database
      await prisma.plagiarismScan.create({
        data: {
          publicationId,
          facultyId,
          scanId,
          service: 'INTERNAL',
          status: 'SCANNING'
        }
      })

      // Get reference publications for comparison
      const referencePublications = await this.getReferencePublications(
        options.excludeSelfCitation ? facultyId : undefined,
        options.scanType === 'quick' ? 50 : 200
      )

      console.log(`Scanning publication ${publicationId} against ${referencePublications.length} reference publications`)

      // Analyze content against references
      const sources = await this.analyzeAgainstReferences(content, referencePublications)

      // Calculate overall scores
      const maxSimilarity = sources.length > 0 ? Math.max(...sources.map(s => s.similarityScore)) : 0
      const originalityScore = Math.max(0, 100 - (maxSimilarity * 100))
      const similarityPercentage = maxSimilarity * 100

      // Find suspicious phrases
      const textSegments = this.extractTextSegments(content)
      const referenceTexts = referencePublications.map(ref => ref.content)
      const suspiciousPhrases = this.findSuspiciousPhrases(textSegments, referenceTexts)

      const processingTime = Date.now() - startTime

      // Update scan record with results
      await prisma.plagiarismScan.update({
        where: { scanId },
        data: {
          status: 'COMPLETED',
          originalityScore,
          similarityPercentage,
          sources: sources.map(s => ({
            id: s.id,
            title: s.title,
            similarityScore: s.similarityScore,
            excerpt: s.excerpt
          }))
        }
      })

      const result: PlagiarismResult = {
        scanId,
        originalityScore,
        similarityPercentage,
        sources,
        status: 'COMPLETED',
        processingTime,
        totalWords: this.tokenizer.tokenize(content)?.length || 0,
        suspiciousPhrases
      }

      console.log(`Plagiarism scan completed for ${publicationId}: ${originalityScore.toFixed(2)}% originality`)
      return result

    } catch (error) {
      console.error(`Plagiarism scan failed for publication ${publicationId}:`, error)

      // Update scan record with error status
      try {
        await prisma.plagiarismScan.update({
          where: { scanId },
          data: {
            status: 'FAILED'
          }
        })
      } catch (dbError) {
        console.error('Failed to update scan status:', dbError)
      }

      throw error
    }
  }

  /**
   * Get scan status and results
   */
  public async getScanResults(scanId: string): Promise<PlagiarismResult | null> {
    try {
      const scan = await prisma.plagiarismScan.findUnique({
        where: { scanId },
        include: {
          publication: {
            select: {
              title: true,
              abstract: true
            }
          }
        }
      })

      if (!scan) {
        return null
      }

      const sources = (scan.sources as any)?.map((s: any) => ({
        ...s,
        authors: [], // Would need to fetch from database
        year: new Date().getFullYear(),
        venue: '',
        matchedText: []
      })) || []

      return {
        scanId,
        originalityScore: scan.originalityScore || 0,
        similarityPercentage: scan.similarityPercentage || 0,
        sources,
        status: scan.status as any,
        reportUrl: scan.reportUrl || undefined
      }
    } catch (error) {
      console.error('Error getting scan results:', error)
      return null
    }
  }

  /**
   * Get scan history for a faculty member
   */
  public async getFacultyScanHistory(facultyId: string, limit: number = 20): Promise<Array<{
    scanId: string
    publicationTitle: string
    originalityScore: number
    similarityPercentage: number
    status: string
    createdAt: Date
  }>> {
    try {
      const scans = await prisma.plagiarismScan.findMany({
        where: { facultyId },
        include: {
          publication: {
            select: {
              title: true
            }
          }
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: limit
      })

      return scans.map(scan => ({
        scanId: scan.scanId,
        publicationTitle: scan.publication?.title || 'Unknown Publication',
        originalityScore: scan.originalityScore || 0,
        similarityPercentage: scan.similarityPercentage || 0,
        status: scan.status,
        createdAt: scan.createdAt
      }))
    } catch (error) {
      console.error('Error getting faculty scan history:', error)
      return []
    }
  }

  /**
   * Get plagiarism statistics
   */
  public async getPlagiarismStats(facultyId?: string): Promise<{
    totalScans: number
    averageOriginalityScore: number
    highRiskCount: number
    mediumRiskCount: number
    lowRiskCount: number
  }> {
    try {
      const whereClause = facultyId ? { facultyId } : {}

      const scans = await prisma.plagiarismScan.findMany({
        where: {
          ...whereClause,
          status: 'COMPLETED',
          originalityScore: { not: null }
        },
        select: {
          originalityScore: true
        }
      })

      const totalScans = scans.length
      const averageOriginalityScore = totalScans > 0
        ? scans.reduce((sum, scan) => sum + (scan.originalityScore || 0), 0) / totalScans
        : 0

      const highRiskCount = scans.filter(scan => (scan.originalityScore || 0) < 60).length
      const mediumRiskCount = scans.filter(scan => {
        const score = scan.originalityScore || 0
        return score >= 60 && score < 80
      }).length
      const lowRiskCount = scans.filter(scan => (scan.originalityScore || 0) >= 80).length

      return {
        totalScans,
        averageOriginalityScore,
        highRiskCount,
        mediumRiskCount,
        lowRiskCount
      }
    } catch (error) {
      console.error('Error getting plagiarism stats:', error)
      return {
        totalScans: 0,
        averageOriginalityScore: 0,
        highRiskCount: 0,
        mediumRiskCount: 0,
        lowRiskCount: 0
      }
    }
  }
}