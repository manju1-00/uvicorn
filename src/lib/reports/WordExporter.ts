import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle } from 'docx'
import { ReportMetrics, PublicationReportData } from './PublicationReportGenerator'

export interface WordExportData {
  reportData: ReportMetrics
  reportConfig: {
    universityName?: string
    reportType: 'summary' | 'detailed' | 'accreditation' | 'faculty_profile'
  }
  publications?: any[]
}

export class WordExporter {
  private readonly universityName: string

  constructor() {
    this.universityName = process.env.UNIVERSITY_NAME || 'University Name'
  }

  /**
   * Generate Word document
   */
  public async generateWordDocument(
    exportData: WordExportData,
    filters: PublicationReportData
  ): Promise<Buffer> {
    const universityName = exportData.reportConfig.universityName || this.universityName
    const reportType = exportData.reportConfig.reportType

    // Create document sections
    const titleSection = this.createTitleSection(universityName, reportType, filters)
    const executiveSummary = this.createExecutiveSummary(exportData.reportData)
    const metricsSection = this.createMetricsSection(exportData.reportData)
    const facultySection = this.createFacultySection(exportData.reportData)
    const yearlySection = this.createYearlySection(exportData.reportData)
    const venueSection = this.createVenueSection(exportData.reportData)

    // Add sections based on report type
    const sections = [
      titleSection,
      executiveSummary,
      metricsSection,
      facultySection,
      yearlySection,
      venueSection
    ]

    if (reportType === 'accreditation') {
      sections.push(this.createAccreditationSection(exportData.reportData))
    }

    if (reportType === 'detailed' && exportData.publications) {
      sections.push(this.createDetailedPublicationsSection(exportData.publications))
    }

    // Create document
    const doc = new Document({
      sections: [{
        properties: {},
        children: sections
      }]
    })

    // Generate buffer
    const buffer = await Packer.toBuffer(doc)
    return buffer
  }

  /**
   * Create title section
   */
  private createTitleSection(universityName: string, reportType: string, filters: PublicationReportData): Paragraph[] {
    return [
      new Paragraph({
        children: [
          new TextRun({
            text: universityName,
            bold: true,
            size: 32
          })
        ],
        alignment: AlignmentType.CENTER
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: this.getReportTitle(reportType),
            bold: true,
            size: 28
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Report Period: ${filters.startYear || 'All Time'} - ${filters.endYear || 'Present'}`,
            size: 24
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Generated: ${new Date().toLocaleDateString()}`,
            size: 22
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 200 }
      }),
      new Paragraph({
        text: '',
        spacing: { before: 400 }
      })
    ]
  }

  /**
   * Get report title based on type
   */
  private getReportTitle(reportType: string): string {
    switch (reportType) {
      case 'accreditation':
        return 'Accreditation Report - Faculty Publication Summary'
      case 'summary':
        return 'Faculty Publication Summary Report'
      case 'detailed':
        return 'Detailed Faculty Publication Report'
      case 'faculty_profile':
        return 'Faculty Profile Publication Report'
      default:
        return 'Publication Report'
    }
  }

  /**
   * Create executive summary section
   */
  private createExecutiveSummary(reportData: ReportMetrics): Paragraph[] {
    return [
      new Paragraph({
        children: [
          new TextRun({
            text: 'Executive Summary',
            bold: true,
            size: 28
          })
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `This report provides a comprehensive analysis of faculty publications for the specified period. The institution has produced a total of ${reportData.totalPublications} publications, with ${reportData.journalPublications} journal articles and ${reportData.conferencePublications} conference papers.`
          })
        ],
        spacing: { after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Key highlights:`
          })
        ],
        spacing: { after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `• Average publications per year: ${reportData.averagePerYear}`
          })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `• Publication growth rate: ${reportData.growthRate}%`
          })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `• Active faculty members: ${reportData.facultyStats.length}`
          })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `• Average publications per faculty: ${reportData.facultyStats.length > 0 ? Math.round(reportData.totalPublications / reportData.facultyStats.length * 100) / 100 : 0}`
          })
        ],
        spacing: { after: 300 }
      })
    ]
  }

  /**
   * Create metrics section
   */
  private createMetricsSection(reportData: ReportMetrics): Paragraph[] {
    return [
      new Paragraph({
        children: [
          new TextRun({
            text: 'Overall Metrics',
            bold: true,
            size: 28
          })
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Total Publications: ${reportData.totalPublications}`,
            bold: true
          })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Journal Publications: ${reportData.journalPublications} (${Math.round((reportData.journalPublications / reportData.totalPublications) * 100)}%)`
          })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Conference Publications: ${reportData.conferencePublications} (${Math.round((reportData.conferencePublications / reportData.totalPublications) * 100)}%)`
          })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Average Publications per Year: ${reportData.averagePerYear}`
          })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `Growth Rate: ${reportData.growthRate}%`
          })
        ],
        spacing: { after: 300 }
      })
    ]
  }

  /**
   * Create faculty statistics section
   */
  private createFacultySection(reportData: ReportMetrics): Paragraph[] {
    const facultyParagraphs: Paragraph[] = [
      new Paragraph({
        children: [
          new TextRun({
            text: 'Faculty Performance',
            bold: true,
            size: 28
          })
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      })
    ]

    // Add top performing faculty
    const topFaculty = reportData.facultyStats.slice(0, 10)

    for (const faculty of topFaculty) {
      facultyParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${faculty.name} (${faculty.department})`,
              bold: true
            })
          ],
          spacing: { before: 200, after: 100 }
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `  • Total Publications: ${faculty.totalPublications}`
            })
          ],
          spacing: { after: 50 }
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `  • Journal Publications: ${faculty.journalPublications}`
            })
          ],
          spacing: { after: 50 }
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `  • Conference Publications: ${faculty.conferencePublications}`
            })
          ],
          spacing: { after: 50 }
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `  • Average per Year: ${Math.round(faculty.averagePerYear * 100) / 100}`
            })
          ],
          spacing: { after: 200 }
        })
      )
    }

    return facultyParagraphs
  }

  /**
   * Create yearly publication section
   */
  private createYearlySection(reportData: ReportMetrics): Paragraph[] {
    const yearlyParagraphs: Paragraph[] = [
      new Paragraph({
        children: [
          new TextRun({
            text: 'Yearly Publication Trends',
            bold: true,
            size: 28
          })
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      })
    ]

    // Add yearly data
    for (const yearData of reportData.yearlyData.sort((a, b) => b.year - a.year)) {
      yearlyParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${yearData.year}:`,
              bold: true
            }),
            new TextRun({
              text: ` ${yearData.total} total publications (${yearData.journals} journals, ${yearData.conferences} conferences)`
            })
          ],
          spacing: { after: 100 }
        })
      )
    }

    return yearlyParagraphs
  }

  /**
   * Create venue analysis section
   */
  private createVenueSection(reportData: ReportMetrics): Paragraph[] {
    const venueParagraphs: Paragraph[] = [
      new Paragraph({
        children: [
          new TextRun({
            text: 'Top Publication Venues',
            bold: true,
            size: 28
          })
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      })
    ]

    // Add top venues
    for (const venue of reportData.topVenues.slice(0, 15)) {
      venueParagraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${venue.name}`,
              bold: true
            }),
            new TextRun({
              text: ` - ${venue.count} publications (${venue.type})`
            })
          ],
          spacing: { after: 100 }
        })
      )
    }

    return venueParagraphs
  }

  /**
   * Create accreditation section
   */
  private createAccreditationSection(reportData: ReportMetrics): Paragraph[] {
    const fiveYearTotal = reportData.yearlyData.slice(-5).reduce((sum, y) => sum + y.total, 0)
    const fiveYearAverage = fiveYearTotal / Math.min(5, reportData.yearlyData.length)

    return [
      new Paragraph({
        children: [
          new TextRun({
            text: 'Accreditation Compliance Metrics',
            bold: true,
            size: 28
          })
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: 'Publication Volume Requirements:',
            bold: true
          })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `• 5-Year Total: ${fiveYearTotal} publications`
          })
        ],
        spacing: { after: 50 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `• 5-Year Average: ${Math.round(fiveYearAverage * 100) / 100} publications per year`
          })
        ],
        spacing: { after: 50 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `• Compliance Status: ${fiveYearAverage >= 10 ? '✓ MEETS REQUIREMENTS' : '⚠ BELOW TARGET'}`
          })
        ],
        spacing: { after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: 'Quality Indicators:',
            bold: true
          })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `• Journal Publication Ratio: ${Math.round((reportData.journalPublications / reportData.totalPublications) * 100)}%`
          })
        ],
        spacing: { after: 50 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `• Growth Rate: ${reportData.growthRate}%`
          })
        ],
        spacing: { after: 50 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `• Top-Tier Venues: ${reportData.topVenues.filter(v => v.count >= 3).length}`
          })
        ],
        spacing: { after: 200 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: 'Faculty Engagement:',
            bold: true
          })
        ],
        spacing: { after: 100 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `• Total Faculty: ${reportData.facultyStats.length}`
          })
        ],
        spacing: { after: 50 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `• High Performers (>5 pubs): ${reportData.facultyStats.filter(f => f.totalPublications > 5).length}`
          })
        ],
        spacing: { after: 50 }
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: `• Average per Faculty: ${reportData.facultyStats.length > 0 ? Math.round(reportData.totalPublications / reportData.facultyStats.length * 100) / 100 : 0}`
          })
        ],
        spacing: { after: 200 }
      })
    ]
  }

  /**
   * Create detailed publications section
   */
  private createDetailedPublicationsSection(publications: any[]): Paragraph[] {
    const paragraphs: Paragraph[] = [
      new Paragraph({
        children: [
          new TextRun({
            text: 'Detailed Publication List',
            bold: true,
            size: 28
          })
        ],
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 200 }
      })
    ]

    // Add each publication
    for (const pub of publications) {
      const authors = Array.isArray(pub.authors) ? pub.authors.join(', ') : JSON.parse(pub.authors || '[]').join(', ')

      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: pub.title,
              bold: true
            })
          ],
          spacing: { before: 300, after: 100 }
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `Authors: ${authors}`
            })
          ],
          spacing: { after: 50 }
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `Venue: ${pub.venue} (${pub.year})`
            })
          ],
          spacing: { after: 50 }
        }),
        new Paragraph({
          children: [
            new TextRun({
              text: `Type: ${pub.type} | Source: ${pub.source}`
            })
          ],
          spacing: { after: 200 }
        })
      )
    }

    return paragraphs
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

    return `${this.universityName.replace(/[^a-zA-Z0-9]/g, '_')}_${reportType}${department}${years}_${timestamp}.docx`
  }
}