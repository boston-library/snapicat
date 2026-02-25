import { msalInstance } from '@/config/msal-instance'
import { db } from '@/lib/database'
import type { User } from '@/types'
import type { AccountInfo } from '@azure/msal-browser'
import { useMsal } from '@azure/msal-react'
import { jwtDecode } from 'jwt-decode'
import type React from 'react'
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from 'react'

// Replace this ALLOWED_ROLES with the roles defined in Azure for this application
const ALLOWED_ROLES = ['BPLOCLC.Admin', 'BPLOCLC.User']

interface AuthContextType {
	isAuthenticated: boolean
	user: User | null
	accessToken: string | null
	login: () => Promise<void>
	logout: () => Promise<void>
	isLoading: boolean
	error: string | null
	getValidAccessToken: (minValidityMs?: number) => Promise<string | null>
}

interface AccessTokenPayload {
	roles?: string[]
	[key: string]: any
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
	children: ReactNode
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
	const { instance, accounts, inProgress } = useMsal()
	const [user, setUser] = useState<User | null>(null)
	const [accessToken, setAccessToken] = useState<string | null>(null)
	const [accessTokenExpiresAt, setAccessTokenExpiresAt] = useState<Date | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [msalInitialized, setMsalInitialized] = useState(false)
	const isAuthenticated = accounts.length > 0

	const convertAccountToUser = useCallback(
		(account: AccountInfo): User => ({
			id: account.homeAccountId,
			email: account.username,
			name: account.name || account.username,
		}),
		[],
	)

	// Separate login request for initial authentication
	const loginRequest = useMemo(
		() => ({
			scopes: ['openid', 'profile', 'email'],
			prompt: 'select_account' as const,
		}),
		[],
	)

	// Token request for API access
	const getTokenRequest = useCallback(
		(account: AccountInfo) => ({
			scopes: [`api://${import.meta.env.VITE_AZURE_BE_APP_CLIENT_ID}/.default`],
			account: account,
		}),
		[],
	)

	const acquireToken = useCallback(async () => {
		if (accounts.length === 0) {
			return
		}

		const account = accounts[0]

		const tokenRequest = getTokenRequest(account)

		try {
			const response = await instance.acquireTokenSilent(tokenRequest)
			setAccessToken(response.accessToken)
			setAccessTokenExpiresAt(response.expiresOn || null)

			// Role check logic
			const decoded = jwtDecode<AccessTokenPayload>(response.accessToken)
			const userRoles = decoded.roles || []

			const hasAllowedRole = userRoles.some((role) => ALLOWED_ROLES.includes(role))

			if (!hasAllowedRole) {
				const errorMessage =
					userRoles.length === 0
						? 'Access denied: No roles assigned to your account. Please contact your administrator.'
						: `Access denied: Your roles (${userRoles.join(', ')}) do not have sufficient permissions.`

				setError(errorMessage)

				// Clear session
				setUser(null)
				setAccessToken(null)
				setAccessTokenExpiresAt(null)

				// Preserve column orders before clearing localStorage
				const advColumnOrder = localStorage.getItem('adv_unprocessed_columnOrder')
				const processedColumnOrder = localStorage.getItem('processed_columnOrder')

				localStorage.clear()

				// Restore preserved column orders
				if (advColumnOrder) {
					localStorage.setItem('adv_unprocessed_columnOrder', advColumnOrder)
				}
				if (processedColumnOrder) {
					localStorage.setItem('processed_columnOrder', processedColumnOrder)
				}

				instance.setActiveAccount(null)
				window.location.hash = '#/login'
				return
			}
		} catch (_silentError: any) {
			try {
				await instance.acquireTokenRedirect(tokenRequest)
				// NOTE: acquireTokenRedirect doesn't return a response, it redirects, the token will be handled in a redirect flow by MSAL
			} catch (_redirectError) {
				setError('Failed to acquire access token. Please try logging in again.')
				window.location.hash = '#/login'
			}
		}
	}, [accounts, instance, getTokenRequest])

	const getValidAccessToken = useCallback(
		async (minValidityMs: number = 10 * 60 * 1000) => {
			if (accounts.length === 0) {
				return null
			}
			const account = accounts[0]
			const tokenRequest = getTokenRequest(account)
			let needsRefresh = false

			if (!accessToken || !accessTokenExpiresAt) {
				needsRefresh = true
			} else {
				const timeLeftMs = accessTokenExpiresAt.getTime() - Date.now()
				if (timeLeftMs < minValidityMs) {
					needsRefresh = true
				}
			}

			if (!needsRefresh) {
				return accessToken
			}

			try {
				const response = await instance.acquireTokenSilent(tokenRequest)
				setAccessToken(response.accessToken)
				setAccessTokenExpiresAt(response.expiresOn || null)
				return response.accessToken
			} catch (_silentError) {
				// If silent refresh fails, return the current token (request may fail and be handled by interceptors)
				return accessToken
			}
		},
		[accounts, accessToken, accessTokenExpiresAt, instance, getTokenRequest],
	)

	const login = useCallback(async () => {
		setIsLoading(true)
		setError(null)

		try {
			await instance.loginRedirect(loginRequest)
		} catch (_err) {
			setError('Login failed. Please try again.')
			setIsLoading(false)
		}
		// NOTE: Don't set loading to false here because loginRedirect will redirect the page
	}, [instance, loginRequest])

	const logout = useCallback(async () => {
		setIsLoading(true)
		try {
			setUser(null)
			setAccessToken(null)
			setAccessTokenExpiresAt(null)

			// Clear all selection and query state from IndexedDB on logout
			await db.checked_rows.clear()
			await db.unchecked_rows.clear()
			await db.recent_queried_successful_rows.clear()

			// Preserve column orders and theme before clearing localStorage
			const currentTheme = localStorage.getItem('bookops-ui-theme')
			const advColumnOrder = localStorage.getItem('adv_unprocessed_columnOrder')
			const processedColumnOrder = localStorage.getItem('processed_columnOrder')

			localStorage.clear()

			// Restore preserved values
			if (currentTheme) {
				localStorage.setItem('bookops-ui-theme', currentTheme)
			}
			if (advColumnOrder) {
				localStorage.setItem('adv_unprocessed_columnOrder', advColumnOrder)
			}
			if (processedColumnOrder) {
				localStorage.setItem('processed_columnOrder', processedColumnOrder)
			}

			// NOTE: We are using local storage to clear the user and access token, because the function instance.logoutRedirect() can logout the user from their microsoft account as well

			window.location.reload()
		} catch (_err) {
			setError('Logout failed. Please try again.')
		} finally {
			setIsLoading(false)
		}
	}, [])

	// Initialize MSAL and handle redirects
	useEffect(() => {
		const initializeMsal = async () => {
			try {
				await msalInstance.initialize()

				const response = await msalInstance.handleRedirectPromise()

				setMsalInitialized(true)

				if (response?.account) {
					msalInstance.setActiveAccount(response.account)
					const user = convertAccountToUser(response.account)
					setUser(user)
					// Token acquisition will be handled in the next useEffect
					window.location.hash = '/'
				}
			} catch (err: any) {
				setError(err.message || 'Authentication initialization failed')
				setMsalInitialized(true) // Set to true even on error to stop loading
			}
		}

		initializeMsal()
	}, [convertAccountToUser])

	// Handle authentication state after MSAL is initialized
	useEffect(() => {
		const handleAuthState = async () => {
			// Wait for MSAL to be initialized and not in progress
			if (!msalInitialized || inProgress !== 'none') {
				return
			}

			try {
				if (accounts.length > 0) {
					const account = accounts[0]

					if (!user) {
						instance.setActiveAccount(account)
						const convertedUser = convertAccountToUser(account)
						setUser(convertedUser)
					}

					if (!accessToken) {
						await acquireToken()
					}
				} else {
					setUser(null)
					setAccessToken(null)
					setAccessTokenExpiresAt(null)
				}
			} catch (_err: any) {
				setError('Failed to process authentication state')
			} finally {
				setIsLoading(false)
			}
		}

		handleAuthState()
	}, [
		msalInitialized,
		inProgress,
		accounts,
		user,
		accessToken,
		instance,
		acquireToken,
		convertAccountToUser,
	])

	// Background refresher: keep token valid by refreshing if expiring within 10 minutes
	useEffect(() => {
		const interval = setInterval(() => {
			getValidAccessToken(10 * 60 * 1000).catch((e) => {
				console.log('Error refreshing access token', e)
			})
		}, 60 * 1000) // check every minute
		return () => clearInterval(interval)
	}, [getValidAccessToken])

	const contextValue: AuthContextType = {
		isAuthenticated,
		user,
		accessToken,
		login,
		logout,
		isLoading,
		error,
		getValidAccessToken,
	}

	return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextType => {
	const context = useContext(AuthContext)
	if (!context) {
		throw new Error('useAuth must be used within an AuthProvider')
	}
	return context
}
