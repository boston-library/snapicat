import styles from '@/components/styles/custom-scrollbar.module.css'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from '@/components/ui/pagination'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { getPageSizeFromStorage, savePageSizeToStorage } from '@/lib/session-storage'
import { sortColumns } from '@/lib/sort-columns'
import { cn } from '@/lib/utils'
import {
	type ColumnDef,
	type RowSelectionState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	useReactTable,
} from '@tanstack/react-table'
import { Loader2 } from 'lucide-react'
import React, { useMemo } from 'react'
import { Switch } from './ui/switch'

interface BookRecord {
	oclc_number?: string
	title?: string
	year?: string
	isbn?: string
	publisher?: string
	languageOfCataloging?: string
	language?: string
	materialType?: string
	countryOfPublication?: string
	subject?: string
	descriptionConventions?: string
	keyword?: string
	[key: string]: any
}

interface BookDataTableProps {
	data: BookRecord[]
	columnOrder?: string[]
	isLoading?: boolean
	showPagination?: boolean
	pageSize?: number
	rowSelection: RowSelectionState
	setRowSelection: (
		selection: RowSelectionState | ((old: RowSelectionState) => RowSelectionState),
		source?: 'individual' | 'bulk',
	) => void
	globalFilter: string
	setGlobalFilter: (filter: string) => void
	unifiedSearch: string
	setFirstSelectedRow: React.Dispatch<React.SetStateAction<number | null>>
	firstSelectedRow: number | null
	manualUncheckedRows?: number[]
	onDownload?: () => void
	onProcessCurrentPage?: (currentPageSelectedRows: BookRecord[]) => void
	onPageChange?: (pageIndex: number) => void
	initialPageIndex?: number
}

const BookDataTable = ({
	data,
	columnOrder,
	isLoading = false,
	showPagination = true,
	pageSize = 25,
	rowSelection,
	setRowSelection,
	globalFilter,
	setGlobalFilter,
	setFirstSelectedRow,
	manualUncheckedRows = [],
	onDownload,
	onProcessCurrentPage,
	onPageChange,
	initialPageIndex = 0,
}: BookDataTableProps) => {
	const [currentPageSize, setCurrentPageSize] = React.useState(() => {
		return getPageSizeFromStorage('homePageSize', pageSize)
	})
	const [pageIndex, setPageIndex] = React.useState(initialPageIndex)

	React.useEffect(() => {
		setPageIndex(initialPageIndex)
	}, [initialPageIndex])

	const selectionOrderRef = React.useRef<number[]>([])
	const pageIndexRef = React.useRef(0)

	// Refs and state to support a synchronized top horizontal scrollbar
	const topScrollRef = React.useRef<HTMLDivElement | null>(null)
	const bottomScrollRef = React.useRef<HTMLDivElement | null>(null)
	const tableRef = React.useRef<HTMLTableElement | null>(null)
	const isSyncingRef = React.useRef(false)
	const [scrollSpacerWidth, setScrollSpacerWidth] = React.useState(0)

	const [withOclcNumber, setWithOclcNumber] = React.useState(false)

	const handleToggleOclcNumber = React.useCallback(
		(newValue: boolean) => {
			if (newValue && !withOclcNumber) {
				setRowSelection((prevSelection) => {
					const newSelection: RowSelectionState = { ...prevSelection }
					let hasChanges = false
					data.forEach((row) => {
						const hasOclcNumber = row.oclc_number && row.oclc_number.trim() !== ''
						const hasErrorProperty = 'error' in row

						if (!hasOclcNumber && hasErrorProperty) {
							const rowId = String(row.id)
							if (newSelection[rowId]) {
								delete newSelection[rowId]
								hasChanges = true
							}
						}
					})

					return hasChanges ? newSelection : prevSelection
				}, 'bulk')
			}
			setWithOclcNumber(newValue)
		},
		[withOclcNumber, data, setRowSelection],
	)

	const rowsWithoclcNumber = useMemo(() => {
		return (
			data?.filter(
				(row) => (row.oclc_number && row.oclc_number.trim() !== '') || !('error' in row),
			) || []
		)
	}, [data])
	const hasoclcNumberInAnyRow = useMemo(() => {
		return data.some((row) => row.oclc_number && row.oclc_number.trim() !== '')
	}, [data])
	const hasErrorFieldInAnyRow = useMemo(() => {
		return data.some((row) => 'error' in row && row.error !== null)
	}, [data])

	React.useEffect(() => {
		const selectedIds = Object.keys(rowSelection)
			.filter((key) => rowSelection[key])
			.map((key) => Number.parseInt(key))
			.filter((id) => !Number.isNaN(id))

		const selectedIndices = selectedIds
			.map((id) => data.findIndex((row) => row.id === id))
			.filter((index) => index !== -1)

		selectedIndices.forEach((index) => {
			if (!selectionOrderRef.current.includes(index)) {
				selectionOrderRef.current.push(index)
			}
		})

		selectionOrderRef.current = selectionOrderRef.current.filter((index) =>
			selectedIndices.includes(index),
		)

		setFirstSelectedRow(selectionOrderRef.current[0] ?? null)
	}, [rowSelection, data, setFirstSelectedRow])

	const columnKeysRef = React.useRef<string[]>([])
	const columnKeys = React.useMemo(() => {
		if (data.length === 0) {
			return []
		}

		let allColumnKeys: string[] = []

		if (Array.isArray(columnOrder) && columnOrder.length > 0) {
			const existingColumns = new Set<string>()
			data.forEach((row) => {
				Object.keys(row).forEach((k) => {
					if (k !== 'rowId' && k !== 'id') {
						existingColumns.add(k)
					}
				})
			})

			allColumnKeys = columnOrder.filter((col) => existingColumns.has(col))
			existingColumns.forEach((col) => {
				if (!allColumnKeys.includes(col)) {
					allColumnKeys.push(col)
				}
			})
		} else {
			const columnSet = new Set<string>()
			data.forEach((row) => {
				Object.keys(row).forEach((k) => {
					if (k !== 'rowId' && k !== 'id' && !columnSet.has(k)) {
						columnSet.add(k)
						allColumnKeys.push(k)
					}
				})
			})
		}

		const filteredColumnKeys = allColumnKeys.filter((col) => {
			return data.some((row) => {
				const value = row[col]
				return value !== null && value !== undefined && String(value).trim() !== ''
			})
		})

		const keysStr = JSON.stringify([...filteredColumnKeys].sort())
		const prevKeysStr = JSON.stringify([...columnKeysRef.current].sort())

		if (keysStr !== prevKeysStr) {
			columnKeysRef.current = filteredColumnKeys
		}

		return columnKeysRef.current
	}, [data, columnOrder])

	const columns = useMemo<ColumnDef<BookRecord>[]>(() => {
		if (data.length === 0 || columnKeys.length === 0) {
			return []
		}

		// Pass columnOrder as originalOrder to sortColumns so it preserves order of Excel columns
		const sortedColumns = sortColumns(columnKeys, columnOrder || columnKeys)

		return [
			{
				id: 'select',
				header: ({ table }) => (
					<Checkbox
						checked={table.getIsAllRowsSelected()}
						onCheckedChange={(value) => {
							const newSelection: RowSelectionState = {}
							const tableData = withOclcNumber ? rowsWithoclcNumber : data
							tableData.forEach((row) => {
								const rowId = String(row.id)
								newSelection[rowId] = !!value
							})
							setRowSelection(newSelection, 'bulk')
						}}
						aria-label='Select all'
						className='dark:border-[#4b5a6f]'
					/>
				),
				cell: ({ row }) => (
					<Checkbox
						checked={row.getIsSelected()}
						onCheckedChange={(value) => row.toggleSelected(!!value)}
						aria-label='Select row'
						className='dark:border-[#4b5a6f]'
					/>
				),
				enableSorting: false,
				enableHiding: false,
				size: 40,
			},
			...sortedColumns.map((key) => ({
				accessorKey: key,
				header: () => <span className='text-xs font-medium truncate'>{key}</span>,
				cell: ({ getValue }: { getValue: () => any }) => (
					<div
						className='text-overflow whitespace-nowrap max-w-80 overflow-y-auto overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]'
						title={String(getValue() || '')}
					>
						{String(getValue() || '')}
					</div>
				),
			})),
		]
	}, [data, setRowSelection, withOclcNumber, rowsWithoclcNumber, columnKeys, columnOrder])

	const dataContentHash = React.useMemo(() => {
		if (data.length === 0) {
			return 'empty'
		}
		return data
			.map((row, idx) => {
				// Include a hash of key fields that commonly change during search
				const keyFields = ['oclc_number', 'error', 'rowId']
				const contentSample = keyFields.map((k) => `${k}:${String(row[k] || '')}`).join('|')
				return `${row.id || idx}-${contentSample}`
			})
			.join('|')
	}, [data])

	const stableData = React.useMemo(() => data, [dataContentHash])

	const table = useReactTable({
		data: withOclcNumber ? rowsWithoclcNumber : stableData,
		columns,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		getRowId: (row) => {
			return String(row.id)
		},
		onRowSelectionChange: (updaterOrValue) => {
			const newSelection =
				typeof updaterOrValue === 'function' ? updaterOrValue(rowSelection) : updaterOrValue
			setRowSelection(newSelection, 'individual')
		},
		onGlobalFilterChange: setGlobalFilter,
		onPaginationChange: (updaterOrValue) => {
			const newPagination =
				typeof updaterOrValue === 'function'
					? updaterOrValue({ pageIndex, pageSize: currentPageSize })
					: updaterOrValue
			pageIndexRef.current = newPagination.pageIndex
			setPageIndex(newPagination.pageIndex)
			if (onPageChange) {
				onPageChange(newPagination.pageIndex)
			}
		},
		globalFilterFn: 'includesString',
		state: {
			rowSelection,
			globalFilter,
			pagination: {
				pageIndex,
				pageSize: currentPageSize,
			},
		},
		initialState: {
			pagination: {
				pageSize: currentPageSize,
			},
		},
	})

	React.useEffect(() => {
		table.setPageSize(currentPageSize)
	}, [currentPageSize, table])

	// Adjust page index if it becomes invalid when data changes
	React.useEffect(() => {
		const maxPageIndex = Math.max(0, table.getPageCount() - 1)
		if (pageIndex > maxPageIndex && maxPageIndex >= 0) {
			setPageIndex(maxPageIndex)
		}
	}, [data.length, table, pageIndex, setPageIndex])

	// Keep the top scrollbar spacer width equal to the table's scroll width
	React.useEffect(() => {
		if (!tableRef.current) {
			return
		}
		const updateWidth = () => {
			const scrollWidth = tableRef.current ? tableRef.current.scrollWidth : 0
			setScrollSpacerWidth(scrollWidth)
		}
		updateWidth()
		const ro = new ResizeObserver(updateWidth)
		ro.observe(tableRef.current)
		window.addEventListener('resize', updateWidth)
		return () => {
			ro.disconnect()
			window.removeEventListener('resize', updateWidth)
		}
	}, [table, withOclcNumber, rowsWithoclcNumber, data])

	// Sync horizontal scroll positions between the top and bottom scroll containers
	const handleTopScroll = React.useCallback(() => {
		if (!topScrollRef.current || !bottomScrollRef.current) {
			return
		}
		if (isSyncingRef.current) {
			return
		}
		isSyncingRef.current = true
		bottomScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft
		isSyncingRef.current = false
	}, [])

	const handleBottomScroll = React.useCallback(() => {
		if (!topScrollRef.current || !bottomScrollRef.current) {
			return
		}
		if (isSyncingRef.current) {
			return
		}
		isSyncingRef.current = true
		topScrollRef.current.scrollLeft = bottomScrollRef.current.scrollLeft
		isSyncingRef.current = false
	}, [])

	const selectedRowCount = Object.values(rowSelection).filter((bool) => bool === true).length

	const currentPageRows = table.getRowModel().rows
	const allCurrentPageSelected =
		currentPageRows.length > 0 && currentPageRows.every((row) => rowSelection[row.id])

	const handleSelectDeselectCurrentPage = () => {
		const newSelection = { ...rowSelection }
		if (allCurrentPageSelected) {
			currentPageRows.forEach((row) => {
				delete newSelection[row.id]
			})
		} else {
			currentPageRows.forEach((row) => {
				newSelection[row.id] = true
			})
		}
		setRowSelection(newSelection, 'bulk')
	}

	if (isLoading) {
		return (
			<Card>
				<CardHeader>
					<div className='text-lg font-semibold'>Loading Data...</div>
				</CardHeader>
				<CardContent className='relative'>
					<div className='absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-10'>
						<div className='flex flex-col items-center gap-2'>
							<Loader2 className='h-8 w-8 animate-spin text-primary' />
							<p className='text-sm text-muted-foreground'>Loading search results...</p>
						</div>
					</div>
					<div className='opacity-50'>
						<div className={`overflow-x-auto ${styles.customScrollbar}`}>
							<table className='w-full border-collapse rounded-lg overflow-hidden'>
								<thead className='sticky top-0 bg-background z-10'>
									{table.getHeaderGroups().map((headerGroup) => (
										<tr key={headerGroup.id}>
											{headerGroup.headers.map((header) => (
												<th
													key={header.id}
													className={`border p-2 text-left bg-muted ${header.id === 'select' ? 'w-[50px]' : 'min-w-[150px]'}`}
												>
													{header.isPlaceholder
														? null
														: flexRender(header.column.columnDef.header, header.getContext())}
												</th>
											))}
										</tr>
									))}
								</thead>
								<tbody>
									{table.getRowModel().rows.map((row) => (
										<tr
											key={row.id}
											className={cn(
												row.getIsSelected() ? 'bg-accent' : '',
												row.original.error ? 'bg-destructive/10 hover:bg-destructive/20' : '',
												manualUncheckedRows.includes(row.original.id as number)
													? 'bg-warning/10 hover:bg-warning/20'
													: '',
											)}
										>
											{row.getVisibleCells().map((cell) => (
												<td
													key={cell.id}
													className={cn(
														'border p-2 text-sm',
														cell.column.id === 'select' ? 'w-[50px]' : '',
														row.original.error ? 'text-destructive' : '',
													)}
												>
													{flexRender(cell.column.columnDef.cell, cell.getContext())}
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</CardContent>
			</Card>
		)
	}

	if (data.length === 0) {
		return (
			<Card>
				<CardContent className='p-6'>
					<div className='text-center text-muted-foreground'>
						<p>No data uploaded yet. Please upload an Excel file to get started.</p>
					</div>
				</CardContent>
			</Card>
		)
	}

	return (
		<Card>
			<CardHeader>
				<div className='flex flex-col md:flex-row md:justify-between items-start lg:items-center space-y-4 md:gap-2 md:space-y-0'>
					<div className='flex flex-wrap gap-2 text-sm text-muted-foreground'>
						<Badge variant='secondary'>{selectedRowCount} rows selected</Badge>
						<Badge variant='outline'>{table.getFilteredRowModel().rows.length} total rows</Badge>
						{showPagination && (
							<Badge variant='outline'>
								Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
							</Badge>
						)}
					</div>
					<div className='flex flex-wrap w-full items-center gap-x-4 gap-y-2 md:w-auto md:min-w-[13rem] xl:min-w-[18rem]'>
						<Input
							placeholder='Search all fields...'
							value={globalFilter}
							onChange={(e) => setGlobalFilter(e.target.value)}
							className='w-fit md:min-w-[13rem] lg:min-w-[15rem]'
						/>
						{onDownload && (
							<Button
								variant='outline'
								size='sm'
								onClick={onDownload}
								className='whitespace-nowrap'
							>
								Download Excel
							</Button>
						)}
					</div>
					{showPagination && (
						<div className='flex items-center space-x-2 min-w-[11.75rem]'>
							<span className='text-sm text-muted-foreground'>Rows per page:</span>
							<Select
								value={String(currentPageSize)}
								onValueChange={(value) => {
									const newSize = Number(value)
									setCurrentPageSize(newSize)
									savePageSizeToStorage('homePageSize', newSize)
								}}
							>
								<SelectTrigger className='w-20'>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value='10'>10</SelectItem>
									<SelectItem value='25'>25</SelectItem>
									<SelectItem value='50'>50</SelectItem>
									<SelectItem value='100'>100</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
				</div>
				<div className='flex items-center gap-2 mt-2 flex-wrap'>
					{(hasoclcNumberInAnyRow || hasErrorFieldInAnyRow) && (
						<div className='flex items-center'>
							<Switch
								checked={withOclcNumber}
								onCheckedChange={(checked) => {
									handleToggleOclcNumber(!!checked)
								}}
							/>
							<Badge variant={'secondary'}>
								{withOclcNumber ? 'Rows with valid oclc_number or no error records' : 'All Rows'}
							</Badge>
						</div>
					)}
					<Button
						variant='outline'
						size='sm'
						onClick={handleSelectDeselectCurrentPage}
						className='whitespace-nowrap'
					>
						{allCurrentPageSelected ? 'Deselect Current Page' : 'Select Current Page'}
					</Button>

					{onProcessCurrentPage && (
						<Button
							size='sm'
							onClick={() => {
								const currentPageRows = table.getRowModel().rows
								const currentPageSelectedRows = currentPageRows
									.filter((row) => rowSelection[row.id])
									.map((row) => row.original)
								onProcessCurrentPage(currentPageSelectedRows)
							}}
							disabled={!table.getRowModel().rows.some((row) => rowSelection[row.id])}
							className='whitespace-nowrap'
						>
							Process Current Page
						</Button>
					)}
				</div>
			</CardHeader>

			<CardContent>
				{/* Top horizontal scrollbar synchronized with the bottom table scroll */}
				<div
					ref={topScrollRef}
					onScroll={handleTopScroll}
					className={`overflow-x-auto overflow-y-hidden ${styles.customScrollbar}`}
				>
					{/* Spacer div whose width matches the table scroll width, so the top bar shows */}
					<div style={{ width: scrollSpacerWidth, height: 1 }} />
				</div>

				<div
					ref={bottomScrollRef}
					onScroll={handleBottomScroll}
					className={`max-h-[70vh] overflow-y-auto overflow-x-auto rounded-lg ${styles.customScrollbar}`}
				>
					<table ref={tableRef} className='w-full min-w-full border-collapse'>
						<thead>
							{table.getHeaderGroups().map((headerGroup) => (
								<tr key={headerGroup.id}>
									{headerGroup.headers.map((header) => (
										<th
											key={header.id}
											className={`sticky top-0 z-30 border text-left bg-muted ${header.id === 'select' ? 'w-[50px]' : 'min-w-[150px]'}`}
											style={{ WebkitBackdropFilter: 'blur(4px)' }}
										>
											<div className='p-2' style={{ boxShadow: '0px -10px var(--muted)' }}>
												{header.isPlaceholder
													? null
													: flexRender(header.column.columnDef.header, header.getContext())}
											</div>
										</th>
									))}
								</tr>
							))}
						</thead>
						<tbody>
							{table.getRowModel().rows.map((row) => (
								<tr
									key={row.id}
									className={cn(
										row.getIsSelected() ? 'bg-accent' : '',
										row.original.error ? 'bg-destructive/10 hover:bg-destructive/20' : '',
										manualUncheckedRows.includes(row.original.id as number)
											? 'bg-warning/10 hover:bg-warning/20'
											: '',
									)}
								>
									{row.getVisibleCells().map((cell) => (
										<td
											key={cell.id}
											className={cn(
												'border p-2 text-sm',
												cell.column.id === 'select' ? 'w-[50px]' : '',
												row.original.error ? 'text-destructive' : '',
											)}
										>
											{flexRender(cell.column.columnDef.cell, cell.getContext())}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>

				<div className='mt-4 grid items-center justify-center mx-auto'>
					<div className='md:col-span-1'>
						{showPagination && table.getPageCount() > 1 && (
							<Pagination>
								<PaginationContent>
									<PaginationItem>
										<PaginationPrevious
											onClick={() => table.previousPage()}
											className={
												table.getCanPreviousPage()
													? 'cursor-pointer'
													: 'pointer-events-none opacity-50'
											}
										/>
									</PaginationItem>

									{Array.from({ length: Math.min(5, table.getPageCount()) }, (_, i) => {
										const pageIndex = table.getState().pagination.pageIndex
										const pageNum = pageIndex <= 2 ? i + 1 : pageIndex - 1 + i
										if (pageNum > table.getPageCount()) {
											return null
										}

										return (
											<PaginationItem key={pageNum}>
												<PaginationLink
													onClick={() => table.setPageIndex(pageNum - 1)}
													isActive={pageIndex === pageNum - 1}
													className='cursor-pointer'
												>
													{pageNum}
												</PaginationLink>
											</PaginationItem>
										)
									})}

									<PaginationItem>
										<PaginationNext
											onClick={() => table.nextPage()}
											className={
												table.getCanNextPage() ? 'cursor-pointer' : 'pointer-events-none opacity-50'
											}
										/>
									</PaginationItem>
								</PaginationContent>
							</Pagination>
						)}
					</div>

					{/* Right empty column */}
					<div className='md:col-span-1' />
				</div>
			</CardContent>
		</Card>
	)
}

export default BookDataTable
export type { BookRecord }
