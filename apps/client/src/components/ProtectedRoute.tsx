import { useAuth } from '@/context/authContext'
import { type FC } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import Footer from './Footer'
import Navbar from './Navbar'

interface ProtectedRouteProps {
	redirectTo?: string
}

const ProtectedRoute: FC<ProtectedRouteProps> = ({ redirectTo = '/login' }) => {
	const { isAuthenticated, isLoading } = useAuth()

	if (isLoading) {
		return (
			<div className='min-h-screen flex items-center justify-center'>
				<div className='text-center space-y-4'>
					<div className='animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto'></div>
					<p className='text-gray-600 dark:text-gray-400'>Loading...</p>
				</div>
			</div>
		)
	}

	if (!isAuthenticated) {
		return <Navigate to={redirectTo} replace={true} />
	}

	return (
		<>
			<Navbar />
			{/* 4rem is the height of the navbar, 6rem is the height of the footer in mobile view, 4.25rem is the height of the footer in desktop view */}
			<main className='min-h-[calc(100dvh-6rem-4rem)] md:min-h-[calc(100dvh-4.25rem-4rem)]'>
				<Outlet />
			</main>
			<Footer />
		</>
	)
}
export default ProtectedRoute
