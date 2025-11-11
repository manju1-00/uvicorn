import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/database'
import { validateFileUpload } from '@/lib/validation/validation'
import { FileUploadError, ValidationError, createErrorResponse } from '@/lib/error-handling/errorHandler'
import { v4 as uuidv4 } from 'uuid'

// Simple BibTeX parser (basic implementation)
interface BibTeXEntry {
  type: string
  key: string
  fields: Record<string, string>
}

function parseBibTeX(content: string): BibTeXEntry[] {
  const entries: BibTeXEntry[] = []
  const lines = content.split('\n')
  let currentEntry: Partial<BibTeXEntry> | null = null
  let inEntry = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Skip empty lines and comments
    if (!line || line.startsWith('%')) {
      continue
    }

    // Start of entry
    if (line.startsWith('@')) {
      const match = line.match(/@(\w+)\s*\{\s*([^,]+)\s*,?\s*$/)
      if (match) {
        // Save previous entry if exists
        if (currentEntry && currentEntry.type && currentEntry.key && currentEntry.fields) {
          entries.push(currentEntry as BibTeXEntry)
        }

        // Start new entry
        currentEntry = {
          type: match[1].toLowerCase(),
          key: match[2],
          fields: {}
        }
        inEntry = true
      }
      continue
    }

    // End of entry
    if (line === '}' && inEntry && currentEntry) {
      if (currentEntry.type && currentEntry.key && currentEntry.fields) {
        entries.push(currentEntry as BibTeXEntry)
      }
      currentEntry = null
      inEntry = false
      continue
    }

    // Field line
    if (inEntry && currentEntry && line.includes('=')) {
      const fieldMatch = line.match(/^\s*(\w+)\s*=\s*["'{](.+?)["'}]\s*,?\s*$/)
      if (fieldMatch) {
        const fieldName = fieldMatch[1].toLowerCase()
        let fieldValue = fieldMatch[2]

        // Clean up field value
        fieldValue = fieldValue.replace(/\s+/g, ' ').trim()

        // Handle multiple authors separated by ' and '
        if (fieldName === 'author') {
          fieldValue = fieldValue.replace(/\s+and\s+/g, ' and ')
        }

        currentEntry.fields![fieldName] = fieldValue
      }
    }
  }

  // Save last entry if file doesn't end with }
  if (currentEntry && currentEntry.type && currentEntry.key && currentEntry.fields) {
    entries.push(currentEntry as BibTeXEntry)
  }

  return entries
}

function categorizePublication(entry: BibTeXEntry): 'JOURNAL' | 'CONFERENCE' {
  const type = entry.type.toLowerCase()

  if (type === 'article') {
    return 'JOURNAL'
  }

  if (type === 'inproceedings' || type === 'conference' || type === 'proceedings') {
    return 'CONFERENCE'
  }

  // Default categorization based on venue name
  const venue = entry.fields.booktitle || entry.fields.journal || ''
  if (venue.toLowerCase().includes('conference') ||
      venue.toLowerCase().includes('proceedings') ||
      venue.toLowerCase().includes('workshop')) {
    return 'CONFERENCE'
  }

  return 'JOURNAL' // Default to journal
}

export async function POST(request: NextRequest) {
  try {
    // Parse form data
    const formData = await request.formData()
    const file = formData.get('bibtex_file') as File
    const facultyId = formData.get('faculty_id') as string

    if (!file) {
      throw new FileUploadError('No file provided. Expected field name: "bibtex_file"')
    }

    // Validate file
    const fileValidation = validateFileUpload(
      file,
      ['.bib'],
      parseInt(process.env.MAX_FILE_SIZE || '5242880') // 5MB default for BibTeX
    )

    if (!fileValidation.isValid) {
      throw new FileUploadError(fileValidation.errors.join('; '))
    }

    // Read file content
    const content = await file.text()

    if (!content.trim()) {
      throw new ValidationError('BibTeX file is empty')
    }

    // Parse BibTeX entries
    const bibtexEntries = parseBibTeX(content)

    if (bibtexEntries.length === 0) {
      throw new ValidationError('No valid BibTeX entries found in the file')
    }

    // If faculty_id provided, validate it exists
    let faculty = null
    if (facultyId) {
      faculty = await prisma.faculty.findUnique({
        where: { id: facultyId }
      })

      if (!faculty) {
        throw new ValidationError(`Faculty with ID ${facultyId} not found`)
      }
    }

    // Convert BibTeX entries to publication format
    const publications = bibtexEntries.map(entry => {
      const authors = entry.fields.author ? entry.fields.author.split(' and ').map(a => a.trim()) : []
      const year = parseInt(entry.fields.year) || new Date().getFullYear()
      const type = categorizePublication(entry)
      const venue = entry.fields.booktitle || entry.fields.journal || ''

      return {
        title: entry.fields.title || '',
        authors: JSON.stringify(authors),
        year,
        type,
        venue,
        volume: entry.fields.volume,
        issue: entry.fields.number || entry.fields.issue,
        pages: entry.fields.pages,
        doi: entry.fields.doi,
        url: entry.fields.url,
        abstract: entry.fields.abstract,
        source: 'MANUAL' as const,
        facultyId: facultyId || null
      }
    })

    // Save publications to database
    const savedPublications = []
    const skippedPublications = []

    for (const pub of publications) {
      try {
        // Skip if missing required fields
        if (!pub.title || !pub.venue || !pub.facultyId) {
          skippedPublications.push({
            title: pub.title || 'Untitled',
            reason: 'Missing required fields (title, venue, or faculty_id)'
          })
          continue
        }

        // Check for duplicates by title and year
        const existingPub = await prisma.publication.findFirst({
          where: {
            title: pub.title,
            year: pub.year,
            facultyId: pub.facultyId
          }
        })

        if (existingPub) {
          skippedPublications.push({
            title: pub.title,
            reason: 'Duplicate publication already exists'
          })
          continue
        }

        const saved = await prisma.publication.create({
          data: pub
        })

        savedPublications.push(saved)
      } catch (error) {
        console.error(`Error saving publication ${pub.title}:`, error)
        skippedPublications.push({
          title: pub.title,
          reason: 'Database error occurred'
        })
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        uploaded: savedPublications.map(p => ({
          id: p.id,
          title: p.title,
          authors: JSON.parse(p.authors),
          year: p.year,
          type: p.type,
          venue: p.venue
        })),
        skipped: skippedPublications,
        totalEntries: bibtexEntries.length,
        validPublications: publications.length,
        savedPublications: savedPublications.length
      },
      message: `Successfully processed ${savedPublications.length} publications. ` +
               (skippedPublications.length > 0 ? `${skippedPublications.length} entries skipped.` : '')
    })

  } catch (error) {
    console.error('BibTeX upload error:', error)

    if (error instanceof FileUploadError || error instanceof ValidationError) {
      return NextResponse.json(
        createErrorResponse(error),
        { status: error.statusCode }
      )
    }

    // Handle database errors
    if (error instanceof Error && error.message.includes('Prisma')) {
      return NextResponse.json(
        createErrorResponse({
          statusCode: 500,
          code: 'DATABASE_ERROR' as any,
          message: 'Database error occurred while saving publications',
          details: { error: error.message }
        }),
        { status: 500 }
      )
    }

    // Generic server error
    return NextResponse.json(
      createErrorResponse({
        statusCode: 500,
        code: 'SERVER_ERROR' as any,
        message: 'Internal server error occurred while processing BibTeX file',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      }),
      { status: 500 }
    )
  }
}