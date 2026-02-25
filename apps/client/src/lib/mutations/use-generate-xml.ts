import { useMutation } from '@tanstack/react-query'
import { useApi } from '../api'

interface GenerateXMLRequest {
	books: string[]
	format: 'marcxml' | 'marc'
}

const API_CODE = import.meta.env.VITE_API_CODE

const codeParam = API_CODE ? `?code=${API_CODE}` : ''

export const useGenerateXML = () => {
	const api = useApi()

	return useMutation<string, Error, GenerateXMLRequest>({
		mutationFn: async (data) => {
			const response = await api.post<string>(
				`/generate_xml${codeParam}`,
				data,
				{
					responseType: 'text',
				},
			)
			return response.data
		},
	})
}
