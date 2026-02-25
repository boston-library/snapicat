export const getPageSizeFromStorage = (key: string, defaultValue: number): number => {
	if (typeof window === 'undefined') {
		return defaultValue
	}
	const stored = sessionStorage.getItem(key)
	if (!stored) {
		return defaultValue
	}
	const parsed = Number.parseInt(stored, 10)
	const validSizes = [10, 25, 50, 100]
	if (validSizes.includes(parsed)) {
		return parsed
	}
	return defaultValue
}

export const savePageSizeToStorage = (key: string, value: number) => {
	if (typeof window === 'undefined') {
		return
	}
	const validSizes = [10, 25, 50, 100]
	if (validSizes.includes(value)) {
		sessionStorage.setItem(key, String(value))
	}
}

export const saveLastPageOnHome = (pageNumber: number) => {
	if (typeof window === 'undefined') {
		return
	}
	try {
		sessionStorage.setItem('last_page_on_home', String(pageNumber))
	} catch (error) {
		console.error('Failed to save last_page_on_home:', error)
	}
}

export const getLastPageOnHome = (): number | null => {
	if (typeof window === 'undefined') {
		return null
	}
	try {
		const stored = sessionStorage.getItem('last_page_on_home')
		if (!stored) {
			return null
		}
		const parsed = Number.parseInt(stored, 10)
		if (Number.isNaN(parsed) || parsed < 1) {
			return null
		}
		return parsed
	} catch (error) {
		console.error('Failed to read last_page_on_home:', error)
		return null
	}
}

export const clearLastPageOnHome = () => {
	if (typeof window === 'undefined') {
		return
	}
	try {
		sessionStorage.removeItem('last_page_on_home')
	} catch (error) {
		console.error('Failed to clear last_page_on_home:', error)
	}
}
