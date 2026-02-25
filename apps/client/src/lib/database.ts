import Dexie, { Table } from 'dexie'

export interface DynamicRecord {
	id?: number
	[key: string]: any
}

export interface ExcelData {
	id?: number
	fileName: string
	data: any[]
	uploadedAt: Date
}

export interface ProcessedRecord {
	id?: number
	oclc_number: string
	titleOriginal?: string
	titleRetrieved?: string
	publisherOriginal?: string
	publisherRetrieved?: string
	authorOriginal?: string
	authorRetrieved?: string
	status: 'pending' | 'processed' | 'completed'
	processedAt?: Date
	xmlGenerated?: boolean
}

export interface UserSession {
	id?: number
	sessionId: string
	filters: any
	selectedColumns: string[]
	selectedRows: number[]
	createdAt: Date
}

export interface UncheckedRow {
	rowId: number
	table: string
}

export interface CheckedRow {
	rowId: number
	table: string
}

export interface RecentQueriedSuccessfulRow {
	rowId: number
	table: string
}

export class BookOpsDatabase extends Dexie {
	processedData!: Table<DynamicRecord>
	adv_unprocessed!: Table<DynamicRecord>
	unchecked_rows!: Table<UncheckedRow>
	checked_rows!: Table<CheckedRow>
	recent_queried_successful_rows!: Table<RecentQueriedSuccessfulRow>

	constructor() {
		super('BookOpsDatabase')
		this.version(1).stores({
			processedData: '++id',
		})
		this.version(2).stores({
			adv_unprocessed: '++id',
		})
		this.version(3).stores({
			unchecked_rows: '++id, rowId, table',
		})
		this.version(4).stores({
			checked_rows: '++id, rowId, table',
		})
		this.version(5).stores({
			recent_queried_successful_rows: '++id, rowId, table',
		})
	}
}

export const db = new BookOpsDatabase()
