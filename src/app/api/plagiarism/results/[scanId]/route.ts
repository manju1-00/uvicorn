import { NextRequest, NextResponse } from 'next/server'
import { PlagiarismDetectionService } from '@/lib/plagiarism/PlagiarismDetectionService'
import { ValidationError, NotFoundError, createErrorResponse } from '@/lib/error-handling/errorHandler'

export async function GET(
  request: NextRequest,
  { params }: { params: { scanId: string } }
) {
  try {
    const { scanId } = params

    if (!scanId) {
      throw new ValidationError('scanId is required')
    }

    const plagiarismService = new PlagiarismDetectionService()
    const scanResults = await plagiarismService.getScanResults(scanId)

    if (!scanResults) {
      throw new NotFoundError('Plagiarism scan results')
    }

    // Group sources by similarity ranges
    const highRiskSources = scanResults.sources.filter(s => s.similarityScore >= 0.9)
    const mediumRiskSources = scanResults.sources.filter(s => s.similarityScore >= 0.7 && s.similarityScore < 0.9)
    const lowRiskSources = scanResults.sources.filter(s => s.similarityScore >= 0.5 && s.similarityScore < 0.7)

    return NextResponse.json({
      success: true,
      data: {
        scanId: scanResults.scanId,
        originalityScore: scanResults.originalityScore,
        similarityPercentage: scanResults.similarityPercentage,
        status: scanResults.status,
        processingTime: scanResults.processingTime,
        totalWords: scanResults.totalWords,
        suspiciousPhrases: scanResults.suspiciousPhrases || [],
        riskLevel: scanResults.originalityScore >= 80 ? 'LOW' :
                   scanResults.originalityScore >= 60 ? 'MEDIUM' : 'HIGH',
        sources: {
          total: scanResults.sources.length,
          highRisk: highRiskSources.length,
          mediumRisk: mediumRiskSources.length,
          lowRisk: lowRiskSources.length,
          details: scanResults.sources.map(source => ({
            id: source.id,
            title: source.title,
            authors: source.authors,
            year: source.year,
            venue: source.venue,
            similarityScore: Math.round(source.similarityScore * 100),
            matchedText: source.matchedText.slice(0, 5), // Limit to top 5 matches
            excerpt: source.excerpt,
            url: source.url
          }))
        },
        summary: {
          totalMatches: scanResults.sources.length,
          averageSimilarity: scanResults.sources.length > 0
            ? Math.round((scanResults.sources.reduce((sum, s) => sum + s.similarityScore, 0) / scanResults.sources.length) * 100)
            : 0,
          highestSimilarity: scanResults.sources.length > 0
            ? Math.round(Math.max(...scanResults.sources.map(s => s.similarityScore)) * 100)
            : 0
        },
        recommendations: generateRecommendations(scanResults.originalityScore, scanResults.sources.length)
      }
    })

  } catch (error) {
    console.error('Plagiarism scan results error:', error)

    if (error instanceof ValidationError || error instanceof NotFoundError) {
      return NextResponse.json(
        createErrorResponse(error),
        { status: error.statusCode }
      )
    }

    return NextResponse.json(
      createErrorResponse({
        statusCode: 500,
        code: 'SERVER_ERROR' as any,
        message: 'Internal server error occurred while fetching scan results',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      }),
      { status: 500 }
    )
  }
}

function generateRecommendations(originalityScore: number, sourceCount: number): string[] {
  const recommendations: string[] = []

  if (originalityScore >= 80) {
    recommendations.push('Originality score is excellent. No significant concerns detected.')
    recommendations.push('Publication appears to be original work.')
  } else if (originalityScore >= 60) {
    recommendations.push('Originality score is acceptable but requires review.')
    recommendations.push('Review flagged sources for proper citation.')
    recommendations.push('Consider paraphrasing or adding attribution where needed.')
  } else {
    recommendations.push('Originality score is concerning. Immediate review required.')
    recommendations.push('Carefully review all sources and ensure proper citation.')
    recommendations.push('Consider significant revision before submission.')
  }

  if (sourceCount > 10) {
    recommendations.push('High number of potential sources detected. Thorough review recommended.')
  }

  if (sourceCount > 0 && sourceCount <= 3) {
    recommendations.push('Few potential matches found. Likely minor citation issues.')
  }

  recommendations.push('Consider using citation management software for future publications.')
  recommendations.push('Always double-check citations and references before submission.')

  return recommendations
}