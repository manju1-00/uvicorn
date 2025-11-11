'use client'

import React, { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

interface FacultyData {
  facultyName: string
  email: string
  department: string
}

interface UploadResult {
  success: boolean
  data?: {
    uploaded: FacultyData[]
    duplicates: string[]
    totalRecords: number
    validRecords: number
    savedRecords: number
  }
  message?: string
  error?: string
}

const FacultyDataUpload: React.FC = () => {
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [previewData, setPreviewData] = useState<FacultyData[]>([])
  const [showPreview, setShowPreview] = useState(false)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (file) {
      processFile(file)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv']
    },
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024, // 10MB
    disabled: uploading
  })

  const processFile = async (file: File) => {
    const formData = new FormData()
    formData.append('faculty_data', file)

    setUploading(true)
    setUploadResult(null)

    try {
      const response = await fetch('/api/upload/excel', {
        method: 'POST',
        body: formData
      })

      const result: UploadResult = await response.json()

      if (response.ok && result.success && result.data) {
        setUploadResult(result)
        setPreviewData(result.data.uploaded.slice(0, 5)) // Show first 5 records as preview
        setShowPreview(true)
      } else {
        setUploadResult({
          success: false,
          error: result.error?.message || 'Upload failed'
        })
      }
    } catch (error) {
      setUploadResult({
        success: false,
        error: error instanceof Error ? error.message : 'An unknown error occurred'
      })
    } finally {
      setUploading(false)
    }
  }

  const getDropzoneStyle = () => {
    let baseStyle = {
      flex: 1,
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px',
      borderWidth: 2,
      borderRadius: 8,
      borderColor: '#cccccc',
      borderStyle: 'dashed',
      backgroundColor: '#fafafa',
      color: '#666666',
      outline: 'none',
      transition: 'border .24s ease-in-out',
      cursor: uploading ? 'not-allowed' : 'pointer',
      minHeight: '200px',
      width: '100%'
    }

    if (isDragActive && !isDragReject) {
      baseStyle = {
        ...baseStyle,
        borderColor: '#2196f3',
        backgroundColor: '#e3f2fd'
      }
    } else if (isDragReject) {
      baseStyle = {
        ...baseStyle,
        borderColor: '#f44336',
        backgroundColor: '#ffebee'
      }
    }

    return baseStyle
  }

  const downloadTemplate = () => {
    const csvContent = `Faculty Name,Email,Department
Dr. John Smith,john.smith@university.edu,Computer Science
Dr. Jane Doe,jane.doe@university.edu,Mathematics
Dr. Bob Wilson,bob.wilson@university.edu,Physics`

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'faculty_template.csv'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.URL.revokeObjectURL(url)
  }

  const resetUpload = () => {
    setUploadResult(null)
    setPreviewData([])
    setShowPreview(false)
  }

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">Upload Faculty Data</h2>

        <div className="mb-6">
          <p className="text-gray-600 mb-4">
            Upload an Excel file containing faculty information. The file should include the following columns:
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-4">
            <h3 className="font-semibold text-blue-800 mb-2">Required Columns:</h3>
            <ul className="list-disc list-inside text-blue-700 space-y-1">
              <li>Faculty Name</li>
              <li>Email</li>
              <li>Department</li>
            </ul>
          </div>
          <button
            onClick={downloadTemplate}
            className="bg-green-600 hover:bg-green-700 text-white font-medium py-2 px-4 rounded transition duration-200"
          >
            Download Template
          </button>
        </div>

        {!showPreview && (
          <div {...getRootProps()} style={getDropzoneStyle()}>
            <input {...getInputProps()} />
            {uploading ? (
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="mt-4 text-blue-600">Uploading and processing file...</p>
              </div>
            ) : isDragActive ? (
              <p className="text-blue-600">Drop the Excel file here...</p>
            ) : (
              <div className="text-center">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
                  stroke="currentColor"
                  fill="none"
                  viewBox="0 0 48 48"
                  aria-hidden="true"
                >
                  <path
                    d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <p className="mt-2 text-lg">
                  Drag and drop your Excel file here, or click to select file
                </p>
                <p className="text-sm text-gray-500 mt-1">
                  Supported formats: .xlsx, .xls, .csv (Max 10MB)
                </p>
              </div>
            )}
          </div>
        )}

        {uploadResult && (
          <div className={`mt-6 p-4 rounded-lg ${uploadResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            {uploadResult.success ? (
              <div>
                <h3 className="font-semibold text-green-800 mb-2">✅ Upload Successful!</h3>
                <p className="text-green-700 mb-4">{uploadResult.message}</p>
                {uploadResult.data && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div className="bg-white p-3 rounded">
                      <div className="font-semibold text-gray-600">Total Records</div>
                      <div className="text-lg font-bold text-gray-800">{uploadResult.data.totalRecords}</div>
                    </div>
                    <div className="bg-white p-3 rounded">
                      <div className="font-semibold text-gray-600">Valid Records</div>
                      <div className="text-lg font-bold text-blue-600">{uploadResult.data.validRecords}</div>
                    </div>
                    <div className="bg-white p-3 rounded">
                      <div className="font-semibold text-gray-600">Saved Records</div>
                      <div className="text-lg font-bold text-green-600">{uploadResult.data.savedRecords}</div>
                    </div>
                    <div className="bg-white p-3 rounded">
                      <div className="font-semibold text-gray-600">Duplicates</div>
                      <div className="text-lg font-bold text-orange-600">{uploadResult.data.duplicates.length}</div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <h3 className="font-semibold text-red-800 mb-2">❌ Upload Failed</h3>
                <p className="text-red-700">{uploadResult.error}</p>
              </div>
            )}
          </div>
        )}

        {showPreview && previewData.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Preview of Uploaded Data</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full bg-white border border-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                      Faculty Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b">
                      Department
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {previewData.map((faculty, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {faculty.facultyName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {faculty.email}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {faculty.department}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {previewData.length >= 5 && (
              <p className="text-sm text-gray-500 mt-2">
                Showing first 5 records. Total uploaded: {uploadResult.data?.savedRecords || 0} records.
              </p>
            )}
            <div className="mt-4 flex gap-3">
              <button
                onClick={resetUpload}
                className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded transition duration-200"
              >
                Upload Another File
              </button>
            </div>
          </div>
        )}

        <div className="mt-8 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h4 className="font-semibold text-yellow-800 mb-2">📝 Tips for Successful Upload:</h4>
          <ul className="list-disc list-inside text-yellow-700 space-y-1 text-sm">
            <li>Ensure your Excel file has the exact column names: "Faculty Name", "Email", "Department"</li>
            <li>Email addresses must be unique - duplicates will be skipped</li>
            <li>All fields are required for each faculty member</li>
            <li>Maximum file size is 10MB</li>
            <li>Supported formats: .xlsx, .xls, .csv</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default FacultyDataUpload