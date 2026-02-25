export interface BookRecord {
	[key: string]: any
	oclc_number?: string
	title?: string
	author?: string
	publisher?: string
	isbn?: string
	publication_date?: string
}
export interface SearchCriteria {
	[key: string]: any
}
export interface ColumnConfig {
	key: string
	label: string
	enabled: boolean
	type: 'text' | 'number' | 'date' | 'select'
	editable: boolean
}

export interface User {
	id: string
	email: string
	name: string
	accessToken?: string
}
