import * as XLSX from 'xlsx'
import { ReportMetrics, PublicationReportData } from './PublicationReportGenerator'
import { prisma } from '@/lib/database'

export interface ExcelExportData {
  reportData: ReportMetrics
  reportConfig: {
    universityName?: string
    reportType: 'summary' | 'detailed' | 'accreditation' | 'faculty_profile'
    includeCharts?: boolean
  }
  facultyList?: any[]
  publications?: any[]
}

export class ExcelExporter {
  private readonly universityName: string

  constructor() {
    this.universityName = process.env.UNIVERSITY_NAME || 'University Name'
  }

  /**
   * Generate Excel workbook with multiple worksheets
   */
  public async generateExcelWorkbook(
    exportData: ExcelExportData,
    filters: PublicationReportData
  ): Promise<Buffer> {
    const workbook = XLSX.utils.book_new()

    // Create worksheets
    await this.createSummaryWorksheet(workbook, exportData, filters)
    await this.createYearlyDataWorksheet(workbook, exportData)
    await this.createFacultyWorksheet(workbook, exportData)
    await this.createVenueWorksheet(workbook, exportData)
    await this.createDepartmentWorksheet(workbook, exportData)

    // Add detailed publications worksheet if data is available
    if (exportData.publications && exportData.publications.length > 0) {
      await this.createPublicationsWorksheet(workbook, exportData)
    }

    // Add accreditation-specific worksheets
    if (exportData.reportConfig.reportType === 'accreditation') {
      await this.createAccreditationWorksheet(workbook, exportData)
    }

    // Generate buffer
    const excelBuffer = XLSX.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx'
    })

    return excelBuffer
  }

  /**
   * Create summary dashboard worksheet
   */
  private async createSummaryWorksheet(
    workbook: XLSX.WorkBook,
    exportData: ExcelExportData,
    filters: PublicationReportData
  ): Promise<void> {
    const { reportData } = exportData
    const universityName = exportData.reportConfig.universityName || this.universityName

    // Summary data
    const summaryData = [
      [`${universityName} - Publication Summary Report`],
      [''],
      ['Report Generated:', new Date().toLocaleString()],
      ['Period:', `${filters.startYear || 'All'} - ${filters.endYear || 'Present'}`],
      ['Department:', filters.department || 'All Departments'],
      ['Report Type:', exportData.reportConfig.reportType.toUpperCase()],
      [''],
      ['Overall Metrics'],
      ['Total Publications:', reportData.totalPublications],
      ['Journal Publications:', reportData.journalPublications],
      ['Conference Publications:', reportData.conferencePublications],
      ['Average Publications per Year:', reportData.averagePerYear],
      ['Growth Rate:', `${reportData.growthRate}%`],
      [''],
      ['Publication Breakdown'],
      ['Journals:', reportData.journalPublications],
      ['Conferences:', reportData.conferencePublications],
      ['Journal Percentage:', reportData.totalPublications > 0
        ? `${Math.round((reportData.journalPublications / reportData.totalPublications) * 100)}%`
        : '0%'
      ],
      ['Conference Percentage:', reportData.totalPublications > 0
        ? `${Math.round((reportData.conferencePublications / reportData.totalPublications) * 100)}%`
        : '0%'
      ],
      [''],
      ['Faculty Statistics'],
      ['Total Faculty Members:', reportData.facultyStats.length],
      ['Average Publications per Faculty:', reportData.facultyStats.length > 0
        ? Math.round(reportData.totalPublications / reportData.facultyStats.length * 100) / 100
        : 0
      ],
      ['Top Performing Faculty:', reportData.facultyStats.slice(0, 5).map(f => f.name).join(', ')],
      [''],
      ['Top Venues'],
      ...reportData.topVenues.slice(0, 10).map(venue => [
        venue.name,
        `${venue.count} publications (${venue.type})`
      ])
    ]

    const summaryWorksheet = XLSX.utils.aoa_to_sheet(summaryData)

    // Apply formatting
    this.applyWorksheetFormatting(summaryWorksheet, summaryData)

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, summaryWorksheet, 'Summary Dashboard')
  }

  /**
   * Create yearly publication data worksheet
   */
  private async createYearlyDataWorksheet(
    workbook: XLSX.WorkBook,
    exportData: ExcelExportData
  ): Promise<void> {
    const { reportData } = exportData

    // Headers
    const headers = ['Year', 'Journal Publications', 'Conference Publications', 'Total Publications', 'Growth Rate']

    // Data rows
    const dataRows = reportData.yearlyData.map((yearData, index) => {
      let growthRate = 'N/A'
      if (index > 0) {
        const previousTotal = reportData.yearlyData[index - 1].total
        if (previousTotal > 0) {
          const rate = ((yearData.total - previousTotal) / previousTotal) * 100
          growthRate = `${Math.round(rate * 100) / 100}%`
        }
      }

      return [
        yearData.year,
        yearData.journals,
        yearData.conferences,
        yearData.total,
        growthRate
      ]
    })

    // Combine headers and data
    const yearlyData = [headers, ...dataRows]

    const yearlyWorksheet = XLSX.utils.aoa_to_sheet(yearlyData)

    // Apply formatting
    this.applyWorksheetFormatting(yearlyWorksheet, yearlyData, true)

    XLSX.utils.book_append_sheet(workbook, yearlyWorksheet, 'Yearly Publications')
  }

  /**
   * Create faculty statistics worksheet
   */
  private async createFacultyWorksheet(
    workbook: XLSX.WorkBook,
    exportData: ExcelExportData
  ): Promise<void> {
    const { reportData } = exportData

    // Headers
    const headers = [
      'Faculty Name',
      'Email',
      'Department',
      'Total Publications',
      'Journal Publications',
      'Conference Publications',
      'Average per Year',
      'Performance Level'
    ]

    // Data rows
    const dataRows = reportData.facultyStats.map(faculty => {
      const performanceLevel = faculty.totalPublications >= 10 ? 'HIGH' :
                              faculty.totalPublications >= 5 ? 'MEDIUM' : 'LOW'

      return [
        faculty.name,
        faculty.email,
        faculty.department,
        faculty.totalPublications,
        faculty.journalPublications,
        faculty.conferencePublications,
        Math.round(faculty.averagePerYear * 100) / 100,
        performanceLevel
      ]
    })

    // Combine headers and data
    const facultyData = [headers, ...dataRows]

    const facultyWorksheet = XLSX.utils.aoa_to_sheet(facultyData)

    // Apply formatting
    this.applyWorksheetFormatting(facultyWorksheet, facultyData, true)

    XLSX.utils.book_append_sheet(workbook, facultyWorksheet, 'Faculty Statistics')
  }

  /**
   * Create venue analysis worksheet
   */
  private async createVenueWorksheet(
    workbook: XLSX.WorkBook,
    exportData: ExcelExportData
  ): Promise<void> {
    const { reportData } = exportData

    // Headers
    const headers = ['Venue Name', 'Publication Count', 'Type', 'Percentage']

    // Data rows
    const totalPublications = reportData.totalPublications
    const dataRows = reportData.topVenues.map(venue => [
      venue.name,
      venue.count,
      venue.type,
      totalPublications > 0
        ? `${Math.round((venue.count / totalPublications) * 10000) / 100}%`
        : '0%'
    ])

    // Combine headers and data
    const venueData = [headers, ...dataRows]

    const venueWorksheet = XLSX.utils.aoa_to_sheet(venueData)

    // Apply formatting
    this.applyWorksheetFormatting(venueWorksheet, venueData, true)

    XLSX.utils.book_append_sheet(workbook, venueWorksheet, 'Venue Analysis')
  }

  /**
   * Create department breakdown worksheet
   */
  private async createDepartmentWorksheet(
    workbook: XLSX.WorkBook,
    exportData: ExcelExportData
  ): Promise<void> {
    const { reportData } = exportData

    // Headers
    const headers = [
      'Department',
      'Total Publications',
      'Faculty Count',
      'Average per Faculty',
      'Contribution to Total'
    ]

    // Data rows
    const totalPublications = reportData.totalPublications
    const dataRows = reportData.departmentBreakdown.map(dept => [
      dept.department,
      dept.totalPublications,
      dept.facultyCount,
      Math.round(dept.averagePerFaculty * 100) / 100,
      totalPublications > 0
        ? `${Math.round((dept.totalPublications / totalPublications) * 10000) / 100}%`
        : '0%'
    ])

    // Combine headers and data
    const departmentData = [headers, ...dataRows]

    const departmentWorksheet = XLSX.utils.aoa_to_sheet(departmentData)

    // Apply formatting
    this.applyWorksheetFormatting(departmentWorksheet, departmentData, true)

    XLSX.utils.book_append_sheet(workbook, departmentWorksheet, 'Department Breakdown')
  }

  /**
   * Create detailed publications worksheet
   */
  private async createPublicationsWorksheet(
    workbook: XLSX.WorkBook,
    exportData: ExcelExportData
  ): Promise<void> {
    const { publications } = exportData

    if (!publications || publications.length === 0) {
      return
    }

    // Headers
    const headers = [
      'Title',
      'Authors',
      'Year',
      'Type',
      'Venue',
      'Volume',
      'Issue',
      'Pages',
      'DOI',
      'URL',
      'Source',
      'Faculty Name'
    ]

    // Data rows
    const dataRows = publications.map(pub => [
      pub.title,
      Array.isArray(pub.authors) ? pub.authors.join('; ') : JSON.parse(pub.authors || '[]').join('; '),
      pub.year,
      pub.type,
      pub.venue,
      pub.volume || '',
      pub.issue || '',
      pub.pages || '',
      pub.doi || '',
      pub.url || '',
      pub.source,
      pub.faculty?.name || 'Unknown'
    ])

    // Combine headers and data
    const publicationsData = [headers, ...dataRows]

    const publicationsWorksheet = XLSX.utils.aoa_to_sheet(publicationsData)

    // Apply formatting
    this.applyWorksheetFormatting(publicationsWorksheet, publicationsData, true)

    XLSX.utils.book_append_sheet(workbook, publicationsWorksheet, 'Detailed Publications')
  }

  /**
   * Create accreditation-specific worksheet
   */
  private async createAccreditationWorksheet(
    workbook: XLSX.WorkBook,
    exportData: ExcelExportData
  ): Promise<void> {
    const { reportData } = exportData

    // Accreditation metrics data
    const accreditationData = [
      ['Accreditation Report Metrics'],
      [''],
      ['Publication Volume Metrics'],
      ['Total Publications (5 Years):', reportData.yearlyData.slice(-5).reduce((sum, y) => sum + y.total, 0)],
      ['Average per Year (5 Years):', Math.round(reportData.yearlyData.slice(-5).reduce((sum, y) => sum + y.total, 0) / Math.min(5, reportData.yearlyData.length) * 100) / 100],
      ['Target Publications per Year:', 10],
      ['Compliance Status:', reportData.averagePerYear >= 10 ? 'MEETS_TARGET' : 'BELOW_TARGET'],
      [''],
      ['Quality Metrics'],
      ['Journal Publication Ratio:', reportData.totalPublications > 0 ? `${Math.round((reportData.journalPublications / reportData.totalPublications) * 100)}%` : '0%'],
      ['Top Tier Venues:', reportData.topVenues.filter(v => v.count >= 3).length],
      ['Research Growth Rate:', `${reportData.growthRate}%`],
      [''],
      ['Faculty Engagement'],
      ['Total Faculty:', reportData.facultyStats.length],
      ['Active Faculty (>5 publications):', reportData.facultyStats.filter(f => f.totalPublications > 5).length],
      ['Faculty Participation Rate:', '100%'],
      [''],
      ['Accreditation Compliance Checklist'],
      ['Minimum Publications:', reportData.totalPublications >= 50 ? '✓ PASS' : '✗ FAIL'],
      ['Quality Venues:', reportData.topVenues.length >= 10 ? '✓ PASS' : '✗ FAIL'],
      ['Faculty Participation:', reportData.facultyStats.length >= 5 ? '✓ PASS' : '✗ FAIL'],
      ['Consistent Output:', reportData.growthRate >= 0 ? '✓ PASS' : '✗ FAIL'],
      ['Diversity of Venues:', reportData.topVenues.length >= 5 ? '✓ PASS' : '✗ FAIL']
    ]

    const accreditationWorksheet = XLSX.utils.aoa_to_sheet(accreditationData)

    // Apply formatting
    this.applyWorksheetFormatting(accreditationWorksheet, accreditationData)

    XLSX.utils.book_append_sheet(workbook, accreditationWorksheet, 'Accreditation Metrics')
  }

  /**
   * Apply formatting to worksheet
   */
  private applyWorksheetFormatting(
    worksheet: XLSX.WorkSheet,
    data: any[][],
    hasHeaders: boolean = false
  ): void {
    if (!worksheet || !data || data.length === 0) {
      return
    }

    const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1')

    // Set column widths
    for (let col = range.s.c; col <= range.e.c; col++) {
      let maxWidth = 0
      for (let row = 0; row < data.length; row++) {
        const cellValue = data[row][col]
        if (cellValue) {
          const cellLength = cellValue.toString().length
          maxWidth = Math.max(maxWidth, Math.min(cellLength + 2, 50))
        }
      }
      worksheet['!cols'] = worksheet['!cols'] || []
      worksheet['!cols'][col] = { width: Math.max(maxWidth, 15) }
    }

    // Apply header formatting if present
    if (hasHeaders && data.length > 0) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col })
        if (worksheet[cellAddress]) {
          worksheet[cellAddress].s = {
            font: { bold: true },
            fill: { fgColor: { rgb: 'E6F3FF' } },
            alignment: { horizontal: 'center' }
          }
        }
      }
    }

    // Apply border formatting to all cells
    for (let row = range.s.r; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: row, c: col })
        if (worksheet[cellAddress]) {
          worksheet[cellAddress].s = {
            ...worksheet[cellAddress].s,
            border: {
              top: { style: 'thin', color: { auto: 1 } },
              bottom: { style: 'thin', color: { auto: 1 } },
              left: { style: 'thin', color: { auto: 1 } },
              right: { style: 'thin', color: { auto: 1 } }
            }
          }
        }
      }
    }
  }

  /**
   * Generate filename for export
   */
  public generateFilename(
    reportType: string,
    filters: PublicationReportData
  ): string {
    const timestamp = new Date().toISOString().split('T')[0] // YYYY-MM-DD
    const department = filters.department ? `_${filters.department.replace(/[^a-zA-Z0-9]/g, '_')}` : ''
    const years = filters.startYear && filters.endYear ? `_${filters.startYear}-${filters.endYear}` : ''

    return `${this.universityName.replace(/[^a-zA-Z0-9]/g, '_')}_${reportType}${department}${years}_${timestamp}.xlsx`
  }
}