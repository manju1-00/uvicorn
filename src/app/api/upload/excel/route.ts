import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { prisma } from '@/lib/database'
import { validateFacultyData, validateFileUpload } from '@/lib/validation/validation'
import { ValidationError, FileUploadError, createErrorResponse } from '@/lib/error-handling/errorHandler'

export async function POST(request: NextRequest) {
  try {
    // Parse form data
    const formData = await request.formData()
    const file = formData.get('faculty_data') as File

    if (!file) {
      throw new FileUploadError('No file provided. Expected field name: "faculty_data"')
    }

    // Validate file
    const fileValidation = validateFileUpload(
      file,
      ['.xlsx', '.xls', '.csv'],
      parseInt(process.env.MAX_FILE_SIZE || '10485760') // 10MB default
    )

    if (!fileValidation.isValid) {
      throw new FileUploadError(fileValidation.errors.join('; '))
    }

    // Read file buffer
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'buffer' })

    // Get first worksheet
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      throw new ValidationError('Excel file contains no worksheets')
    }

    const worksheet = workbook.Sheets[sheetName]

    // Convert to JSON with header mapping
    const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

    if (rawData.length < 2) {
      throw new ValidationError('Excel file must contain at least a header row and one data row')
    }

    // Extract headers
    const headers = rawData[0] as string[]
    const dataRows = rawData.slice(1) as any[]

    // Normalize headers to match expected format
    const normalizedHeaders = headers.map(header =>
      header?.toString().toLowerCase().replace(/[^a-z0-9]/g, '')
    )

    // Find column indices
    const getColumnIndex = (possibleNames: string[]): number => {
      return possibleNames.reduce((foundIndex, name) => {
        const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '')
        const index = normalizedHeaders.indexOf(normalizedName)
        return index !== -1 ? index : foundIndex
      }, -1)
    }

    const facultyNameIndex = getColumnIndex(['facultyname', 'faculty_name', 'name'])
    const emailIndex = getColumnIndex(['email'])
    const departmentIndex = getColumnIndex(['department', 'dept'])

    // Validate required columns exist
    const missingColumns = []
    if (facultyNameIndex === -1) missingColumns.push('Faculty Name')
    if (emailIndex === -1) missingColumns.push('Email')
    if (departmentIndex === -1) missingColumns.push('Department')

    if (missingColumns.length > 0) {
      throw new ValidationError(
        `Missing required columns: ${missingColumns.join(', ')}. ` +
        'Expected columns: Faculty Name, Email, Department'
      )
    }

    // Convert rows to faculty data format
    const facultyData = dataRows
      .filter(row => row && row.length > 0) // Remove empty rows
      .map(row => ({
        facultyName: row[facultyNameIndex]?.toString()?.trim() || '',
        email: row[emailIndex]?.toString()?.trim() || '',
        department: row[departmentIndex]?.toString()?.trim() || ''
      }))
      .filter(faculty => faculty.facultyName && faculty.email && faculty.department) // Remove rows with empty required fields

    if (facultyData.length === 0) {
      throw new ValidationError('No valid faculty data found in the Excel file')
    }

    // Validate faculty data
    const validation = validateFacultyData(facultyData)

    if (!validation.isValid) {
      throw new ValidationError(validation.errors.join('; '))
    }

    // Save to database (avoid duplicates by email)
    const savedFaculty = []
    const duplicateEmails = []

    for (const faculty of validation.data!) {
      try {
        const existingFaculty = await prisma.faculty.findUnique({
          where: { email: faculty.email }
        })

        if (existingFaculty) {
          duplicateEmails.push(faculty.email)
          continue
        }

        const saved = await prisma.faculty.create({
          data: {
            name: faculty.facultyName,
            email: faculty.email,
            department: faculty.department
          }
        })

        savedFaculty.push(saved)
      } catch (error) {
        console.error(`Error saving faculty ${faculty.email}:`, error)
        // Continue with other faculty records
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        uploaded: savedFaculty.map(f => ({
          facultyName: f.name,
          email: f.email,
          department: f.department
        })),
        duplicates: duplicateEmails,
        totalRecords: dataRows.length,
        validRecords: validation.data!.length,
        savedRecords: savedFaculty.length
      },
      message: `Successfully processed ${savedFaculty.length} faculty records. ` +
               (duplicateEmails.length > 0 ? `${duplicateEmails.length} duplicate emails skipped.` : '')
    })

  } catch (error) {
    console.error('Excel upload error:', error)

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
          message: 'Database error occurred while saving faculty data',
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
        message: 'Internal server error occurred while processing Excel file',
        details: { error: error instanceof Error ? error.message : 'Unknown error' }
      }),
      { status: 500 }
    )
  }
}