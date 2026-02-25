import styles from '@/components/styles/custom-scrollbar.module.css'
import { Badge } from '@/components/ui/badge'
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
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getPaginationRowModel,
	useReactTable,
} from '@tanstack/react-table'
import React from 'react'

interface ProcessedDataTableProps {
	data: any[]
	columnOrder?: string[]
	onPageChange?: (pageIndex: number) => void
	initialPageIndex?: number
}

const ProcessedDataTable: React.FC<ProcessedDataTableProps> = ({
	data,
	columnOrder,
	onPageChange,
	initialPageIndex = 0,
}) => {
	const [currentPageSize, setCurrentPageSize] = React.useState(() => {
		return getPageSizeFromStorage('processedPageSize', 25)
	})
	const [pageIndex, setPageIndex] = React.useState(initialPageIndex)
	const isInitializingRef = React.useRef(true)
	const skipPageChangeRef = React.useRef(false)

	React.useEffect(() => {
		skipPageChangeRef.current = true
		setPageIndex(initialPageIndex)
		setTimeout(() => {
			isInitializingRef.current = false
			skipPageChangeRef.current = false
		}, 100)
	}, [initialPageIndex])

	// Refs and state to support a synchronized top horizontal scrollbar
	const topScrollRef = React.useRef<HTMLDivElement | null>(null)
	const bottomScrollRef = React.useRef<HTMLDivElement | null>(null)
	const tableRef = React.useRef<HTMLTableElement | null>(null)
	const isSyncingRef = React.useRef(false)
	const [scrollSpacerWidth, setScrollSpacerWidth] = React.useState(0)

	const allColumnKeys = React.useMemo(() => {
		if (data.length === 0) {
			return []
		}

		let columnKeys: string[] = []

		if (Array.isArray(columnOrder) && columnOrder.length > 0) {
			const existingColumns = new Set<string>()
			data.forEach((row) => {
				Object.keys(row).forEach((k) => {
					if (k !== 'rowId' && k !== 'id') {
						existingColumns.add(k)
					}
				})
			})

			columnKeys = columnOrder.filter((col) => existingColumns.has(col))
			existingColumns.forEach((col) => {
				if (!columnKeys.includes(col)) {
					columnKeys.push(col)
				}
			})
		} else {
			const columnSet = new Set<string>()
			data.forEach((row) => {
				Object.keys(row).forEach((k) => {
					if (k !== 'rowId' && k !== 'id' && !columnSet.has(k)) {
						columnSet.add(k)
						columnKeys.push(k)
					}
				})
			})
		}

		const filteredColumnKeys = columnKeys.filter((col) => {
			return data.some((row) => {
				const value = row[col]
				return value !== null && value !== undefined && String(value).trim() !== ''
			})
		})

		return filteredColumnKeys
	}, [data, columnOrder])

	const sortedColumns = sortColumns(allColumnKeys, columnOrder || allColumnKeys)

	const columns = React.useMemo<ColumnDef<any>[]>(
		() =>
			sortedColumns.map((key) => ({
				accessorKey: key,
				header: () => (
					<div className='flex items-center space-x-2'>
						<span className='text-xs font-medium truncate'>{key}</span>
					</div>
				),
				cell: ({ getValue }: { getValue: () => any }) => (
					<div
						className='text-overflow whitespace-nowrap max-w-80 overflow-y-auto overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]'
						title={String(getValue() || '')}
					>
						{String(getValue() || '')}
					</div>
				),
			})),
		[sortedColumns],
	)

	const table = useReactTable({
		data,
		columns,
		getCoreRowModel: getCoreRowModel(),
		getPaginationRowModel: getPaginationRowModel(),
		onPaginationChange: (updaterOrValue) => {
			const newPagination =
				typeof updaterOrValue === 'function'
					? updaterOrValue({ pageIndex, pageSize: currentPageSize })
					: updaterOrValue
			setPageIndex(newPagination.pageIndex)
			if (onPageChange && !isInitializingRef.current && !skipPageChangeRef.current) {
				onPageChange(newPagination.pageIndex)
			}
		},
		state: {
			pagination: {
				pageIndex,
				pageSize: currentPageSize,
			},
		},
		initialState: {
			pagination: {
				pageSize: currentPageSize,
				pageIndex,
			},
		},
	})

	React.useEffect(() => {
		table.setPageSize(currentPageSize)
	}, [currentPageSize, table])

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
	}, [data])

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

	if (!data || data.length === 0) {
		return (
			<div className='text-center text-muted-foreground p-6'>
				<p>No processed records available.</p>
			</div>
		)
	}

	return (
		<div className='space-y-4'>
			<div className='flex flex-col md:flex-row md:justify-between items-start lg:items-center space-y-2 md:gap-2 md:space-y-0'>
				<div className='flex flex-wrap gap-2 text-sm text-muted-foreground'>
					<Badge variant='outline'>{table.getFilteredRowModel().rows.length} total rows</Badge>
					<Badge variant='outline'>
						Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
					</Badge>
				</div>

				<div className='flex items-center space-x-2 min-w-[11.75rem]'>
					<span className='text-sm text-muted-foreground'>Rows per page:</span>
					<Select
						value={String(currentPageSize)}
						onValueChange={(value) => {
							const newSize = Number(value)
							setCurrentPageSize(newSize)
							savePageSizeToStorage('processedPageSize', newSize)
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
			</div>

			<div
				ref={topScrollRef}
				onScroll={handleTopScroll}
				className={`mb-0 overflow-x-auto overflow-y-hidden ${styles.customScrollbar}`}
			>
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
										className='sticky top-0 z-30 border text-left bg-muted min-w-[150px]'
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
							<tr key={row.id}>
								{row.getVisibleCells().map((cell) => (
									<td key={cell.id} className='border p-2 text-sm'>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{table.getPageCount() > 1 && (
				<div className='flex justify-center'>
					<Pagination>
						<PaginationContent>
							<PaginationItem>
								<PaginationPrevious
									onClick={() => table.previousPage()}
									className={
										table.getCanPreviousPage() ? 'cursor-pointer' : 'pointer-events-none opacity-50'
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
				</div>
			)}
		</div>
	)
}

export default ProcessedDataTable
