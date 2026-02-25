export const ADV_QUERY_BATCH_RETRY_ATTEMPTS = 5
export const ADV_QUERY_BATCH_RETRY_DELAY_MS = 5000
export const ADV_QUERY_INTER_BATCH_DELAY_MS = 1000

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
