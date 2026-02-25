import { useMutation } from '@tanstack/react-query'
import type { SearchRequest, SearchResponse } from '../api'
import { useApi } from '../api'
import {
	ADV_QUERY_BATCH_RETRY_ATTEMPTS,
	ADV_QUERY_BATCH_RETRY_DELAY_MS,
	ADV_QUERY_INTER_BATCH_DELAY_MS,
	sleep,
} from '../search-config'

const API_CODE = import.meta.env.VITE_API_CODE

	const codeParam = API_CODE ? `?code=${API_CODE}` : ''

export const useSearchBooks = () => {
	const api = useApi()

	return useMutation<
		SearchResponse,
		Error,
		SearchRequest & {
			batchSize?: string
			onBatchProgress?: (current: number, total: number) => void
			onBatchResult?: (args: {
				batchIndex: number
				totalBatches: number
				response: SearchResponse
			}) => Promise<void> | void
			// Advanced Query optional retry configuration
			enableRetry?: boolean
			retryAttempts?: number
			retryDelayMs?: number
			interBatchDelayMs?: number
			// Cancellation controls (Advanced Query only)
			abortSignal?: AbortSignal
			shouldCancelRef?: { current: boolean }
		}
	>({
		mutationFn: async (data) => {
			const {
				books,
				batchSize = 'ALL',
				onBatchProgress,
				onBatchResult,
				enableRetry = false,
				retryAttempts = ADV_QUERY_BATCH_RETRY_ATTEMPTS,
				retryDelayMs = ADV_QUERY_BATCH_RETRY_DELAY_MS,
				interBatchDelayMs = ADV_QUERY_INTER_BATCH_DELAY_MS,
				abortSignal,
				shouldCancelRef,
				...rest
			} = data
			const batchSizeNum = batchSize === 'ALL' ? books.length : Number.parseInt(batchSize)
			const batches = []

			// Split books into batches of specified size
			for (let i = 0; i < books.length; i += batchSizeNum) {
				batches.push(books.slice(i, i + batchSizeNum))
			}

			const results = []
			let totalProcessed = 0
			let apiUsageRemaining = 0
			let wasCancelled = false

			const sleepCancellable = (ms: number) =>
				new Promise<void>((resolve) => {
					const timer = setTimeout(() => resolve(), ms)
					if (abortSignal) {
						const onAbort = () => {
							clearTimeout(timer)
							resolve()
							abortSignal.removeEventListener('abort', onAbort)
						}
						abortSignal.addEventListener('abort', onAbort, { once: true })
					}
				})

			// Process each batch
			for (let i = 0; i < batches.length; i++) {
				// Early exit if cancellation requested before starting this batch
				if (shouldCancelRef?.current || abortSignal?.aborted) {
					wasCancelled = true
					break
				}
				const batch = batches[i]
				onBatchProgress?.(i + 1, batches.length)

				const attemptBatch = async () => {
					const response = await api.post<SearchResponse>(
						`/search_books${codeParam}`,
						{
							...rest,
							books: batch,
						},
						{
							signal: abortSignal,
							headers: {
								'Content-Type': 'application/json',
							},
						},
					)
					return response
				}

				let response: { data: SearchResponse } | null = null

				if (enableRetry) {
					let attempt = 0
					while (attempt < retryAttempts) {
						try {
							response = await attemptBatch()
							break
						} catch (_error) {
							// If user cancelled, stop retrying and the whole loop
							if (shouldCancelRef?.current || abortSignal?.aborted) {
								wasCancelled = true
								response = null
								break
							}
							attempt++
							if (attempt >= retryAttempts) {
								// Mark all books in this batch as failed with an error message
								const failed = batch.map((b) => ({
									rowId: b.rowId,
									error: `Batch failed after ${retryAttempts} retries`,
								}))
								results.push(...failed)
								// Do not increment totalProcessed for failures
								response = null
								break
							}
							await sleep(retryDelayMs)
						}
					}
					if (wasCancelled) {
						break
					}
				} else {
					// Existing behavior without retries
					response = await attemptBatch()
				}

				if (response) {
					results.push(...response.data.books)
					totalProcessed += response.data.total_processed || 0
					apiUsageRemaining = response.data.api_usage_remaining || 0
					if (onBatchResult) {
						await onBatchResult({
							batchIndex: i + 1,
							totalBatches: batches.length,
							response: response.data,
						})
					}
				} else if (enableRetry && onBatchResult) {
					const synthetic: SearchResponse = {
						success: false,
						books: [],
						total_processed: totalProcessed,
						api_usage_remaining: apiUsageRemaining,
					}
					await onBatchResult({
						batchIndex: i + 1,
						totalBatches: batches.length,
						response: synthetic,
					})
				}

				// wait between batches (only if there are more batches)
				if (i < batches.length - 1) {
					if (abortSignal?.aborted || shouldCancelRef?.current) {
						wasCancelled = true
						break
					}
					await sleepCancellable(interBatchDelayMs)
				}
			}

			return {
				success: true,
				books: results,
				total_processed: totalProcessed,
				api_usage_remaining: apiUsageRemaining,
				cancelled: wasCancelled,
			}
		},
	})
}
