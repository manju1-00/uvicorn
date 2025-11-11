import { NextRequest, NextResponse } from 'next/server'
import { PlagiarismDetectionService } from '@/lib/plagiarism/PlagiarismDetectionService'
import { prisma } from '@/lib/database'
import { ValidationError, createErrorResponse } from '@/lib/error-handling/errorHandler'

interface ScanRequest {
  publicationId?: string
  title: string
  content: string
  facultyId?: string
  options?: {
    excludeSelfCitation?: boolean
    includeAbstractOnly?: boolean
    scanType?: 'quick' | 'thorough'
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ScanRequest = await request.json()

    // Validate required fields
    if (!body.title || typeof body.title !== 'string') {
      throw new ValidationError('Title is required and must be a string')
    }

    if (!body.content || typeof body.content !== 'string') {
      throw new ValidationError('Content is required and must be a string')
    }

    if (body.content.trim().length < 500) {
      throw new ValidationError('Content must be at least 500 characters long for meaningful plagiarism analysis')
    }

    // If publicationId provided, validate it exists and get facultyId
    let publicationId = body.publicationId
    let facultyId = body.facultyId

    if (publicationId) {
      const publication = await prisma.publication.findUnique({
        where: { id: publicationId },
        include: { faculty: true }
      })

      if (!publication) {
        throw new ValidationError(`Publication with ID ${publicationId} not found`)
      }

      facultyId = publication.facultyId
    } else if (!facultyId) {
      throw new ValidationError('Either publicationId or facultyId must be provided')
    }

    // Initialize plagiarism detection service
    const plagiarismService = new PlagiarismDetectionService()

    // Start the scan (this will take time, so we run it asynchronously)
    const scanPromise = plagiarismService.scanPublication(
      publicationId || '',
      facultyId,
      body.content,
      body.options
    )

    // For now, we'll wait for the result. In production, you might want to return immediately
    // and let the client poll for results
    const result = await scanPromise

    return NextResponse.json({
      success: true,
      data: {
        scanId: result.scanId,
        originalityScore: result.originalityScore,
        similarityPercentage: result.similarityPercentage,
        status: result.status,
        sources: result.sources,
        processingTime: result.processingTime,
        totalWords: result.totalWords,
        suspiciousPhrases: result.suspiciousPhrases?.slice(0, 10) || [], // Limit to top 10
        riskLevel: result.originalityScore >= 80 ? 'LOW' : result.originalityScore >= 60 ? 'MEDIUM' : 'HIGH'
      },
      message: `Plagiarism scan completed. Originality score: ${result.originalityScore.toFixed(2)}%`
    })

  } catch (error) {
    console.error('Plagiarism scan error:', error)

    if (error instanceof ValidationError) {
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
        message: 'Internal server error occurred during plagiarism scan',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      }),
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const facultyId = searchParams.get('facultyId')
    const limit = parseInt(searchParams.get('limit') || '20')

    if (!facultyId) {
      throw new ValidationError('facultyId parameter is required')
    }

    // Get scan history for the faculty member
    const plagiarismService = new PlagiarismDetectionService()
    const scanHistory = await plagiarismService.getFacultyScanHistory(facultyId, limit)

    // Get plagiarism statistics
    const stats = await plagiarismService.getPlagiarismStats(facultyId)

    return NextResponse.json({
      success: true,
      data: {
        scanHistory,
        stats
      }
    })

  } catch (error) {
    console.error('Plagiarism scan history error:', error)

    if (error instanceof ValidationError) {
      return NextResponse.json(
        createErrorResponse(error),
        { status: error.statusCode }
      )
    }

    return NextResponse.json(
      createErrorResponse({
        statusCode: 500,
        code: 'SERVER_ERROR' as any,
        message: 'Internal server error occurred while fetching scan history',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      }),
      { status: 500 }
    )
  }
}