import BookDataTable from '@/components/BookDataTable'
import ExcelUpload from '@/components/ExcelUpload'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import type { SearchResponse } from '@/lib/api'
import { type DynamicRecord, db } from '@/lib/database'
import { jsonToExcel } from '@/lib/excel'
import { useSearchBooks } from '@/lib/mutations/use-search-books'
import {
	ADV_QUERY_BATCH_RETRY_ATTEMPTS,
	ADV_QUERY_BATCH_RETRY_DELAY_MS,
	ADV_QUERY_INTER_BATCH_DELAY_MS,
} from '@/lib/search-config'
import {
	clearLastPageOnHome,
	getLastPageOnHome,
	getPageSizeFromStorage,
	saveLastPageOnHome,
} from '@/lib/session-storage'
import { sortColumns } from '@/lib/sort-columns'
import type { RowSelectionState } from '@tanstack/react-table'
import { CheckCircle, Clock, RefreshCw, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

const Home = () => {
	const [uploadedData, setUploadedData] = useState<DynamicRecord[]>([])
	const [columnOrder, setColumnOrder] = useState<string[]>([])
	const [uploadedFileName, setUploadedFileName] = useState<string>('')
	const [unifiedSearch, setUnifiedSearch] = useState('')
	const [isProcessing, setIsProcessing] = useState(false)
	const [isParsingFile, setIsParsingFile] = useState(false)
	const [isTransformingData, setIsTransformingData] = useState(false)
	const [isSearching, setIsSearching] = useState(false)
	const [searchStartTime, setSearchStartTime] = useState<Date | null>(null)
	const [searchElapsedTime, setSearchElapsedTime] = useState(0)
	const [currentBatch, setCurrentBatch] = useState(0)
	const [totalBatches, setTotalBatches] = useState(0)
	const [orderby, setOrderby] = useState('bestMatch')
	const [initialLoading, setInitialLoading] = useState(true)
	const [showConfirmReset, setShowConfirmReset] = useState(false)
	const [removedCount, setRemovedCount] = useState<number>(0)
	const [showEmptyRowsModal, setShowEmptyRowsModal] = useState(false)
	const [showResultModal, setShowResultModal] = useState(false)
	const [searchResults, setSearchResults] = useState<{
		successCount: number
		errorCount: number
		cancelled: boolean
	} | null>(null)
	const [isStopping, setIsStopping] = useState(false)
	const [manualUncheckedRows, setManualUncheckedRows] = useState<number[]>([])
	const [recentQueriedRows, setRecentQueriedRows] = useState<number[]>([])
	const abortControllerRef = useRef<AbortController | null>(null)
	const cancelRef = useRef<boolean>(false)

	const orderByOptions = [
		{ label: 'Library', value: 'library' },
		{ label: 'Recency', value: 'recency' },
		{ label: 'Best Match', value: 'bestMatch' },
		{ label: 'Creator', value: 'creator' },
		{ label: 'Publication Date Asc', value: 'publicationDateAsc' },
		{ label: 'Publication Date Desc', value: 'publicationDateDesc' },
		{ label: 'Most Widely Held', value: 'mostWidelyHeld' },
	]

	const [firstSelectedRow, setFirstSelectedRow] = useState<number | null>(null)
	const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
	const [globalFilter, setGlobalFilter] = useState('')

	const searchMutation = useSearchBooks()
	const navigate = useNavigate()
	const [searchParams, setSearchParams] = useSearchParams()
	const { toast } = useToast()

	const APP_TITLE = import.meta.env.VITE_APP_TITLE
	const BATCH_SIZE = Number.parseInt(import.meta.env.VITE_BATCH_SIZE)

	const hasUnprocessedData = uploadedData.length > 0

	// Timer for search progress
	useEffect(() => {
		let interval: NodeJS.Timeout
		if (isSearching && searchStartTime) {
			interval = setInterval(() => {
				const elapsed = Math.floor((Date.now() - searchStartTime.getTime()) / 1000)
				setSearchElapsedTime(elapsed)
			}, 1000)
		}
		return () => clearInterval(interval)
	}, [isSearching, searchStartTime])

	const formatElapsedTime = (seconds: number) => {
		const mins = Math.floor(seconds / 60)
		const secs = seconds % 60
		return `${mins}:${secs.toString().padStart(2, '0')}`
	}

	const loadAdvUnprocessedData = async () => {
		const data = await db.adv_unprocessed.toArray()
		setUploadedData(data)

		// Load column order from localStorage, with fallback to deriving from data
		try {
			const storedOrder = localStorage.getItem('adv_unprocessed_columnOrder')
			if (storedOrder) {
				const parsed = JSON.parse(storedOrder)
				if (Array.isArray(parsed) && parsed.length > 0) {
					setColumnOrder(parsed.filter((c): c is string => typeof c === 'string'))
				} else if (data.length > 0) {
					// Fallback: derive from all records if stored order is invalid
					const allColumns = new Set<string>()
					data.forEach((row) => {
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
			} else if (data.length > 0) {
				// Fallback: derive from all records if no stored order
				const allColumns = new Set<string>()
				data.forEach((row) => {
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
			// Fallback: derive from all records on error
			if (data.length > 0) {
				const allColumns = new Set<string>()
				data.forEach((row) => {
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

		setInitialLoading(false)
	}

	const loadManualUncheckedRows = async () => {
		const uncheckedRows = await db.unchecked_rows.where('table').equals('adv_unprocessed').toArray()
		setManualUncheckedRows(uncheckedRows.map((row) => row.rowId))
	}

	const loadCheckedRows = async () => {
		const checkedRows = await db.checked_rows.where('table').equals('adv_unprocessed').toArray()
		const checkedRowIds = checkedRows.map((row) => row.rowId)
		const restoredSelection: RowSelectionState = {}
		checkedRowIds.forEach((id) => {
			restoredSelection[String(id)] = true
		})
		setRowSelection(restoredSelection)
	}

	const loadRecentQueriedRows = async () => {
		const recentQueriedRows = await db.recent_queried_successful_rows
			.where('table')
			.equals('adv_unprocessed')
			.toArray()
		setRecentQueriedRows(recentQueriedRows.map((row) => row.rowId))
	}

	// Handle page number from URL after data is loaded
	useEffect(() => {
		if (uploadedData.length === 0) {
			return
		}

		const pageParam = searchParams.get('page')
		if (pageParam) {
			const pageNum = Number.parseInt(pageParam, 10)
			const pageSize = getPageSizeFromStorage('homePageSize', 25)
			const totalPages = Math.ceil(uploadedData.length / pageSize)

			let validPage = pageNum
			if (pageNum <= 0 || Number.isNaN(pageNum)) {
				validPage = 1
			} else if (pageNum > totalPages && totalPages > 0) {
				validPage = totalPages
			}

			if (validPage !== pageNum) {
				setSearchParams({ page: String(validPage) }, { replace: true })
			}
		}
	}, [uploadedData.length, searchParams, setSearchParams])

	// Handle return navigation from processed page
	useEffect(() => {
		if (uploadedData.length === 0) {
			return
		}

		const savedPage = getLastPageOnHome()
		if (savedPage !== null) {
			// Clear immediately to prevent multiple navigations
			clearLastPageOnHome()

			// Validate the saved page number
			const homePageSize = getPageSizeFromStorage('homePageSize', 25)
			const totalPages = Math.ceil(uploadedData.length / homePageSize)
			const validPage = Math.min(Math.max(1, savedPage), totalPages > 0 ? totalPages : 1)

			// Only navigate if we're not already on that page
			const currentPageParam = searchParams.get('page')
			const currentPage = currentPageParam ? Number.parseInt(currentPageParam, 10) : 1

			if (validPage !== currentPage) {
				setSearchParams({ page: String(validPage) }, { replace: true })
			}
		}
	}, [uploadedData.length, searchParams, setSearchParams])

	const handlePageChange = (pageIndex: number) => {
		setSearchParams({ page: String(pageIndex + 1) }, { replace: true })
	}

	// Helper function to find first unchecked row on current page
	const findFirstUncheckedRowOnPage = (
		data: DynamicRecord[],
		currentPage: number,
		pageSize: number,
		rowSelection: RowSelectionState,
	): DynamicRecord | null => {
		const startIndex = (currentPage - 1) * pageSize
		const endIndex = Math.min(startIndex + pageSize, data.length)

		for (let i = startIndex; i < endIndex; i++) {
			const row = data[i]
			if (row?.id && !rowSelection[String(row.id)]) {
				return row
			}
		}
		return null
	}

	// Helper function to find nearest unchecked row (forward or backward)
	const findNearestUncheckedRow = (
		data: DynamicRecord[],
		currentPage: number,
		pageSize: number,
		rowSelection: RowSelectionState,
	): DynamicRecord | null => {
		const currentPageStartIndex = (currentPage - 1) * pageSize

		for (let i = currentPageStartIndex + pageSize; i < data.length; i++) {
			const row = data[i]
			if (row?.id && !rowSelection[String(row.id)]) {
				return row
			}
		}

		for (let i = currentPageStartIndex - 1; i >= 0; i--) {
			const row = data[i]
			if (row?.id && !rowSelection[String(row.id)]) {
				return row
			}
		}

		return null
	}

	// Helper function to calculate future page number for a row after processing
	const calculateFuturePageForRow = (
		row: DynamicRecord,
		allData: DynamicRecord[],
		rowsToProcess: DynamicRecord[],
		pageSize: number,
	): number => {
		const currentIndex = allData.findIndex((r) => r.id === row.id)
		if (currentIndex === -1) {
			return 1 // Fallback to page 1
		}

		const rowsToDeleteBefore = rowsToProcess.filter((r) => {
			const rIndex = allData.findIndex((d) => d.id === r.id)
			return rIndex !== -1 && rIndex < currentIndex
		}).length

		const newIndex = currentIndex - rowsToDeleteBefore

		return Math.max(1, Math.ceil((newIndex + 1) / pageSize))
	}

	// Helper function to calculate processed table page before processing, returns the page number where new records will appear after processing
	const calculateProcessedTablePage = async (): Promise<number> => {
		try {
			const existingProcessed = await db.processedData.toArray()
			const processedPageSize = getPageSizeFromStorage('processedPageSize', 25)

			if (existingProcessed.length === 0) {
				return 1
			}

			// Calculate last page number before processing
			const lastPage = Math.ceil(existingProcessed.length / processedPageSize)

			// Check if last page is completely full (no remainder), in that case, new records go to next page (lastPage + 1), otherwise, new records go to last page
			const recordsOnLastPage = existingProcessed.length % processedPageSize
			if (recordsOnLastPage === 0) {
				return lastPage + 1
			}
			return lastPage
		} catch (error) {
			console.error('Error calculating processed table page:', error)
			return 1 // Fallback to page 1
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
	useEffect(() => {
		loadAdvUnprocessedData()
		loadManualUncheckedRows()
		loadCheckedRows()
		loadRecentQueriedRows()
	}, [])

	const handleDataUploaded = async (
		data: DynamicRecord[],
		fileName: string,
		currentRemovedCount?: number,
	) => {
		setIsTransformingData(true)

		try {
			// Clear existing data
			await db.adv_unprocessed.clear()

			// Add IDs to each record if they don't exist
			const dataWithIds = data.map((record, index) => ({
				...record,
				id: record.id || Date.now() + index,
			}))

			// Add to IndexedDB
			await db.adv_unprocessed.bulkAdd(dataWithIds)

			// Load from IndexedDB to ensure consistency
			await loadAdvUnprocessedData()
			setUploadedFileName(fileName)

			// Store removed count for later use
			const actualRemovedCount = currentRemovedCount || 0
			setRemovedCount(actualRemovedCount)

			if (dataWithIds.length > 0) {
				toast({
					title: 'Data uploaded successfully',
					description: `${dataWithIds.length} records loaded. Click "Search All Records" to process your data.`,
				})
			}
		} catch (error) {
			console.error('Data upload error:', error)
			toast({
				title: 'Data upload failed',
				description: 'There was an error uploading your data. Please try again.',
				variant: 'destructive',
			})
		} finally {
			setIsTransformingData(false)
		}
	}

	const handleFileProcessing = (isProcessing: boolean) => {
		setIsParsingFile(isProcessing)
	}

	const handleClearAdvancedData = async () => {
		await db.adv_unprocessed.clear()
		await db.unchecked_rows.where('table').equals('adv_unprocessed').delete()
		await db.checked_rows.where('table').equals('adv_unprocessed').delete()
		localStorage.removeItem('adv_unprocessed_columnOrder')
		setUploadedData([])
		setColumnOrder([])
		setUploadedFileName('')
		setUnifiedSearch('')
		setRowSelection({})
		setGlobalFilter('')
		setShowConfirmReset(false)
		setRemovedCount(0)
		setShowEmptyRowsModal(false)
		setShowResultModal(false)
		setSearchResults(null)
		setManualUncheckedRows([])
	}

	const handleClearFilters = async () => {
		await db.unchecked_rows.where('table').equals('adv_unprocessed').delete()
		await db.checked_rows.where('table').equals('adv_unprocessed').delete()
		setRowSelection({})
		setGlobalFilter('')
		setManualUncheckedRows([])
	}

	const handleDownload = () => {
		try {
			const allColumnKeys = Array.from(
				uploadedData.reduce((cols, row) => {
					Object.keys(row).forEach((k) => {
						if (k !== 'rowId' && k !== 'id' && k !== 'error') {
							cols.add(k)
						}
					})
					return cols
				}, new Set<string>()),
			) as string[]

			const sortedColumns = sortColumns(allColumnKeys, allColumnKeys)

			// Create filtered data with sorted columns
			const filteredData = uploadedData.map((row) => {
				const filteredRow: Record<string, any> = {}
				sortedColumns.forEach((key) => {
					filteredRow[key] = row[key]
				})
				return filteredRow
			})

			const date = new Date().toISOString().split('T')[0]
			const fileName = `unprocessed_data_${date}.xlsx`

			jsonToExcel(filteredData, fileName)

			toast({
				title: 'Download Started',
				description: `${filteredData.length} clean records downloaded.`,
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

	const handleStopSearch = () => {
		if (isSearching && !isStopping) {
			setIsStopping(true)
			cancelRef.current = true
			abortControllerRef.current?.abort()
		}
	}

	const handleProcessRecords = async () => {
		setIsProcessing(true)

		try {
			const selectedRows = uploadedData.filter((row) => rowSelection[String(row.id)])

			const noErrorRows = selectedRows.filter((row) => !row.error)

			if (selectedRows.length === 0) {
				toast({
					title: 'No rows selected',
					description: 'Please select at least one row to process.',
					variant: 'destructive',
				})
				return
			}

			if (noErrorRows.length === 0) {
				toast({
					title: 'No rows selected without errors',
					description: 'Please select at least one row without errors to process.',
					variant: 'destructive',
				})
				return
			}

			const currentPageParam = searchParams.get('page')
			const currentPage = currentPageParam ? Number.parseInt(currentPageParam, 10) : 1
			const homePageSize = getPageSizeFromStorage('homePageSize', 25)

			// Find first unchecked row on current page
			let referenceRow = findFirstUncheckedRowOnPage(
				uploadedData,
				currentPage,
				homePageSize,
				rowSelection,
			)

			// If all rows on current page are selected, find nearest unchecked row
			if (!referenceRow) {
				referenceRow = findNearestUncheckedRow(
					uploadedData,
					currentPage,
					homePageSize,
					rowSelection,
				)
			}

			let futurePage = 1 // Default fallback
			if (referenceRow) {
				futurePage = calculateFuturePageForRow(
					referenceRow,
					uploadedData,
					noErrorRows,
					homePageSize,
				)
			} else {
				futurePage = Math.max(1, currentPage - Math.ceil(noErrorRows.length / homePageSize))
			}

			saveLastPageOnHome(futurePage)

			// Calculate processed table page before processing
			const processedPage = await calculateProcessedTablePage()

			const selectedRowIds = selectedRows
				.map((row) => row.id)
				.filter((id): id is number => id !== undefined)

			await processRows(noErrorRows, selectedRowIds)

			toast({
				title: 'Records processed successfully',
				description: `${noErrorRows.length} records sent for processing`,
			})

			navigate(`/processed?page=${processedPage}`)
		} catch (error) {
			console.error('Processing error:', error)
			toast({
				title: 'Processing failed',
				description: 'There was an error processing your records. Please try again.',
				variant: 'destructive',
			})
		} finally {
			setIsProcessing(false)
		}
	}

	const handleProcessCurrentPageSelected = async (currentPageSelectedRows: DynamicRecord[]) => {
		setIsProcessing(true)

		try {
			const noErrorRows = currentPageSelectedRows.filter((row) => !row.error)

			if (currentPageSelectedRows.length === 0) {
				toast({
					title: 'No rows selected on current page',
					description: 'Please select at least one row on the current page to process.',
					variant: 'destructive',
				})
				return
			}

			if (noErrorRows.length === 0) {
				toast({
					title: 'No rows selected without errors',
					description:
						'Please select at least one row without errors on the current page to process.',
					variant: 'destructive',
				})
				return
			}

			const currentPageParam = searchParams.get('page')
			const currentPage = currentPageParam ? Number.parseInt(currentPageParam, 10) : 1
			const homePageSize = getPageSizeFromStorage('homePageSize', 25)

			// Find first unchecked row on current page
			let referenceRow = findFirstUncheckedRowOnPage(
				uploadedData,
				currentPage,
				homePageSize,
				rowSelection,
			)

			// If all rows on current page are selected, find nearest unchecked row
			if (!referenceRow) {
				referenceRow = findNearestUncheckedRow(
					uploadedData,
					currentPage,
					homePageSize,
					rowSelection,
				)
			}

			let futurePage = 1 // Default fallback
			if (referenceRow) {
				futurePage = calculateFuturePageForRow(
					referenceRow,
					uploadedData,
					noErrorRows,
					homePageSize,
				)
			} else {
				futurePage = Math.max(1, currentPage - Math.ceil(noErrorRows.length / homePageSize))
			}

			saveLastPageOnHome(futurePage)

			// Calculate processed table page BEFORE processing
			const processedPage = await calculateProcessedTablePage()

			const selectedRowIds = currentPageSelectedRows
				.map((row) => row.id)
				.filter((id): id is number => id !== undefined)

			await processRows(noErrorRows, selectedRowIds)

			toast({
				title: 'Current page records processed successfully',
				description: `${noErrorRows.length} records from current page sent for processing`,
			})

			navigate(`/processed?page=${processedPage}`)
		} catch (error) {
			console.error('Processing error:', error)
			toast({
				title: 'Processing failed',
				description: 'There was an error processing your records. Please try again.',
				variant: 'destructive',
			})
		} finally {
			setIsProcessing(false)
		}
	}

	const processRows = async (rowsToProcess: DynamicRecord[], allSelectedRowIds: number[]) => {
		const processedRecords = rowsToProcess.map((row) => {
			const filtered: Record<string, unknown> = {}
			Object.keys(row).forEach((key) => {
				if (key !== 'id') {
					filtered[key] = row[key]
				}
			})
			return filtered
		})

		// Add to processedData
		await db.processedData.bulkAdd(processedRecords)

		const existingProcessedOrder = localStorage.getItem('processed_columnOrder')
		if (!existingProcessedOrder) {
			const originalColumnOrder = localStorage.getItem('adv_unprocessed_columnOrder')
			if (originalColumnOrder) {
				localStorage.setItem('processed_columnOrder', originalColumnOrder)
			}
		}

		const idsToDelete = rowsToProcess
			.map((row) => row.id)
			.filter((id): id is number => id !== undefined)

		if (idsToDelete.length > 0) {
			await db.adv_unprocessed.bulkDelete(idsToDelete)
		}

		// Remove all selected rows (including errored) from checked_rows table
		if (allSelectedRowIds.length > 0) {
			await db.checked_rows
				.where('table')
				.equals('adv_unprocessed')
				.and((row) => allSelectedRowIds.includes(row.rowId))
				.delete()
		}
	}

	const handleUnifiedSearch = async () => {
		cancelRef.current = false
		abortControllerRef.current = new AbortController()
		setIsStopping(false)
		const selectedRowIds = Object.keys(rowSelection)
			.filter((key) => rowSelection[key])
			.map((id) => Number(id))
			.filter((id) => !Number.isNaN(id))

		const selectedRows = uploadedData.filter((row) => row.id && selectedRowIds.includes(row.id))

		if (selectedRows.length === 0) {
			toast({
				title: 'Selection Required',
				description: 'Please select at least 1 row to search.',
				variant: 'destructive',
			})
			return
		}

		const calculatedTotalBatches = Math.ceil(selectedRows.length / BATCH_SIZE)

		setIsSearching(true)
		setSearchStartTime(new Date())
		setSearchElapsedTime(0)
		setCurrentBatch(0)
		setTotalBatches(calculatedTotalBatches)

		try {
			const searchData = {
				appendSearchQuery: unifiedSearch,
				sortingOrder: orderby,
				batchSize: BATCH_SIZE.toString(),
				onBatchProgress: (current: number, total: number) => {
					setCurrentBatch(current)
					setTotalBatches(total)
				},
				onBatchResult: async ({
					batchIndex,
					totalBatches,
					response,
				}: {
					batchIndex: number
					totalBatches: number
					response: SearchResponse
				}) => {
					if (!response?.books?.length) {
						return
					}
					const working = await db.adv_unprocessed.toArray()
					const updates = []
					for (const updatedBook of response.books) {
						const existing = working.find((r) => r.rowId === updatedBook.rowId)
						if (existing) {
							const error = updatedBook.error?.trim() || null
							updates.push({ ...existing, ...updatedBook, error })
						}
					}
					if (updates.length > 0) {
						await db.adv_unprocessed.bulkPut(updates)

						// Remove from unchecked_rows when rows are searched
						const rowIdsToRemoveFromUnchecked: number[] = []
						for (const updatedBook of response.books) {
							const existing = working.find((r) => r.rowId === updatedBook.rowId)
							if (existing?.id) {
								rowIdsToRemoveFromUnchecked.push(existing.id)
							}
						}

						if (rowIdsToRemoveFromUnchecked.length > 0) {
							await db.unchecked_rows
								.where('table')
								.equals('adv_unprocessed')
								.and((r) => rowIdsToRemoveFromUnchecked.includes(r.rowId))
								.delete()
							setManualUncheckedRows((prev) =>
								prev.filter((id) => !rowIdsToRemoveFromUnchecked.includes(id)),
							)
						}

						setUploadedData((prev) =>
							prev.map((row) => {
								const updatedBook = response.books.find(
									(b: { rowId: number }) => b.rowId === row.rowId,
								)
								if (updatedBook) {
									const error = updatedBook.error?.trim() || null
									return { ...row, ...updatedBook, error }
								}
								return row
							}),
						)
					}
					setCurrentBatch(batchIndex)
					setTotalBatches(totalBatches)
				},
				enableRetry: true,
				retryAttempts: ADV_QUERY_BATCH_RETRY_ATTEMPTS,
				retryDelayMs: ADV_QUERY_BATCH_RETRY_DELAY_MS,
				interBatchDelayMs: ADV_QUERY_INTER_BATCH_DELAY_MS,
				abortSignal: abortControllerRef.current.signal,
				shouldCancelRef: cancelRef,
				books: selectedRows.map((row) => ({
					rowId: row.rowId,
					...Object.fromEntries(
						Object.keys(row)
							.filter(
								(col) =>
									col &&
									col !== 'select' &&
									col !== 'id' &&
									col !== 'rowId' &&
									col !== 'error' &&
									col !== 'oclc_number' &&
									!col.endsWith('_new') &&
									!col.startsWith('!'),
							)
							.map((col) => [col, row[col]]),
					),
				})),
				isRefining: true,
			}

			const result = await searchMutation.mutateAsync(searchData)

			// Update data with search results while preserving IDs
			const updatedData = uploadedData.map((row) => {
				const updatedBook = result.books.find((book) => book.rowId === row.rowId)
				if (updatedBook) {
					const error = updatedBook.error?.trim() || null
					return { ...row, ...updatedBook, error }
				}
				return row
			})

			// Update IndexedDB
			await db.adv_unprocessed.clear()
			await db.adv_unprocessed.bulkAdd(updatedData)

			// Load from IndexedDB to ensure consistency
			await loadAdvUnprocessedData()

			const successCount = result.books.filter((book) => !book?.error?.trim()).length
			const errorCount = result.books.filter((book) => book?.error?.trim()).length

			setSearchResults({
				successCount,
				errorCount,
				cancelled: result.cancelled || false,
			})

			// Clear all previous recent queried successful rows and add new successful ones
			await db.recent_queried_successful_rows.where('table').equals('adv_unprocessed').delete()
			const successfulRows = result.books.filter((book) => !book?.error?.trim())
			if (successfulRows.length > 0) {
				const working = await db.adv_unprocessed.toArray()
				const newRecentQueriedSuccessfulRows = successfulRows
					.map((book) => {
						const existing = working.find((r) => r.rowId === book.rowId)
						return existing?.id ? { rowId: existing.id, table: 'adv_unprocessed' } : null
					})
					.filter((row): row is { rowId: number; table: string } => row !== null)

				if (newRecentQueriedSuccessfulRows.length > 0) {
					await db.recent_queried_successful_rows.bulkAdd(newRecentQueriedSuccessfulRows)
					setRecentQueriedRows(newRecentQueriedSuccessfulRows.map((row) => row.rowId))
				} else {
					setRecentQueriedRows([])
				}
			} else {
				setRecentQueriedRows([])
			}

			if (removedCount > 0) {
				setShowEmptyRowsModal(true)
			} else {
				setShowResultModal(true)
			}
		} catch (error) {
			console.error('Search error:', error)
			if (cancelRef.current || abortControllerRef.current?.signal.aborted) {
				toast({
					title: 'Search stopped',
					description: 'You cancelled the search. No further requests were made.',
				})
				// When search is stopped, we still want to save successful rows from batches that completed
				// Get all rows that were successfully updated (no error) from uploadedData
				const working = await db.adv_unprocessed.toArray()
				const successfulRowIds = working
					.filter((row) => {
						return selectedRows.some((sr) => sr.rowId === row.rowId) && !row.error
					})
					.map((row) => row.id!)
					.filter((id): id is number => id !== undefined)

				if (successfulRowIds.length > 0) {
					await db.recent_queried_successful_rows.where('table').equals('adv_unprocessed').delete()
					const newRecentQueriedSuccessfulRows = successfulRowIds.map((rowId) => ({
						rowId,
						table: 'adv_unprocessed',
					}))
					await db.recent_queried_successful_rows.bulkAdd(newRecentQueriedSuccessfulRows)
					setRecentQueriedRows(successfulRowIds)
				} else {
					await db.recent_queried_successful_rows.where('table').equals('adv_unprocessed').delete()
					setRecentQueriedRows([])
				}
			} else {
				toast({
					title: 'Search failed',
					description: 'There was an error performing the search. Please try again.',
					variant: 'destructive',
				})
				// On error, clear recent queried successful rows
				await db.recent_queried_successful_rows.where('table').equals('adv_unprocessed').delete()
				setRecentQueriedRows([])
			}
		} finally {
			setIsSearching(false)
			setSearchStartTime(null)
			setSearchElapsedTime(0)
			setCurrentBatch(0)
			setTotalBatches(0)
			setIsStopping(false)
			abortControllerRef.current = null
		}
	}

	const generateProcessedQuery = (searchQuery: string) => {
		if (firstSelectedRow === null) {
			return searchQuery
		}

		const selectedRow = uploadedData[firstSelectedRow]
		if (!selectedRow) {
			return searchQuery
		}

		let processedQuery = searchQuery

		// ti:{} or ti={} format - replace {} with value from the column
		if (searchQuery.includes('{}')) {
			// Look for patterns like "ti:{}" or "pn={}" etc. (supports ':' and '=' operators)
			const emptyPlaceholderRegex = /(\w+)\s*([:=])\s*\{\s*\}/g

			// Replace empty placeholders like "ti:{}" with "ti:value" while preserving operator
			processedQuery = processedQuery.replace(emptyPlaceholderRegex, (_, columnName, operator) => {
				const columnValue = selectedRow?.[columnName] ?? ''
				const replacement = columnValue ? String(columnValue).trim() : ''
				return `${columnName}${operator}${replacement}`
			})

			const namedPlaceholderRegex = /(\w+)\s*([:=])\s*\{([^}]+)\}/g
			processedQuery = processedQuery.replace(
				namedPlaceholderRegex,
				(_, prefix, operator, columnName) => {
					const columnValue = selectedRow?.[columnName] ?? ''
					const replacement = columnValue ? String(columnValue).trim() : ''
					return `${prefix}${operator}${replacement}`
				},
			)
		}

		if (globalFilter && !processedQuery.includes(globalFilter)) {
			processedQuery += ` ${globalFilter}`
		}

		return processedQuery.trim()
	}

	const generateOclcQuery = () => {
		if (firstSelectedRow === null) {
			return null
		}

		const selectedRow = uploadedData[firstSelectedRow]
		if (!selectedRow) {
			return null
		}

		if (unifiedSearch) {
			const processedQuery = generateProcessedQuery(unifiedSearch)
			if (processedQuery) {
				return `https://metadata.api.oclc.org/worldcat/search/brief-bibs?q=${processedQuery}`
			}
		}

		return null
	}

	const queryString = generateOclcQuery()

	const selectedRowCount = Object.values(rowSelection).filter((bool) => bool === true).length

	const handleRowSelectionChange = async (
		updaterOrValue: RowSelectionState | ((old: RowSelectionState) => RowSelectionState),
		source: 'individual' | 'bulk' = 'individual',
	) => {
		const currentSelection = rowSelection
		const newSelection =
			typeof updaterOrValue === 'function' ? updaterOrValue(currentSelection) : updaterOrValue

		// Handle individual row changes vs bulk operations based on source
		const changedRows: { id: number; wasChecked: boolean; nowChecked: boolean }[] = []
		Object.keys({ ...currentSelection, ...newSelection }).forEach((key) => {
			const id = Number(key)
			const wasChecked = currentSelection[key] || false
			const nowChecked = newSelection[key] || false
			if (wasChecked !== nowChecked) {
				changedRows.push({ id, wasChecked, nowChecked })
			}
		})

		const isBulkOperation = source === 'bulk'
		const newlyUnchecked: number[] = []
		const newlyChecked: number[] = []

		if (isBulkOperation) {
			const allKeys = new Set([...Object.keys(currentSelection), ...Object.keys(newSelection)])
			allKeys.forEach((key) => {
				const id = Number(key)
				const wasChecked = currentSelection[key] || false
				const nowChecked = newSelection[key] || false
				if (wasChecked && !nowChecked) {
					newlyUnchecked.push(id)
				} else if (!wasChecked && nowChecked) {
					newlyChecked.push(id)
				}
			})
		} else {
			changedRows.forEach(({ id, wasChecked, nowChecked }) => {
				if (wasChecked && !nowChecked) {
					newlyUnchecked.push(id)
				} else if (!wasChecked && nowChecked) {
					newlyChecked.push(id)
				}
			})
		}

		if (newlyUnchecked.length > 0) {
			// Remove from checked_rows table when unchecked
			await db.checked_rows
				.where('table')
				.equals('adv_unprocessed')
				.and((row) => newlyUnchecked.includes(row.rowId))
				.delete()

			// Remove from recent_queried_successful_rows (for both individual and bulk operations)
			await db.recent_queried_successful_rows
				.where('table')
				.equals('adv_unprocessed')
				.and((row) => newlyUnchecked.includes(row.rowId))
				.delete()
			setRecentQueriedRows((prev) => prev.filter((id) => !newlyUnchecked.includes(id)))

			if (!isBulkOperation) {
				const rowsNotInRecentQueried = newlyUnchecked.filter(
					(rowId) => !recentQueriedRows.includes(rowId),
				)

				// Filter out errored rows - they shouldn't get yellow background
				const rowsWithoutErrors = rowsNotInRecentQueried.filter((rowId) => {
					const row = uploadedData.find((r) => r.id === rowId)
					return row && !row.error
				})

				if (rowsWithoutErrors.length > 0) {
					const existingUnchecked = await db.unchecked_rows
						.where('table')
						.equals('adv_unprocessed')
						.and((row) => rowsWithoutErrors.includes(row.rowId))
						.toArray()

					const existingRowIds = new Set(existingUnchecked.map((row) => row.rowId))
					const newRowsToAdd = rowsWithoutErrors
						.filter((rowId) => !existingRowIds.has(rowId))
						.map((rowId) => ({
							rowId,
							table: 'adv_unprocessed',
						}))

					if (newRowsToAdd.length > 0) {
						await db.unchecked_rows.bulkAdd(newRowsToAdd)
					}

					setManualUncheckedRows((prev) => [...new Set([...prev, ...rowsWithoutErrors])])
				}
			}
		}

		if (newlyChecked.length > 0) {
			const existingChecked = await db.checked_rows
				.where('table')
				.equals('adv_unprocessed')
				.and((row) => newlyChecked.includes(row.rowId))
				.toArray()

			const existingCheckedRowIds = new Set(existingChecked.map((row) => row.rowId))
			const newCheckedRowsToAdd = newlyChecked
				.filter((rowId) => !existingCheckedRowIds.has(rowId))
				.map((rowId) => ({
					rowId,
					table: 'adv_unprocessed',
				}))

			if (newCheckedRowsToAdd.length > 0) {
				await db.checked_rows.bulkAdd(newCheckedRowsToAdd)
			}

			// Remove from unchecked_rows table when checked (for both individual and bulk)
			await db.unchecked_rows
				.where('table')
				.equals('adv_unprocessed')
				.and((row) => newlyChecked.includes(row.rowId))
				.delete()

			setManualUncheckedRows((prev) => prev.filter((id) => !newlyChecked.includes(id)))
		}

		setRowSelection(newSelection)
	}

	const isLoading = isParsingFile || isTransformingData || searchMutation.isPending

	if (initialLoading) {
		return (
			<div className='flex items-center justify-center min-h-[40vh]'>
				<div className='animate-spin rounded-full h-10 w-10 border-b-2 border-primary' />
			</div>
		)
	}

	return (
		<div className='container mx-auto px-4 py-8 space-y-8'>
			{!hasUnprocessedData && !uploadedFileName && (
				<div className='text-center space-y-2'>
					<h1 className='text-3xl font-bold tracking-tight'>{APP_TITLE}</h1>
					<p className='text-muted-foreground'>
						Upload, process, and manage your library records with ease
					</p>
				</div>
			)}

			{!hasUnprocessedData && !uploadedFileName && (
				<ExcelUpload
					onDataUploaded={handleDataUploaded}
					onFileProcessing={handleFileProcessing}
					orderby={orderby}
					setOrderby={setOrderby}
					orderByOptions={orderByOptions}
				/>
			)}

			{hasUnprocessedData && (
				<div className='grid grid-cols-1 lg:grid-cols-4 gap-6 lg:gap-0 lg:space-x-6'>
					<div className='lg:col-span-3'>
						<Card className='h-full'>
							<CardHeader className='flex w-full'>
								<div className='w-full flex justify-between items-center gap-3 flex-wrap'>
									<CardTitle className='flex items-center space-x-2'>
										<Search className='h-5 w-5' />
										<span>Search Records</span>
									</CardTitle>
									<Select defaultValue={orderby} onValueChange={(value) => setOrderby(value)}>
										<SelectGroup>
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
							</CardHeader>
							<CardContent className='flex flex-col h-full gap-4'>
								<div className='text-xs text-muted-foreground mb-2'>
									Use ti:{'{}'} to insert title value, yr:{'{}'} for year, etc. (see API call
									preview below)
								</div>
								<div className='gap-4 flex flex-col lg:flex-row justify-between'>
									<Input
										placeholder='Search query (e.g. ti:{} AND pn:{} NOT yr:2023)'
										value={unifiedSearch}
										onChange={(e) => setUnifiedSearch(e.target.value)}
									/>
									<Button
										className='w-full lg:w-auto lg:min-w-48'
										disabled={isSearching || selectedRowCount === 0}
										onClick={handleUnifiedSearch}
									>
										<Search className='h-4 w-4 mr-2' />
										{isSearching ? 'Searching...' : 'Search Records'}
									</Button>
								</div>
								{isSearching ? (
									<div className='text-xs text-amber-600 bg-amber-50 p-2 rounded'>
										Please keep this tab open and wait for the process to finish.
									</div>
								) : selectedRowCount > 0 ? (
									<ScrollArea className='h-10 w-full rounded-md'>
										<div className='text-sm text-muted-foreground'>
											<span className='whitespace-pre-wrap break-words'>
												{queryString ||
													'https://metadata.api.oclc.org/worldcat/search/brief-bibs?q='}
											</span>
										</div>
									</ScrollArea>
								) : null}
							</CardContent>
						</Card>
					</div>

					<div className='lg:col-span-1'>
						<Card className='h-full'>
							<CardHeader className='flex w-full'>
								<div className='flex items-center space-x-2 w-full justify-between'>
									<CardTitle className='text-lg'>Actions</CardTitle>
									<Button variant='outline' size={'sm'} onClick={handleClearFilters}>
										Clear Filters
									</Button>
								</div>
							</CardHeader>
							<CardContent className='flex flex-col gap-4 h-full'>
								<Button
									variant='outline'
									className='w-full'
									onClick={() => setShowConfirmReset(true)}
								>
									<RefreshCw className='h-4 w-4 mr-2' />
									Clear This Table
								</Button>

								<Button
									className='w-full'
									onClick={handleProcessRecords}
									disabled={selectedRowCount === 0}
								>
									Process Selected ({selectedRowCount} rows)
								</Button>
							</CardContent>
						</Card>
					</div>
				</div>
			)}

			{/* Data Table Section - Show if file uploaded or unprocessedData exists */}
			{(hasUnprocessedData || isParsingFile) && (
				<BookDataTable
					data={uploadedData}
					columnOrder={columnOrder}
					isLoading={isLoading}
					showPagination={true}
					pageSize={25}
					rowSelection={rowSelection}
					setRowSelection={handleRowSelectionChange}
					globalFilter={globalFilter}
					setGlobalFilter={setGlobalFilter}
					unifiedSearch={unifiedSearch}
					setFirstSelectedRow={setFirstSelectedRow}
					firstSelectedRow={firstSelectedRow}
					manualUncheckedRows={manualUncheckedRows}
					onDownload={handleDownload}
					onProcessCurrentPage={handleProcessCurrentPageSelected}
					onPageChange={handlePageChange}
					initialPageIndex={(() => {
						const pageParam = searchParams.get('page')
						if (pageParam) {
							const pageNum = Number.parseInt(pageParam, 10)
							const pageSize = getPageSizeFromStorage('homePageSize', 25)
							const totalPages = Math.ceil(uploadedData.length / pageSize)
							if (
								pageNum > 0 &&
								!Number.isNaN(pageNum) &&
								pageNum <= totalPages &&
								totalPages > 0
							) {
								return pageNum - 1
							}
						}
						return 0
					})()}
				/>
			)}

			{/* Long-running search progress modal */}
			{isSearching && (
				<div className='fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50'>
					<Card className='max-w-md w-full shadow-xl border'>
						<CardContent className='p-6'>
							<div className='flex flex-col items-center space-y-4'>
								<div className='animate-spin rounded-full h-12 w-12 border-b-2 border-primary' />
								<div className='text-center space-y-2'>
									<h3 className='text-lg font-semibold'>Searching Books</h3>
									<p className='text-sm text-muted-foreground'>
										Please wait while we search for your books.
									</p>
									{totalBatches > 1 && (
										<div className='text-sm font-medium text-primary'>
											Batch {currentBatch} of {totalBatches}
										</div>
									)}
									<div className='flex items-center justify-center space-x-2 text-sm text-muted-foreground'>
										<Clock className='h-4 w-4' />
										<span>Elapsed time: {formatElapsedTime(searchElapsedTime)}</span>
									</div>
									<div className='text-xs text-amber-600 bg-amber-50 p-2 rounded mt-2'>
										⚠️ Please keep this tab open and do not close your browser during the search
										process.
									</div>
									<div className='mt-4'>
										<Button variant='destructive' onClick={handleStopSearch} disabled={isStopping}>
											{isStopping ? 'Stopping…' : 'Stop Search'}
										</Button>
									</div>
								</div>
							</div>
						</CardContent>
					</Card>
				</div>
			)}

			{isProcessing && (
				<div className='fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50'>
					<Card>
						<CardContent className='p-6'>
							<div className='flex items-center space-x-4'>
								<div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary' />
								<div>
									<h3 className='font-semibold'>Processing Records</h3>
									<p className='text-sm text-muted-foreground'>
										Please wait while we process your selected records...
									</p>
								</div>
							</div>
						</CardContent>
					</Card>
				</div>
			)}

			{showConfirmReset && (
				<div className='fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm'>
					<Card className='max-w-md w-full shadow-xl border'>
						<CardHeader>
							<CardTitle>Clear Query data?</CardTitle>
						</CardHeader>
						<CardContent className='space-y-4'>
							<p className='text-muted-foreground'>
								This action cannot be undone. Are you sure you want to clear query data?
							</p>
							<div className='flex gap-2 justify-end'>
								<Button variant='outline' onClick={() => setShowConfirmReset(false)}>
									Cancel
								</Button>
								<Button variant='destructive' onClick={handleClearAdvancedData}>
									Clear
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>
			)}

			{showEmptyRowsModal && (
				<div className='fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50'>
					<Card className='max-w-md w-full shadow-xl border'>
						<CardContent className='p-6'>
							<div className='flex flex-col items-center space-y-4'>
								<div className='flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/20'>
									<p className='text-2xl'>⚠️</p>
								</div>
								<div className='text-center space-y-2'>
									<h3 className='text-lg font-semibold'>Search Completed</h3>
									<p className='text-sm text-muted-foreground'>
										We detected and automatically removed{' '}
										<span className='font-semibold text-foreground'>{removedCount}</span> empty rows
										from your uploaded Excel file to ensure clean data processing.
									</p>
									<div className='bg-muted/50 rounded-lg p-4 space-y-2 mt-4'>
										<div className='flex items-center justify-between text-sm'>
											<span className='text-muted-foreground'>Original rows:</span>
											<span className='font-medium'>{uploadedData.length + removedCount}</span>
										</div>
										<div className='flex items-center justify-between text-sm'>
											<span className='text-muted-foreground'>Rows processed:</span>
											<span className='font-medium'>{uploadedData.length}</span>
										</div>
										<div className='flex items-center justify-between text-sm'>
											<span className='text-muted-foreground'>Empty rows removed:</span>
											<span className='font-medium text-amber-600 dark:text-amber-400'>
												{removedCount}
											</span>
										</div>
										{searchResults && (
											<div className='border-t pt-2 mt-2'>
												<div className='flex items-center justify-between text-sm'>
													<span className='text-muted-foreground'>Successful searches:</span>
													<span className='font-medium text-green-600 dark:text-green-400'>
														{searchResults.successCount}
													</span>
												</div>
												<div className='flex items-center justify-between text-sm'>
													<span className='text-muted-foreground'>Errors:</span>
													<span className='font-medium text-red-600 dark:text-red-400'>
														{searchResults.errorCount}
													</span>
												</div>
												{searchResults.cancelled && (
													<div className='text-xs text-blue-600 dark:text-blue-400 mt-2'>
														Search was cancelled by user. Results are partial.
													</div>
												)}
											</div>
										)}
									</div>
									<div className='text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800 mt-4'>
										💡 <strong>Tip:</strong> This improves search accuracy and reduces processing
										time by removing unnecessary data.
									</div>
								</div>
								<Button
									onClick={() => {
										setShowEmptyRowsModal(false)
										setSearchResults(null)
									}}
									className='w-full'
								>
									Got it
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>
			)}

			{showResultModal && searchResults && (
				<div className='fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50'>
					<Card className='max-w-sm w-full shadow-xl border'>
						<CardContent className='p-6'>
							<div className='flex flex-col items-center space-y-4'>
								<div className='flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/20'>
									<CheckCircle className='w-6 h-6 text-green-600 dark:text-green-400' />
								</div>
								<div className='text-center space-y-2'>
									<h3 className='text-lg font-semibold'>
										{searchResults.cancelled ? 'Search Stopped' : 'Search Completed'}
									</h3>
									<p className='text-sm text-muted-foreground'>
										{searchResults.cancelled
											? 'You cancelled the search. Partial results have been applied.'
											: 'Your search has completed successfully.'}
									</p>
									<div className='bg-muted/50 rounded-lg p-4 space-y-2 mt-4'>
										<div className='flex items-center justify-between text-sm'>
											<span className='text-muted-foreground'>Successful searches:</span>
											<span className='font-medium text-green-600 dark:text-green-400'>
												{searchResults.successCount}
											</span>
										</div>
										<div className='flex items-center justify-between text-sm'>
											<span className='text-muted-foreground'>Errors:</span>
											<span className='font-medium text-red-600 dark:text-red-400'>
												{searchResults.errorCount}
											</span>
										</div>
									</div>
								</div>
								<Button
									onClick={() => {
										setShowResultModal(false)
										setSearchResults(null)
									}}
									className='w-full'
								>
									Close
								</Button>
							</div>
						</CardContent>
					</Card>
				</div>
			)}
		</div>
	)
}

export default Home
