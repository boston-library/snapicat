import { BookRecord } from '@/types'
import * as XLSX from 'xlsx'

export const parseExcelToJson = async (file: File): Promise<BookRecord[]> => {
	return new Promise((resolve, reject) => {
		const reader = new FileReader()

		reader.onload = (e: ProgressEvent<FileReader>) => {
			try {
				const data = e.target?.result
				const workbook = XLSX.read(data, { type: 'array' })
				const sheetName = workbook.SheetNames[0]
				const worksheet = workbook.Sheets[sheetName]
				const jsonData = XLSX.utils.sheet_to_json<BookRecord>(worksheet)

				resolve(jsonData)
			} catch (error) {
				reject(error)
			}
		}

		reader.onerror = (error) => {
			reject(error)
		}

		reader.readAsArrayBuffer(file)
	})
}

export const jsonToExcel = (data: BookRecord[], fileName: string): void => {
	const worksheet = XLSX.utils.json_to_sheet(data)
	const workbook = XLSX.utils.book_new()
	XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
	XLSX.writeFile(workbook, fileName ?? 'export.xlsx')
}
