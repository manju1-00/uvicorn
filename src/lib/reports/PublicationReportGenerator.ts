import { prisma } from '@/lib/database'

export interface PublicationReportData {
  facultyId?: string
  startYear?: number
  endYear?: number
  publicationType?: 'JOURNAL' | 'CONFERENCE' | 'ALL'
  department?: string
}

export interface YearlyPublicationData {
  year: number
  journals: number
  conferences: number
  total: number
  faculty: Array<{
    id: string
    name: string
    email: string
    department: string
    publicationCount: number
    journalCount: number
    conferenceCount: number
  }>
}

export interface ReportMetrics {
  totalPublications: number
  journalPublications: number
  conferencePublications: number
  averagePerYear: number
  growthRate: number
  topVenues: Array<{
    name: string
    count: number
    type: 'JOURNAL' | 'CONFERENCE'
  }>
  facultyStats: Array<{
    name: string
    email: string
    department: string
    totalPublications: number
    journalPublications: number
    conferencePublications: number
    averagePerYear: number
  }>
  yearlyData: YearlyPublicationData[]
  departmentBreakdown: Array<{
    department: string
    totalPublications: number
    facultyCount: number
    averagePerFaculty: number
  }>
}

export interface ReportConfig {
  universityName?: string
  includeCharts?: boolean
  includeDetailedListings?: boolean
  reportType: 'summary' | 'detailed' | 'accreditation' | 'faculty_profile'
}

export class PublicationReportGenerator {
  private readonly universityName: string

  constructor() {
    this.universityName = process.env.UNIVERSITY_NAME || 'University Name'
  }

  /**
   * Generate comprehensive publication report
   */
  public async generateReport(
    data: PublicationReportData,
    config: ReportConfig
  ): Promise<ReportMetrics> {
    // Build filter conditions
    const whereConditions: any = {}

    if (data.facultyId) {
      whereConditions.facultyId = data.facultyId
    }

    if (data.startYear || data.endYear) {
      whereConditions.year = {}
      if (data.startYear) {
        whereConditions.year.gte = data.startYear
      }
      if (data.endYear) {
        whereConditions.year.lte = data.endYear
      }
    }

    if (data.publicationType && data.publicationType !== 'ALL') {
      whereConditions.type = data.publicationType
    }

    if (data.department) {
      whereConditions.faculty = {
        department: data.department
      }
    }

    console.log(`Generating report with conditions:`, whereConditions)

    // Fetch publications with faculty information
    const publications = await prisma.publication.findMany({
      where: whereConditions,
      include: {
        faculty: {
          select: {
            id: true,
            name: true,
            email: true,
            department: true
          }
        }
      },
      orderBy: {
        year: 'desc'
      }
    })

    console.log(`Found ${publications.length} publications for report`)

    return this.processReportData(publications, config)
  }

  /**
   * Process publication data and calculate metrics
   */
  private processReportData(publications: any[], config: ReportConfig): ReportMetrics {
    // Initialize data structures
    const yearlyData = new Map<number, YearlyPublicationData>()
    const facultyStats = new Map<string, any>()
    const venueStats = new Map<string, { count: number; type: 'JOURNAL' | 'CONFERENCE' }>()
    const departmentStats = new Map<string, { totalPublications: number; facultyCount: number; facultySet: Set<string> }>()

    // Process each publication
    for (const pub of publications) {
      const year = pub.year
      const type = pub.type as 'JOURNAL' | 'CONFERENCE'
      const faculty = pub.faculty

      // Initialize year data if not exists
      if (!yearlyData.has(year)) {
        yearlyData.set(year, {
          year,
          journals: 0,
          conferences: 0,
          total: 0,
          faculty: []
        })
      }

      const yearData = yearlyData.get(year)!
      if (type === 'JOURNAL') {
        yearData.journals++
      } else {
        yearData.conferences++
      }
      yearData.total++

      // Track faculty statistics
      if (!facultyStats.has(faculty.id)) {
        facultyStats.set(faculty.id, {
          name: faculty.name,
          email: faculty.email,
          department: faculty.department,
          totalPublications: 0,
          journalPublications: 0,
          conferencePublications: 0,
          averagePerYear: 0,
          years: new Set()
        })
      }

      const facultyStat = facultyStats.get(faculty.id)!
      facultyStat.totalPublications++
      facultyStat.years.add(year)
      if (type === 'JOURNAL') {
        facultyStat.journalPublications++
      } else {
        facultyStat.conferencePublications++
      }

      // Add to year faculty list if not already present
      const yearFaculty = yearData.faculty.find(f => f.id === faculty.id)
      if (!yearFaculty) {
        yearData.faculty.push({
          id: faculty.id,
          name: faculty.name,
          email: faculty.email,
          department: faculty.department,
          publicationCount: 0,
          journalCount: 0,
          conferenceCount: 0
        })
      }

      const yearFacultyStat = yearData.faculty.find(f => f.id === faculty.id)!
      yearFacultyStat.publicationCount++
      if (type === 'JOURNAL') {
        yearFacultyStat.journalCount++
      } else {
        yearFacultyStat.conferenceCount++
      }

      // Track venue statistics
      const venueKey = pub.venue
      if (!venueStats.has(venueKey)) {
        venueStats.set(venueKey, { count: 0, type })
      }
      venueStats.get(venueKey)!.count++

      // Track department statistics
      if (!departmentStats.has(faculty.department)) {
        departmentStats.set(faculty.department, {
          totalPublications: 0,
          facultyCount: 0,
          facultySet: new Set()
        })
      }
      const deptStat = departmentStats.get(faculty.department)!
      deptStat.totalPublications++
      deptStat.facultySet.add(faculty.id)
    }

    // Calculate averages for faculty
    for (const [facultyId, stat] of facultyStats) {
      stat.averagePerYear = stat.years.size > 0 ? stat.totalPublications / stat.years.size : 0
      delete stat.years // Remove temporary data
    }

    // Sort yearly data by year (ascending)
    const sortedYearlyData = Array.from(yearlyData.values()).sort((a, b) => a.year - b.year)

    // Calculate top venues
    const topVenues = Array.from(venueStats.entries())
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)

    // Calculate department breakdown
    const departmentBreakdown = Array.from(departmentStats.entries()).map(([department, data]) => ({
      department,
      totalPublications: data.totalPublications,
      facultyCount: data.facultySet.size,
      averagePerFaculty: data.facultySet.size > 0 ? data.totalPublications / data.facultySet.size : 0
    }))

    // Calculate overall metrics
    const totalPublications = publications.length
    const journalPublications = publications.filter(p => p.type === 'JOURNAL').length
    const conferencePublications = publications.filter(p => p.type === 'CONFERENCE').length

    const years = sortedYearlyData.map(y => y.year)
    const yearSpan = years.length > 0 ? Math.max(...years) - Math.min(...years) + 1 : 1
    const averagePerYear = totalPublications / yearSpan

    // Calculate growth rate (simple year-over-year)
    const growthRate = this.calculateGrowthRate(sortedYearlyData)

    return {
      totalPublications,
      journalPublications,
      conferencePublications,
      averagePerYear: Math.round(averagePerYear * 100) / 100,
      growthRate: Math.round(growthRate * 100) / 100,
      topVenues,
      facultyStats: Array.from(facultyStats.values())
        .sort((a, b) => b.totalPublications - a.totalPublications),
      yearlyData: sortedYearlyData,
      departmentBreakdown
    }
  }

  /**
   * Calculate year-over-year growth rate
   */
  private calculateGrowthRate(yearlyData: YearlyPublicationData[]): number {
    if (yearlyData.length < 2) {
      return 0
    }

    const sortedData = yearlyData.sort((a, b) => a.year - b.year)
    const growthRates: number[] = []

    for (let i = 1; i < sortedData.length; i++) {
      const current = sortedData[i].total
      const previous = sortedData[i - 1].total

      if (previous > 0) {
        const rate = ((current - previous) / previous) * 100
        growthRates.push(rate)
      }
    }

    return growthRates.length > 0
      ? growthRates.reduce((sum, rate) => sum + rate, 0) / growthRates.length
      : 0
  }

  /**
   * Generate accreditation-focused report
   */
  public async generateAccreditationReport(data: PublicationReportData): Promise<{
    executiveSummary: any
    detailedMetrics: ReportMetrics
    complianceMetrics: any
    trends: any
  }> {
    const config: ReportConfig = {
      reportType: 'accreditation',
      universityName: this.universityName,
      includeCharts: true,
      includeDetailedListings: true
    }

    const metrics = await this.generateReport(data, config)

    // Generate executive summary
    const executiveSummary = {
      totalPublications: metrics.totalPublications,
      publicationGrowth: metrics.growthRate,
      facultyEngagement: metrics.facultyStats.length,
      averagePublicationsPerFaculty: metrics.facultyStats.length > 0
        ? metrics.totalPublications / metrics.facultyStats.length
        : 0,
      qualityIndicators: {
        journalPublications: metrics.journalPublications,
        conferencePublications: metrics.conferencePublications,
        topTierVenues: metrics.topVenues.slice(0, 5)
      },
      researchProductivity: {
        averagePerYear: metrics.averagePerYear,
        yearlyTrend: metrics.yearlyData.slice(-5) // Last 5 years
      }
    }

    // Generate compliance metrics
    const complianceMetrics = {
      publicationVolume: {
        current: metrics.totalPublications,
        target: data.startYear && data.endYear
          ? (data.endYear - data.startYear + 1) * 10 // Target: 10 publications per year
          : metrics.totalPublications,
        status: metrics.totalPublications >= (data.startYear && data.endYear
          ? (data.endYear - data.startYear + 1) * 10
          : metrics.totalPublications) ? 'MEETS_TARGET' : 'BELOW_TARGET'
      },
      facultyParticipation: {
        participatingFaculty: metrics.facultyStats.length,
        totalFaculty: metrics.facultyStats.length, // Would need to get actual total from faculty table
        participationRate: 100,
        status: 'EXCELLENT'
      },
      qualityMetrics: {
        journalRatio: metrics.totalPublications > 0
          ? (metrics.journalPublications / metrics.totalPublications) * 100
          : 0,
        venueQuality: this.assessVenueQuality(metrics.topVenues),
        citationPotential: 'HIGH' // Would need actual citation data
      }
    }

    // Generate trends analysis
    const trends = {
      publicationTrend: this.analyzePublicationTrend(metrics.yearlyData),
      facultyProductivity: metrics.facultyStats.map(f => ({
        name: f.name,
        trend: 'STABLE', // Would need historical data for each faculty
        performance: f.totalPublications > 5 ? 'HIGH' : f.totalPublications > 2 ? 'MEDIUM' : 'LOW'
      })),
      venuePreferences: {
        topJournals: metrics.topVenues.filter(v => v.type === 'JOURNAL').slice(0, 10),
        topConferences: metrics.topVenues.filter(v => v.type === 'CONFERENCE').slice(0, 10)
      }
    }

    return {
      executiveSummary,
      detailedMetrics: metrics,
      complianceMetrics,
      trends
    }
  }

  /**
   * Assess venue quality based on publication frequency
   */
  private assessVenueQuality(topVenues: any[]): 'HIGH' | 'MEDIUM' | 'LOW' {
    if (topVenues.length === 0) return 'LOW'

    const averagePublications = topVenues.reduce((sum, v) => sum + v.count, 0) / topVenues.length

    if (averagePublications >= 5) return 'HIGH'
    if (averagePublications >= 2) return 'MEDIUM'
    return 'LOW'
  }

  /**
   * Analyze publication trend
   */
  private analyzePublicationTrend(yearlyData: YearlyPublicationData[]): {
    direction: 'GROWING' | 'DECLINING' | 'STABLE'
    percentage: number
    description: string
  } {
    if (yearlyData.length < 3) {
      return {
        direction: 'STABLE',
        percentage: 0,
        description: 'Insufficient data for trend analysis'
      }
    }

    const sortedData = yearlyData.sort((a, b) => a.year - b.year)
    const recentYears = sortedData.slice(-3)
    const earlierYears = sortedData.slice(0, 3)

    const recentAvg = recentYears.reduce((sum, y) => sum + y.total, 0) / recentYears.length
    const earlierAvg = earlierYears.reduce((sum, y) => sum + y.total, 0) / earlierYears.length

    if (earlierAvg === 0) {
      return {
        direction: 'GROWING',
        percentage: 100,
        description: 'Significant growth in publications'
      }
    }

    const change = ((recentAvg - earlierAvg) / earlierAvg) * 100
    const direction = change > 10 ? 'GROWING' : change < -10 ? 'DECLINING' : 'STABLE'

    let description = ''
    if (direction === 'GROWING') {
      description = `Publications have increased by ${Math.abs(Math.round(change))}% over the period`
    } else if (direction === 'DECLINING') {
      description = `Publications have decreased by ${Math.abs(Math.round(change))}% over the period`
    } else {
      description = 'Publications have remained relatively stable'
    }

    return {
      direction,
      percentage: Math.round(change),
      description
    }
  }

  /**
   * Get available years for reports
   */
  public async getAvailableYears(): Promise<number[]> {
    const years = await prisma.publication.findMany({
      select: { year: true },
      distinct: ['year'],
      orderBy: { year: 'asc' }
    })

    return years.map(y => y.year)
  }

  /**
   * Get available departments
   */
  public async getAvailableDepartments(): Promise<string[]> {
    const departments = await prisma.faculty.findMany({
      select: { department: true },
      distinct: ['department'],
      orderBy: { department: 'asc' }
    })

    return departments.map(d => d.department).filter(Boolean)
  }
}