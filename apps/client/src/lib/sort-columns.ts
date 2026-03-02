export const getDisplayColumnKeys = (
	data: Record<string, unknown>[],
	columnOrder: string[],
): string[] => {
	if (data.length === 0) return []

	const existingColumns = new Set<string>()
	for (const row of data) {
		for (const k of Object.keys(row)) {
			if (k !== 'rowId' && k !== 'id') existingColumns.add(k)
		}
	}

	let baseKeys: string[]
	if (columnOrder.length > 0) {
		baseKeys = columnOrder.filter((col) => existingColumns.has(col))
		for (const col of existingColumns) {
			if (!baseKeys.includes(col)) baseKeys.push(col)
		}
	} else {
		baseKeys = Array.from(existingColumns)
	}

	const filtered = baseKeys.filter((col) =>
		data.some((row) => {
			const value = row[col]
			return value !== null && value !== undefined && String(value).trim() !== ''
		}),
	)
	return filtered
}

export const sortColumns = (columns: string[], originalOrder?: string[]): string[] => {
	// Detect if we have any of the "special" columns that affect ordering
	const hasNewColumns = columns.some((col) => col.endsWith('_new'))
	const hasOclcNumber = columns.includes('oclc_number')
	const hasOclcNumberNew = columns.includes('oclc_number_new')
	const hasError = columns.includes('error')
	const hasSearchQuery = columns.includes('search_query')

	const hasAnySpecialColumns =
		hasNewColumns || hasOclcNumber || hasOclcNumberNew || hasError || hasSearchQuery

	if (!hasAnySpecialColumns) {
		if (originalOrder) {
			const ordered = originalOrder.filter((col) => columns.includes(col))
			const missing = columns.filter((col) => !originalOrder.includes(col))
			return [...ordered, ...missing]
		}
		return [...columns]
	}

	if (!hasNewColumns && originalOrder) {
		const result: string[] = []

		// Add oclc_number first if it exists
		if (columns.includes('oclc_number')) {
			result.push('oclc_number')
		}

		// Add remaining columns in original order (excluding oclc_number, error, and search_query)
		originalOrder.forEach((col) => {
			if (
				col !== 'oclc_number' &&
				col !== 'error' &&
				col !== 'search_query' &&
				columns.includes(col)
			) {
				result.push(col)
			}
		})

		// Add any columns that exist in columns but not in originalOrder (excluding special columns)
		columns.forEach((col) => {
			if (
				col !== 'oclc_number' &&
				col !== 'error' &&
				col !== 'search_query' &&
				!originalOrder.includes(col) &&
				!result.includes(col)
			) {
				result.push(col)
			}
		})

		// Add error last if it exists
		if (columns.includes('error')) {
			result.push('error')
		}

		// Add search_query at the very end if it exists in columns (even if not in originalOrder)
		if (columns.includes('search_query')) {
			result.push('search_query')
		}

		return result
	}

	const result: string[] = []

	// Handle oclc_number first (if exists)
	if (columns.includes('oclc_number')) {
		result.push('oclc_number')
		// If there's a corresponding _new column, add it right after
		const oclcNewCol = 'oclc_number_new'
		if (columns.includes(oclcNewCol)) {
			result.push(oclcNewCol)
		}
	}

	// Handle paired columns (base + _new) in the middle, get all base columns that have _new variants
	const pairedBaseColumns = new Set<string>()
	const unpairedColumns = new Set<string>()

	columns.forEach((col) => {
		if (col === 'oclc_number' || col === 'error' || col === 'search_query') {
			// These are handled separately, skip them
			return
		}

		if (col.endsWith('_new')) {
			const baseCol = col.replace('_new', '')
			if (columns.includes(baseCol)) {
				pairedBaseColumns.add(baseCol)
			} else {
				unpairedColumns.add(col)
			}
		} else if (!columns.some((c) => c === col + '_new')) {
			unpairedColumns.add(col)
		}
	})

	// Add paired columns (base first, then _new) in original order
	const orderedPairedColumns = originalOrder
		? originalOrder.filter((col) => pairedBaseColumns.has(col))
		: Array.from(pairedBaseColumns).sort()

	orderedPairedColumns.forEach((baseCol) => {
		result.push(baseCol)
		const newCol = baseCol + '_new'
		if (columns.includes(newCol)) {
			result.push(newCol)
		}
	})

	// Add any paired columns that exist in columns but not already in result
	pairedBaseColumns.forEach((baseCol) => {
		if (!result.includes(baseCol)) {
			result.push(baseCol)
			const newCol = baseCol + '_new'
			if (columns.includes(newCol)) {
				result.push(newCol)
			}
		}
	})

	const orderedUnpairedColumns = originalOrder
		? originalOrder.filter((col) => unpairedColumns.has(col))
		: Array.from(unpairedColumns).sort()

	orderedUnpairedColumns.forEach((col) => {
		result.push(col)
	})

	// Add any unpaired columns that exist in columns but not already in result
	unpairedColumns.forEach((col) => {
		if (!result.includes(col)) {
			result.push(col)
		}
	})

	// Handle error column last (if it exists)
	if (columns.includes('error')) {
		result.push('error')
	}

	// Add search_query at the very end if it exists in columns (even if not in originalOrder)
	if (columns.includes('search_query')) {
		result.push('search_query')
	}
	return result
}
