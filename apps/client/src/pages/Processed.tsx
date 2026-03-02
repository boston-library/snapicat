import ProcessedDataTable from '@/components/ProcessedDataTable'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { db } from '@/lib/database'
import { jsonToExcel } from '@/lib/excel'
import { useGenerateXML } from '@/lib/mutations/use-generate-xml'
import { getPageSizeFromStorage } from '@/lib/session-storage'
import { getDisplayColumnKeys, sortColumns } from '@/lib/sort-columns'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

const Processed = () => {
	const { toast } = useToast()
	const [searchParams, setSearchParams] = useSearchParams()
	const [processedRecords, setProcessedRecords] = useState<any[]>([])
	const [columnOrder, setColumnOrder] = useState<string[]>([])
	const [showConfirm, setShowConfirm] = useState(false)
	const [isGeneratingMARCXML, setIsGeneratingMARCXML] = useState(false)
	const [isGeneratingMARC, setIsGeneratingMARC] = useState(false)
	const generateXMLMutation = useGenerateXML()

	const loadProcessedRecords = async () => {
		try {
			const records = await db.processedData.toArray()
			setProcessedRecords(records)

			try {
				const storedOrder = localStorage.getItem('processed_columnOrder')
				if (storedOrder) {
					const parsed = JSON.parse(storedOrder)
					if (Array.isArray(parsed) && parsed.length > 0) {
						setColumnOrder(parsed.filter((c): c is string => typeof c === 'string'))
					} else if (records.length > 0) {
						const allColumns = new Set<string>()
						records.forEach((row) => {
							Object.keys(row).forEach((k) => {
								if (k !== 'rowId' && k !== 'id') {
									allColumns.add(k)
								}
							})
						})
						setColumnOrder(Array.from(allColumns))
					} else {
						setColumnOrder([])
					}
				} else if (records.length > 0) {
					const allColumns = new Set<string>()
					records.forEach((row) => {
						Object.keys(row).forEach((k) => {
							if (k !== 'rowId' && k !== 'id') {
								allColumns.add(k)
							}
						})
					})
					setColumnOrder(Array.from(allColumns))
				} else {
					setColumnOrder([])
				}
			} catch {
				if (records.length > 0) {
					const allColumns = new Set<string>()
					records.forEach((row) => {
						Object.keys(row).forEach((k) => {
							if (k !== 'rowId' && k !== 'id') {
								allColumns.add(k)
							}
						})
					})
					setColumnOrder(Array.from(allColumns))
				} else {
					setColumnOrder([])
				}
			}
		} catch (error) {
			console.error('Error loading processed data:', error)
			toast({
				title: 'Error',
				description: 'Failed to load processed data.',
				variant: 'destructive',
			})
		}
	}

	const handlePageChange = (pageIndex: number) => {
		setSearchParams({ page: String(pageIndex + 1) }, { replace: true })
	}

	useEffect(() => {
		if (processedRecords.length === 0) {
			return
		}

		const pageParam = searchParams.get('page')
		if (!pageParam) {
			return
		}

		const pageNum = Number.parseInt(pageParam, 10)
		if (Number.isNaN(pageNum) || pageNum <= 0) {
			setSearchParams({ page: '1' }, { replace: true })
			return
		}

		const pageSize = getPageSizeFromStorage('processedPageSize', 25)
		const totalPages = Math.ceil(processedRecords.length / pageSize)

		if (totalPages > 0 && pageNum > totalPages) {
			setSearchParams({ page: String(totalPages) }, { replace: true })
		}
	}, [processedRecords.length, searchParams, setSearchParams])

	// biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
	useEffect(() => {
		loadProcessedRecords()
	}, [])

	const handleDownload = () => {
		try {
			const displayColumnKeys = getDisplayColumnKeys(processedRecords, columnOrder)
			const sortedColumns = sortColumns(
				displayColumnKeys,
				columnOrder.length > 0 ? columnOrder : displayColumnKeys,
			)

			// Create filtered data with sorted columns (only the columns that are displayed)
			const filteredData = processedRecords.map((row) => {
				const filteredRow: Record<string, any> = {}
				sortedColumns.forEach((key) => {
					filteredRow[key] = row[key]
				})
				return filteredRow
			})

			const date = new Date().toISOString().split('T')[0]
			const fileName = `processed_data_${date}.xlsx`

			jsonToExcel(filteredData, fileName)

			toast({
				title: 'Download Started',
				description: 'Your Excel file is being downloaded.',
			})
		} catch (error) {
			console.error('Download error:', error)
			toast({
				title: 'Download Failed',
				description: 'There was an error preparing your download.',
				variant: 'destructive',
			})
		}
	}

	const handleGenerateXML = async (format: 'marcxml' | 'marc') => {
		if (processedRecords.length === 0) {
			toast({
				title: 'No Records',
				description: 'There are no records to generate XML from.',
				variant: 'destructive',
			})
			return
		}

		if (format === 'marcxml') {
			setIsGeneratingMARCXML(true)
		} else {
			setIsGeneratingMARC(true)
		}

		try {
			const oclcNumbers = processedRecords
				.map((row) => row.oclc_number)
				.filter((num): num is string => !!num)

			if (oclcNumbers.length === 0) {
				toast({
					title: 'No OCLC Numbers',
					description: 'No valid OCLC numbers found in the records.',
					variant: 'destructive',
				})
				return
			}

			const response = await generateXMLMutation.mutateAsync({
				books: oclcNumbers,
				format,
			})

			const blob = new Blob([response], {
				type: format === 'marcxml' ? 'application/xml' : 'application/octet-stream',
			})
			const url = window.URL.createObjectURL(blob)
			const link = document.createElement('a')
			link.href = url
			link.download = `oclc_records_${new Date().toISOString().split('T')[0]}.${format === 'marcxml' ? 'xml' : 'mrc'}`
			document.body.appendChild(link)
			link.click()
			document.body.removeChild(link)
			window.URL.revokeObjectURL(url)

			toast({
				title: format === 'marcxml' ? 'XML Generated' : 'MARC Generated',
				description:
					format === 'marcxml' ? 'XML file is being downloaded.' : 'MARC file is being downloaded.',
			})
		} catch (error) {
			console.error(`File generation error for ${format}: ${error}`)
			toast({
				title: format === 'marcxml' ? 'XML Generation Failed' : 'MARC Generation Failed',
				description:
					format === 'marcxml'
						? 'There was an error generating the XML.'
						: 'There was an error generating the MARC.',
				variant: 'destructive',
			})
		} finally {
			if (format === 'marcxml') {
				setIsGeneratingMARCXML(false)
			} else {
				setIsGeneratingMARC(false)
			}
		}
	}

	const handleClearProcessed = async () => {
		await db.processedData.clear()
		localStorage.removeItem('processed_columnOrder')
		setProcessedRecords([])
		setColumnOrder([])
		setShowConfirm(false)
		toast({
			title: 'Processed Data Cleared',
			description: 'All processed records have been cleared.',
		})
	}

	return (
		<div className='container mx-auto px-4 py-8 space-y-6'>
			<div className='flex flex-col sm:flex-row justify-between items-start sm:items-center space-y-4 sm:space-y-0'>
				<div>
					<h1 className='text-2xl font-bold'>Processed Records</h1>
					<p className='text-muted-foreground'>Review processed records and generate XML</p>
				</div>
				<div className='flex flex-wrap gap-2'>
					<Button
						variant='destructive'
						onClick={() => setShowConfirm(true)}
						disabled={isGeneratingMARCXML || isGeneratingMARC || processedRecords.length === 0}
					>
						Clear Processed Data
					</Button>
					<Button
						disabled={processedRecords.length === 0}
						variant='outline'
						onClick={handleDownload}
					>
						Download Excel
					</Button>
					<Button
						onClick={() => handleGenerateXML('marc')}
						disabled={processedRecords.length === 0 || isGeneratingMARCXML || isGeneratingMARC}
					>
						{isGeneratingMARC ? (
							<>
								<Loader2 className='mr-2 h-4 w-4 animate-spin' />
								Generating MARC...
							</>
						) : (
							'Generate MARC'
						)}
					</Button>
					<Button
						onClick={() => handleGenerateXML('marcxml')}
						disabled={processedRecords.length === 0 || isGeneratingMARCXML || isGeneratingMARC}
					>
						{isGeneratingMARCXML ? (
							<>
								<Loader2 className='mr-2 h-4 w-4 animate-spin' />
								Generating XML...
							</>
						) : (
							'Generate XML'
						)}
					</Button>
				</div>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Processed Records Table</CardTitle>
				</CardHeader>
				<CardContent>
					<ProcessedDataTable
						data={processedRecords}
						columnOrder={columnOrder}
						onPageChange={handlePageChange}
						initialPageIndex={(() => {
							const pageParam = searchParams.get('page')
							if (pageParam) {
								const pageNum = Number.parseInt(pageParam, 10)
								if (pageNum > 0 && !Number.isNaN(pageNum)) {
									if (processedRecords.length > 0) {
										const pageSize = getPageSizeFromStorage('processedPageSize', 25)
										const totalPages = Math.ceil(processedRecords.length / pageSize)
										if (pageNum <= totalPages && totalPages > 0) {
											return pageNum - 1
										}
										return Math.max(0, totalPages - 1)
									}
									return pageNum - 1
								}
							}
							return 0
						})()}
					/>
				</CardContent>
			</Card>

			{showConfirm && (
				<div className='fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm'>
					<Card className='max-w-md w-full shadow-xl border'>
						<CardHeader>
							<CardTitle>Clear all processed data?</CardTitle>
						</CardHeader>
						<CardContent className='space-y-4'>
							<p className='text-muted-foreground'>
								This action cannot be undone. Are you sure you want to clear all processed records?
							</p>
							<div className='flex gap-2 justify-end'>
								<Button variant='outline' onClick={() => setShowConfirm(false)}>
									Cancel
								</Button>
								<Button variant='destructive' onClick={handleClearProcessed}>
									Clear All
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>
			)}
		</div>
	)
}

export default Processed
