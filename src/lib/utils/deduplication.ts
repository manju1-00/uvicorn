import { LevenshteinDistance } from 'natural'

export interface Publication {
  id?: string
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
  source: 'DBLP' | 'GOOGLE_SCHOLAR' | 'OPENALEX' | 'MANUAL'
}

export interface DuplicateGroup {
  publications: Publication[]
  canonicalPublication: Publication
  similarityScore: number
  matchReason: 'title' | 'doi' | 'title_authors' | 'exact'
}

export class PublicationDeduplicator {
  private readonly TITLE_SIMILARITY_THRESHOLD = 0.9
  private readonly AUTHOR_MATCH_THRESHOLD = 0.7

  /**
   * Calculate similarity between two strings using Levenshtein distance
   */
  private calculateStringSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) {
      return 0
    }

    const normalizedStr1 = str1.toLowerCase().trim()
    const normalizedStr2 = str2.toLowerCase().trim()

    if (normalizedStr1 === normalizedStr2) {
      return 1.0
    }

    const distance = LevenshteinDistance(normalizedStr1, normalizedStr2)
    const maxLength = Math.max(normalizedStr1.length, normalizedStr2.length)

    if (maxLength === 0) {
      return 1.0
    }

    return 1 - (distance / maxLength)
  }

  /**
   * Normalize author lists for comparison
   */
  private normalizeAuthors(authors: string[]): string[] {
    if (!authors || authors.length === 0) {
      return []
    }

    return authors
      .map(author => author.toLowerCase().trim())
      .filter(author => author.length > 0)
      .sort() // Sort to handle order differences
  }

  /**
   * Calculate author list similarity
   */
  private calculateAuthorSimilarity(authors1: string[], authors2: string[]): number {
    const normalized1 = this.normalizeAuthors(authors1)
    const normalized2 = this.normalizeAuthors(authors2)

    if (normalized1.length === 0 && normalized2.length === 0) {
      return 1.0
    }

    if (normalized1.length === 0 || normalized2.length === 0) {
      return 0.0
    }

    // Calculate intersection
    const intersection = normalized1.filter(author => normalized2.includes(author))
    const union = [...new Set([...normalized1, ...normalized2])]

    if (union.length === 0) {
      return 1.0
    }

    return intersection.length / union.length
  }

  /**
   * Normalize title for comparison
   */
  private normalizeTitle(title: string): string {
    if (!title) {
      return ''
    }

    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove special characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
  }

  /**
   * Check if two publications are exact matches (same DOI)
   */
  private isExactMatch(pub1: Publication, pub2: Publication): boolean {
    if (pub1.doi && pub2.doi) {
      return pub1.doi.toLowerCase() === pub2.doi.toLowerCase()
    }
    return false
  }

  /**
   * Check if two publications are title matches
   */
  private isTitleMatch(pub1: Publication, pub2: Publication): boolean {
    const similarity = this.calculateStringSimilarity(pub1.title, pub2.title)
    return similarity >= this.TITLE_SIMILARITY_THRESHOLD
  }

  /**
   * Check if two publications are title + authors matches
   */
  private isTitleAuthorsMatch(pub1: Publication, pub2: Publication): boolean {
    const titleSimilarity = this.calculateStringSimilarity(pub1.title, pub2.title)
    const authorSimilarity = this.calculateAuthorSimilarity(pub1.authors, pub2.authors)

    return (
      titleSimilarity >= 0.8 && // Slightly lower threshold for title when combined with authors
      authorSimilarity >= this.AUTHOR_MATCH_THRESHOLD
    )
  }

  /**
   * Determine if two publications are duplicates
   */
  private areDuplicates(pub1: Publication, pub2: Publication): { isDuplicate: boolean; reason: 'title' | 'doi' | 'title_authors' | 'exact'; similarityScore: number } {
    // Check for exact DOI match first
    if (this.isExactMatch(pub1, pub2)) {
      return { isDuplicate: true, reason: 'exact', similarityScore: 1.0 }
    }

    // Check for high title similarity
    if (this.isTitleMatch(pub1, pub2)) {
      const similarity = this.calculateStringSimilarity(pub1.title, pub2.title)
      return { isDuplicate: true, reason: 'title', similarityScore: similarity }
    }

    // Check for title + author match
    if (this.isTitleAuthorsMatch(pub1, pub2)) {
      const titleSimilarity = this.calculateStringSimilarity(pub1.title, pub2.title)
      const authorSimilarity = this.calculateAuthorSimilarity(pub1.authors, pub2.authors)
      const combinedSimilarity = (titleSimilarity + authorSimilarity) / 2
      return { isDuplicate: true, reason: 'title_authors', similarityScore: combinedSimilarity }
    }

    return { isDuplicate: false, reason: 'title', similarityScore: 0 }
  }

  /**
   * Select the best publication from a duplicate group as canonical
   */
  private selectCanonicalPublication(publications: Publication[]): Publication {
    if (publications.length === 1) {
      return publications[0]
    }

    // Priority scoring for selecting canonical publication
    let bestPublication = publications[0]
    let bestScore = 0

    for (const pub of publications) {
      let score = 0

      // Prefer publications with DOI
      if (pub.doi) {
        score += 10
      }

      // Prefer publications with abstract
      if (pub.abstract && pub.abstract.length > 50) {
        score += 5
      }

      // Prefer publications with volume/issue info
      if (pub.volume) {
        score += 2
      }
      if (pub.issue) {
        score += 2
      }

      // Prefer publications with URL
      if (pub.url) {
        score += 1
      }

      // Prefer certain sources (in order of reliability)
      const sourceScores = {
        'DBLP': 3,
        'OPENALEX': 2,
        'GOOGLE_SCHOLAR': 1,
        'MANUAL': 4
      }
      score += sourceScores[pub.source] || 0

      if (score > bestScore) {
        bestScore = score
        bestPublication = pub
      }
    }

    return bestPublication
  }

  /**
   * Merge duplicate publications
   */
  private mergeDuplicateGroup(group: DuplicateGroup): Publication {
    const canonical = group.canonicalPublication

    // Merge information from all duplicates
    for (const pub of group.publications) {
      if (pub === canonical) {
        continue
      }

      // Add missing DOI
      if (!canonical.doi && pub.doi) {
        canonical.doi = pub.doi
      }

      // Add missing abstract
      if (!canonical.abstract && pub.abstract) {
        canonical.abstract = pub.abstract
      }

      // Add missing volume/issue
      if (!canonical.volume && pub.volume) {
        canonical.volume = pub.volume
      }
      if (!canonical.issue && pub.issue) {
        canonical.issue = pub.issue
      }

      // Add missing pages
      if (!canonical.pages && pub.pages) {
        canonical.pages = pub.pages
      }

      // Add missing URL
      if (!canonical.url && pub.url) {
        canonical.url = pub.url
      }
    }

    return canonical
  }

  /**
   * Find and group duplicate publications
   */
  public findDuplicates(publications: Publication[]): DuplicateGroup[] {
    const duplicateGroups: DuplicateGroup[] = []
    const processed = new Set<number>()

    for (let i = 0; i < publications.length; i++) {
      if (processed.has(i)) {
        continue
      }

      const currentPub = publications[i]
      const duplicateGroup: Publication[] = [currentPub]
      let bestMatchReason: 'title' | 'doi' | 'title_authors' | 'exact' = 'title'
      let highestSimilarity = 0

      for (let j = i + 1; j < publications.length; j++) {
        if (processed.has(j)) {
          continue
        }

        const otherPub = publications[j]
        const { isDuplicate, reason, similarityScore } = this.areDuplicates(currentPub, otherPub)

        if (isDuplicate) {
          duplicateGroup.push(otherPub)
          processed.add(j)

          if (similarityScore > highestSimilarity) {
            highestSimilarity = similarityScore
            bestMatchReason = reason
          }
        }
      }

      processed.add(i)

      // Only create a group if there are duplicates
      if (duplicateGroup.length > 1) {
        const canonical = this.selectCanonicalPublication(duplicateGroup)

        duplicateGroups.push({
          publications: duplicateGroup,
          canonicalPublication: canonical,
          similarityScore: highestSimilarity,
          matchReason: bestMatchReason
        })
      }
    }

    return duplicateGroups
  }

  /**
   * Deduplicate publications and return unique set with merged information
   */
  public deduplicate(publications: Publication[]): { uniquePublications: Publication[]; duplicateGroups: DuplicateGroup[]; stats: { total: number; duplicates: number; unique: number } } {
    const duplicateGroups = this.findDuplicates(publications)
    const duplicateIds = new Set<string>()

    // Collect all IDs of duplicates
    for (const group of duplicateGroups) {
      for (const pub of group.publications) {
        if (pub.id) {
          duplicateIds.add(pub.id)
        }
      }
    }

    // Merge duplicate groups
    const mergedPublications = duplicateGroups.map(group =>
      this.mergeDuplicateGroup(group)
    )

    // Find non-duplicate publications
    const nonDuplicatePublications = publications.filter(pub =>
      !pub.id || !duplicateIds.has(pub.id)
    )

    // Combine merged duplicates with non-duplicates
    const uniquePublications = [...nonDuplicatePublications, ...mergedPublications]

    const stats = {
      total: publications.length,
      duplicates: publications.length - uniquePublications.length,
      unique: uniquePublications.length
    }

    return {
      uniquePublications,
      duplicateGroups,
      stats
    }
  }

  /**
   * Get deduplication statistics
   */
  public getDeduplicationStats(duplicateGroups: DuplicateGroup[]): {
    totalDuplicates: number;
    duplicateGroups: number;
    averageGroupSize: number;
    matchReasons: Record<string, number>;
  } {
    if (duplicateGroups.length === 0) {
      return {
        totalDuplicates: 0,
        duplicateGroups: 0,
        averageGroupSize: 0,
        matchReasons: {}
      }
    }

    const totalDuplicates = duplicateGroups.reduce((sum, group) => sum + group.publications.length, 0)
    const averageGroupSize = totalDuplicates / duplicateGroups.length

    const matchReasons: Record<string, number> = {}
    for (const group of duplicateGroups) {
      matchReasons[group.matchReason] = (matchReasons[group.matchReason] || 0) + 1
    }

    return {
      totalDuplicates,
      duplicateGroups: duplicateGroups.length,
      averageGroupSize,
      matchReasons
    }
  }
}