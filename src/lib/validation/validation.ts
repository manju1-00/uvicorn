// Faculty data validation
export interface FacultyData {
  facultyName: string
  email: string
  department: string
}

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  data?: FacultyData[]
}

export function validateFacultyData(data: any[]): ValidationResult {
  const errors: string[] = []
  const validFacultyData: FacultyData[] = []

  if (!Array.isArray(data)) {
    errors.push('Data must be an array')
    return { isValid: false, errors }
  }

  data.forEach((row, index) => {
    const rowErrors: string[] = []

    // Faculty name validation
    if (!row.facultyName || typeof row.facultyName !== 'string') {
      rowErrors.push(`Row ${index + 1}: Faculty name is required and must be a string`)
    } else if (row.facultyName.trim().length < 2) {
      rowErrors.push(`Row ${index + 1}: Faculty name must be at least 2 characters`)
    } else if (row.facultyName.trim().length > 100) {
      rowErrors.push(`Row ${index + 1}: Faculty name must be less than 100 characters`)
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!row.email || typeof row.email !== 'string') {
      rowErrors.push(`Row ${index + 1}: Email is required and must be a string`)
    } else if (!emailRegex.test(row.email.trim())) {
      rowErrors.push(`Row ${index + 1}: Invalid email format`)
    }

    // Department validation
    if (!row.department || typeof row.department !== 'string') {
      rowErrors.push(`Row ${index + 1}: Department is required and must be a string`)
    } else if (row.department.trim().length < 2) {
      rowErrors.push(`Row ${index + 1}: Department must be at least 2 characters`)
    }

    // If row is valid, add to valid data
    if (rowErrors.length === 0) {
      validFacultyData.push({
        facultyName: row.facultyName.trim(),
        email: row.email.trim().toLowerCase(),
        department: row.department.trim()
      })
    } else {
      errors.push(...rowErrors)
    }
  })

  return {
    isValid: errors.length === 0 && validFacultyData.length > 0,
    errors,
    data: validFacultyData
  }
}

// Publication data validation
export interface PublicationData {
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
  facultyId: string
}

export function validatePublicationData(data: any): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  // Title validation
  if (!data.title || typeof data.title !== 'string') {
    errors.push('Title is required and must be a string')
  } else if (data.title.trim().length < 5) {
    errors.push('Title must be at least 5 characters')
  } else if (data.title.trim().length > 500) {
    errors.push('Title must be less than 500 characters')
  }

  // Year validation
  const currentYear = new Date().getFullYear() + 1
  if (!data.year || typeof data.year !== 'number') {
    errors.push('Year is required and must be a number')
  } else if (data.year < 1900 || data.year > currentYear) {
    errors.push(`Year must be between 1900 and ${currentYear}`)
  }

  // Authors validation
  if (!data.authors || !Array.isArray(data.authors)) {
    errors.push('Authors is required and must be an array')
  } else if (data.authors.length === 0) {
    errors.push('At least one author is required')
  } else if (data.authors.some((author: any) => typeof author !== 'string' || author.trim().length < 2)) {
    errors.push('All authors must be strings with at least 2 characters')
  }

  // Venue validation
  if (!data.venue || typeof data.venue !== 'string') {
    errors.push('Venue is required and must be a string')
  } else if (data.venue.trim().length < 3) {
    errors.push('Venue must be at least 3 characters')
  }

  // DOI validation (optional)
  if (data.doi && typeof data.doi === 'string') {
    const doiRegex = /^10\.\d+\/.+/
    if (!doiRegex.test(data.doi.trim())) {
      errors.push('Invalid DOI format')
    }
  }

  // Type validation
  if (!data.type || !['JOURNAL', 'CONFERENCE'].includes(data.type)) {
    errors.push('Type must be either JOURNAL or CONFERENCE')
  }

  // Source validation
  if (!data.source || !['DBLP', 'GOOGLE_SCHOLAR', 'OPENALEX', 'MANUAL'].includes(data.source)) {
    errors.push('Source must be one of: DBLP, GOOGLE_SCHOLAR, OPENALEX, MANUAL')
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}

// File upload validation
export function validateFileUpload(
  file: File,
  allowedTypes: string[],
  maxSizeBytes: number
): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!file) {
    errors.push('No file provided')
    return { isValid: false, errors }
  }

  // File type validation
  const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()
  if (!allowedTypes.includes(fileExtension)) {
    errors.push(`File type ${fileExtension} is not allowed. Allowed types: ${allowedTypes.join(', ')}`)
  }

  // File size validation
  if (file.size > maxSizeBytes) {
    const maxSizeMB = maxSizeBytes / (1024 * 1024)
    errors.push(`File size ${file.size} bytes exceeds maximum allowed size of ${maxSizeMB}MB`)
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}