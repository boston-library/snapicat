import ProtectedRoute from '@/components/ProtectedRoute'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { Toaster } from '@/components/ui/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { msalInstance } from '@/config/msal-instance'
import { AuthProvider } from '@/context/authContext'
import { ThemeProvider } from '@/hooks/use-theme'
import Home from '@/pages/Home'
import Login from '@/pages/Login'
import NotFound from '@/pages/NotFound'
import Processed from '@/pages/Processed'
import { MsalProvider } from '@azure/msal-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createHashRouter } from 'react-router-dom'

const queryClient = new QueryClient()

// Router for the app
const router = createHashRouter([
	{
		path: '/',
		element: <ProtectedRoute />,
		errorElement: <NotFound />,
		children: [
			{
				index: true,
				element: <Home />,
			},
			{
				path: 'processed',
				element: <Processed />,
			},
		],
	},
	{
		path: '/login',
		element: <Login />,
	},
	{
		path: '*',
		element: <NotFound />,
	},
])

const App = () => (
	<MsalProvider instance={msalInstance}>
		<AuthProvider>
			<QueryClientProvider client={queryClient}>
				<ThemeProvider defaultTheme='system' storageKey='bookops-ui-theme'>
					<TooltipProvider>
						<Toaster />
						<Sonner />
						<RouterProvider router={router} />
					</TooltipProvider>
				</ThemeProvider>
			</QueryClientProvider>
		</AuthProvider>
	</MsalProvider>
)

export default App
