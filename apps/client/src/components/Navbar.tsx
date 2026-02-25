import ThemeToggle from '@/components/ThemeToggle'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { useAuth } from '@/context/authContext'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@radix-ui/react-dropdown-menu'
import { Menu, Upload } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { DropdownMenuItem } from './ui/dropdown-menu'

const Navbar = () => {
	const [isOpen, setIsOpen] = useState(false)
	const location = useLocation()
	const { user, logout } = useAuth()
	const APP_TITLE = import.meta.env.VITE_APP_TITLE

	const navigation = [
		{ name: 'Query', href: '/' },
		{ name: 'Processed', href: '/processed' },
	]

	const isActive = (path: string) => location.pathname === path

	return (
		<nav className='sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60'>
			<div className='container mx-auto px-4'>
				<div className='flex h-16 items-center justify-between md:grid md:grid-cols-3'>
					<Link to={'/'} className='flex items-center space-x-2'>
						<Upload className='h-6 w-6' />
						<span className='md:text-xl font-bold tracking-tight'>{APP_TITLE}</span>
					</Link>

					{/* Desktop Navigation */}
					<div className='hidden md:flex items-center justify-center space-x-8'>
						{navigation.map((item) => (
							<Link
								key={item.name}
								to={item.href}
								className={`text-sm font-medium transition-colors hover:text-primary ${
									isActive(item.href)
										? 'text-foreground border-b-2 border-primary'
										: 'text-muted-foreground'
								}`}
							>
								{item.name}
							</Link>
						))}
					</div>

					<div className='flex items-center md:justify-end md:space-x-4'>
						<span className='hidden sm:block text-sm text-muted-foreground'>
							Welcome, {user?.name}
						</span>
						<DropdownMenu>
							<DropdownMenuTrigger asChild={true}>
								<Avatar className='h-8 w-8 cursor-pointer'>
									<AvatarFallback>{user?.name?.charAt(0) || 'U'}</AvatarFallback>
								</Avatar>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align='end'
								className='bg-background shadow-xs border rounded-md p-2 flex-col flex gap-1'
							>
								<DropdownMenuLabel>
									<div className='flex flex-col'>
										<span className='text-sm font-medium'>{user?.name || 'User'}</span>
										<span className='text-xs text-muted-foreground'>{user?.email || ''}</span>
									</div>
								</DropdownMenuLabel>
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={logout} className='cursor-pointer'>
									Log out
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>

						<ThemeToggle />

						{/* Mobile menu */}
						<Sheet open={isOpen} onOpenChange={setIsOpen}>
							<SheetTrigger asChild={true} className='md:hidden'>
								<Button variant='ghost' size='sm' className='h-9 w-9 px-0'>
									<Menu className='h-5 w-5' />
									<span className='sr-only'>Open menu</span>
								</Button>
							</SheetTrigger>
							<SheetContent side='right' className='w-[300px] sm:w-[400px]'>
								<div className='flex flex-col space-y-4 mt-6 px-2'>
									<div className='flex items-center space-x-2 px-2'>
										<Avatar className='h-10 w-10'>
											<AvatarFallback>{user?.name?.charAt(0) || 'U'}</AvatarFallback>
										</Avatar>
										<div>
											<p className='text-sm font-medium'>{user?.name || 'User'}</p>
											<p className='text-xs text-muted-foreground'>{user?.email || ''}</p>
										</div>
									</div>
									<div className='border-t pt-4'>
										{navigation.map((item) => (
											<Link
												key={item.name}
												to={item.href}
												onClick={() => setIsOpen(false)}
												className={`block px-2 py-3 text-base font-medium transition-colors hover:text-primary ${
													isActive(item.href)
														? 'text-foreground bg-accent'
														: 'text-muted-foreground'
												}`}
											>
												{item.name}
											</Link>
										))}
									</div>
									<div className='border-t pt-4'>
										<Button
											variant='outline'
											className='w-full'
											onClick={() => {
												logout()
												setIsOpen(false)
											}}
										>
											Sign Out
										</Button>
									</div>
								</div>
							</SheetContent>
						</Sheet>
					</div>
				</div>
			</div>
		</nav>
	)
}

export default Navbar
