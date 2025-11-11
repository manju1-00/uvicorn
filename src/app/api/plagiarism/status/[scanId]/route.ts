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
      throw new NotFoundError('Plagiarism scan')
    }

    return NextResponse.json({
      success: true,
      data: {
        scanId: scanResults.scanId,
        status: scanResults.status,
        originalityScore: scanResults.originalityScore,
        similarityPercentage: scanResults.similarityPercentage,
        processingTime: scanResults.processingTime,
        totalWords: scanResults.totalWords,
        riskLevel: scanResults.originalityScore >= 80 ? 'LOW' :
                   scanResults.originalityScore >= 60 ? 'MEDIUM' : 'HIGH',
        totalSources: scanResults.sources.length,
        hasResults: scanResults.sources.length > 0
      }
    })

  } catch (error) {
    console.error('Plagiarism scan status error:', error)

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
        message: 'Internal server error occurred while fetching scan status',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      }),
      { status: 500 }
    )
  }
}