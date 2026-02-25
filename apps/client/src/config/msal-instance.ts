import { PublicClientApplication } from '@azure/msal-browser'

const msalConfig = {
	auth: {
		clientId: import.meta.env.VITE_AZURE_FE_APP_CLIENT_ID,
		authority: `https://login.microsoftonline.com/${import.meta.env.VITE_AZURE_FE_APP_TENANT_ID}`,
		redirectUri: window.location.origin,
	},
	cache: {
		cacheLocation: 'localStorage' as const,
		storeAuthStateInCookie: false,
	},
}

export const msalInstance = new PublicClientApplication(msalConfig)
