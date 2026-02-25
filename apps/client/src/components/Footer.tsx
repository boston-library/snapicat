const Footer = () => {
	const currentYear = new Date().getFullYear()
	const APP_TITLE = import.meta.env.VITE_APP_TITLE
	return (
		<footer className='border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60'>
			<div className='container mx-auto px-4 py-6'>
				<div className='flex flex-col sm:flex-row justify-center items-center space-y-2 sm:space-y-0'>
					<p className='text-sm text-muted-foreground'>
						© {currentYear} {APP_TITLE}
					</p>
				</div>
			</div>
		</footer>
	)
}

export default Footer
