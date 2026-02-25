import { useAuth } from '@/context/authContext'
import { useToast } from '@/hooks/use-toast'
import axios from 'axios'
import React from 'react'

export interface SearchRequest {
	appendSearchQuery: string
	sortingOrder: string
	books: {
		rowId: number
		[key: string]: any
	}[]
	isRefining?: boolean
}

export interface SearchResponse {
	success: boolean
	books: {
		rowId: number
		[key: string]: any
	}[]
	total_processed?: number
	api_usage_remaining?: number
	// Optional flag used to indicate user-initiated cancellation
	cancelled?: boolean
}

const createApiInstance = () => {
	return axios.create({
		baseURL: import.meta.env.VITE_API_BASE_URL,
		timeout: 2700000, // 45 minutes (2700000ms) to handle long-running search operations
	})
}

const debounce = (func: Function, wait: number) => {
	let timeout: NodeJS.Timeout
	return (...args: any[]) => {
		clearTimeout(timeout)
		timeout = setTimeout(() => func(...args), wait)
	}
}

export const useApi = () => {
	const { accessToken, logout, getValidAccessToken } = useAuth()
	const { toast } = useToast()

	const showErrorToast = React.useMemo(
		() =>
			debounce((title: string, description: string) => {
				toast({
					title,
					description,
					variant: 'destructive',
				})
			}, 1000),
		[toast],
	)

	const api = React.useMemo(() => {
		const instance = createApiInstance()

		instance.interceptors.request.use(
			async (config) => {
				// Ensure token validity for at least 10 minutes before making the request
				const token = (await getValidAccessToken?.(10 * 60 * 1000)) || accessToken
				if (token) {
					config.headers.Authorization = `Bearer ${token}`
				}
				return config
			},
			(error) => Promise.reject(error),
		)

		instance.interceptors.response.use(
			(response) => response,
			async (error) => {
				if (error.code === 'ECONNABORTED') {
					showErrorToast('Request Timeout', 'The request took too long to complete.')
				}

				if (error.code === 'ERR_NETWORK') {
					showErrorToast('Network Error', 'Please check your internet connection.')
				}

				if (error.response) {
					const { status, data } = error.response

					// Handle MSAL-specific errors
					if (data?.error === 'invalid_grant' || data?.error === 'interaction_required') {
						if (data?.error_description?.includes('consent_required')) {
							showErrorToast(
								'Consent Required',
								'Please provide consent to access the application. You will be logged out to re-authenticate.',
							)
							setTimeout(() => {
								logout()
							}, 3000)
							return Promise.reject(error)
						}

						if (data?.error_description?.includes('AADSTS65001')) {
							showErrorToast(
								'Authentication Required',
								'Your session has expired. You will be logged out to re-authenticate.',
							)
							setTimeout(() => {
								logout()
							}, 3000)
							return Promise.reject(error)
						}
					}

					switch (status) {
						case 400:
							showErrorToast('Error', data.error || 'Invalid request')
							break
						case 401:
							showErrorToast(
								'Session Expired',
								'Your session has expired. You will be logged out to re-authenticate.',
							)
							setTimeout(() => {
								logout()
							}, 3000)
							break
						case 403:
							showErrorToast('Access Denied', 'You do not have permission to perform this action.')
							break
						case 404:
							showErrorToast('Not Found', data.error || 'The requested resource was not found')
							break
						case 500:
							showErrorToast('Server Error', 'Internal server error occurred.')
							break
						default:
							showErrorToast('Error', 'Something went wrong!')
					}
				}
				return Promise.reject(error)
			},
		)

		return instance
	}, [accessToken, logout, showErrorToast, getValidAccessToken])

	return api
}

const defaultApi = createApiInstance()
export { defaultApi as api }
