import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { type DynamicRecord, db } from '@/lib/database'
import { FileText, RefreshCw, Upload } from 'lucide-react'
import type React from 'react'
import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from './ui/select'

interface ExcelUploadProps {
	onDataUploaded: (data: DynamicRecord[], fileName: string, removedCount?: number) => void
	onFileProcessing?: (isProcessing: boolean) => void
	orderby: string
	setOrderby: (orderby: string) => void
	orderByOptions: { label: string; value: string }[]
}

const ExcelUpload = ({
	onDataUploaded,
	onFileProcessing,
	orderby,
	setOrderby,
	orderByOptions,
}: ExcelUploadProps) => {
	const [selectedFile, setSelectedFile] = useState<File | null>(null)
	const [uploading, setUploading] = useState(false)
	const [isDragging, setIsDragging] = useState(false)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const { toast } = useToast()

	const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (file) {
			const fileType = file.type
			const fileName = file.name.toLowerCase()

			if (
				fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
				fileName.endsWith('.xlsx')
			) {
				setSelectedFile(file)
				await processAndUploadFile(file)
			} else {
				toast({
					title: 'Invalid file type',
					description: 'Please select an Excel (.xlsx) file.',
					variant: 'destructive',
				})
			}
		}
	}

	const processFile = async (file: File) => {
		return new Promise((resolve, reject) => {
			const reader = new FileReader()

			reader.onload = (e) => {
				try {
					const data = e.target?.result
					let jsonData: any[] = []

					// NOTE: This is for CSV files, we don't need it for now
					// if (file.name.toLowerCase().endsWith('.csv')) {
					// 	const text = data as string
					// 	const lines = text.split('\n')
					// 	const headers = lines[0].split(',')

					// 	jsonData = lines
					// 		.slice(1)
					// 		.filter((line) => line.trim())
					// 		.map((line, index) => {
					// 			const values = line.split(',')
					// 			const obj: any = { rowId: index }
					// 			headers.forEach((header, index) => {
					// 				obj[header.trim()] = values[index]?.trim() || ''
					// 			})
					// 			return obj
					// 		})
					// } else {
					const workbook = XLSX.read(data, { type: 'array' })
					const sheetName = workbook.SheetNames[0]
					const worksheet = workbook.Sheets[sheetName]

					const headerRows = XLSX.utils.sheet_to_json(worksheet, { header: 1 })
					const headerRow = (headerRows[0] || []) as any[]
					const columnOrder = headerRow.map((h) => String(h).trim()).filter((h) => h.length > 0)

					const rawData = XLSX.utils.sheet_to_json(worksheet)
					const cleanedData = rawData.filter((row: any) => {
						return Object.values(row)?.some((val: any) => String(val)?.trim() !== '')
					})

					const removedCount = rawData.length - cleanedData.length
					jsonData = cleanedData.map((row: any, index: number) => ({
						rowId: index,
						...row,
					}))
					// }

					resolve({ data: jsonData, removedCount, columnOrder })
				} catch (error) {
					reject(error)
				}
			}

			reader.onerror = () => reject(new Error('Failed to read file'))

			// if (file.name.toLowerCase().endsWith('.csv')) {
			// 	reader.readAsText(file)
			// } else {
			reader.readAsArrayBuffer(file)
			// }
		})
	}

	const processAndUploadFile = async (file: File) => {
		setUploading(true)
		onFileProcessing?.(true)

		try {
			const result = (await processFile(file)) as any
			const { data, removedCount, columnOrder } = result

			await db.adv_unprocessed.clear()
			await db.adv_unprocessed.bulkAdd(data)

			if (Array.isArray(columnOrder) && columnOrder.length > 0) {
				localStorage.setItem('adv_unprocessed_columnOrder', JSON.stringify(columnOrder))
			}

			onDataUploaded(data, file.name, removedCount)

			toast({
				title: 'File processed successfully',
				description: `${data.length} records loaded from ${file.name}`,
			})
		} catch (error) {
			console.error('Upload error:', error)
			toast({
				title: 'Processing failed',
				description: 'There was an error processing your file. Please try again.',
				variant: 'destructive',
			})
		} finally {
			setUploading(false)
			onFileProcessing?.(false)
		}
	}

	const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(true)
	}

	const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(false)
	}

	const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
		e.preventDefault()
		e.stopPropagation()
		setIsDragging(false)

		const file = e.dataTransfer.files?.[0]
		if (file) {
			const fileType = file.type
			const fileName = file.name.toLowerCase()

			if (
				fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
				fileName.endsWith('.xlsx')
			) {
				setSelectedFile(file)
				await processAndUploadFile(file)
			} else {
				toast({
					title: 'Invalid file type',
					description: 'Please select an Excel (.xlsx) file.',
					variant: 'destructive',
				})
			}
		}
	}

	return (
		<Card className='py-0'>
			<CardContent className='p-4'>
				<div className='space-y-2'>
					<div className='flex justify-between items-center flex-wrap gap-3'>
						<div className='flex flex-col gap-2'>
							<h3 className='text-lg font-semibold'>Upload Catalog Data</h3>
							<p className='text-sm text-muted-foreground'>
								Upload Excel (.xlsx, .xls) files with book search criteria.
							</p>
						</div>
						<div>
							<Select defaultValue={orderby} onValueChange={(value) => setOrderby(value)}>
								<SelectGroup>
									<SelectLabel className='px-0'>Order By</SelectLabel>
									<SelectTrigger>
										<SelectValue placeholder='Order By (Default: Best Match)' />
									</SelectTrigger>
									<SelectContent>
										{orderByOptions.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</SelectGroup>
							</Select>
						</div>
					</div>
					<div
						className={`border-2 border-dashed rounded-lg p-6 mt-4 flex justify-center items-center flex-col transition-colors ${
							isDragging ? 'border-primary bg-primary/5' : 'border-border'
						}`}
						onDragOver={handleDragOver}
						onDragLeave={handleDragLeave}
						onDrop={handleDrop}
					>
						<Upload className='mx-auto h-12 w-12 text-muted-foreground mb-4' />
						<div className='flex flex-col gap-2'>
							<h3 className='text-lg font-semibold text-center'>
								Drop files here or click to browse
							</h3>
							<p className='text-sm text-muted-foreground text-center'>
								Drop your Excel (.xlsx) file here, or click to browse.
							</p>
							<input
								ref={fileInputRef}
								type='file'
								accept='.xlsx'
								onChange={handleFileSelect}
								className='hidden'
							/>
							<Button
								variant='outline'
								className='mx-auto'
								onClick={() => fileInputRef.current?.click()}
								disabled={uploading}
							>
								Choose File
							</Button>
						</div>
					</div>

					{selectedFile && (
						<div className='flex items-center space-x-2 p-3 bg-muted rounded-lg'>
							<FileText className='h-5 w-5 text-muted-foreground' />
							<span className='text-sm font-medium flex-1'>{selectedFile.name}</span>
							<span className='text-xs text-muted-foreground'>
								{(selectedFile.size / 1024 / 1024).toFixed(2)} MB
							</span>
							{uploading && <RefreshCw className='h-4 w-4 animate-spin text-primary' />}
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	)
}

export default ExcelUpload
