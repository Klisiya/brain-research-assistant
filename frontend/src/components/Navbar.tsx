import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import './Navbar.css'

type DropdownItem = { label: string; href?: string }
type NavId = 'home' | 'learning' | 'research' | 'innovation' | 'more'
type NavItem = { id: NavId; label: string; icon?: string; href?: string; dropdown?: DropdownItem[] }
type AuthUser = { id: number; username: string; email: string; role: string }
type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: AuthUser }
type AuthMePayload =
  | { authenticated: false; user: null }
  | { authenticated: true; user: AuthUser }

const NAVBAR_SEPARATE_THRESHOLD = 72
const NAVBAR_MERGE_THRESHOLD = 40
const DESKTOP_MEDIA_QUERY = '(min-width: 1001px)'
const navItems: NavItem[] = [
  { id: 'home', label: 'Home', icon: '\u2302', href: '/' },
  {
    id: 'learning', label: 'Learning Center', dropdown: [
      { label: 'Course Overview', href: '/#overview' },
      { label: 'Learning Units', href: '/#modules' },
      { label: 'Paper Library', href: '/papers' },
      { label: 'AI Tutor', href: '/#ai-section' },
      { label: 'Knowledge Quiz' },
    ],
  },
  {
    id: 'research', label: 'Research Areas', dropdown: [
      { label: 'Neuroscience' }, { label: 'Cognitive Science' },
      { label: 'Brain-Computer Interfaces' }, { label: 'Brain-Inspired Computing' },
      { label: 'Artificial Intelligence' }, { label: 'Brain Disorders' },
    ],
  },
  {
    id: 'innovation', label: 'Innovation Hub', dropdown: [
      { label: 'Faculty Resources', href: '/innovation-hub?view=faculty' },
      { label: 'Industry Updates', href: '/innovation-hub?view=industry' },
      { label: 'Learner Discussions', href: '/innovation-hub?view=discussions' },
      { label: 'Collaboration Board', href: '/innovation-hub?view=collaboration' },
    ],
  },
  {
    id: 'more', label: 'More', dropdown: [
      { label: 'Learning Evaluation' },
      { label: 'About & Disclaimer', href: '/about' },
      { label: 'Contact', href: '/contact' },
    ],
  },
]
const leftNavItems = navItems.slice(0, 3)
const rightNavItems = navItems.slice(3)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
function isAuthUser(value: unknown): value is AuthUser {
  return isRecord(value) && typeof value.id === 'number' &&
    typeof value.username === 'string' && typeof value.email === 'string' &&
    typeof value.role === 'string'
}
function isAuthMePayload(value: unknown): value is AuthMePayload {
  return (isRecord(value) && value.authenticated === false && value.user === null) ||
    (isRecord(value) && value.authenticated === true && isAuthUser(value.user))
}
function isNavItemActive(itemId: NavId, pathname: string) {
  switch (itemId) {
    case 'home': return pathname === '/'
    case 'learning': return pathname === '/papers' || pathname.startsWith('/papers/')
    case 'research': return pathname.startsWith('/brain-region/')
    case 'innovation': return pathname === '/innovation-hub'
    case 'more': return pathname === '/about' || pathname === '/contact'
  }
}
async function readJsonPayload(response: Response): Promise<unknown> {
  try { return await response.json() } catch { return null }
}

function readHalfContentRects(
  leftContent: HTMLDivElement | null,
  rightContent: HTMLDivElement | null,
): readonly [DOMRect, DOMRect] | null {
  if (!leftContent || !rightContent) return null
  return [leftContent.getBoundingClientRect(), rightContent.getBoundingClientRect()]
}

function Navbar() {
  const location = useLocation()
  const navigate = useNavigate()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading', user: null })
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [isSeparated, setIsSeparated] = useState(() => window.scrollY > NAVBAR_SEPARATE_THRESHOLD)
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_MEDIA_QUERY).matches)
  const [searchExpansionKey, setSearchExpansionKey] = useState<string | null>(null)
  const shouldSeparate = isDesktop && isSeparated
  const isSeparatedRef = useRef(isSeparated)
  const accountRef = useRef<HTMLDivElement>(null)
  const accountButtonRef = useRef<HTMLButtonElement>(null)
  const leftHalfRef = useRef<HTMLDivElement>(null)
  const rightHalfRef = useRef<HTMLDivElement>(null)
  const leftHalfContentRef = useRef<HTMLDivElement>(null)
  const rightHalfContentRef = useRef<HTMLDivElement>(null)
  const pendingHalfContentRectsRef = useRef<readonly [DOMRect, DOMRect] | null>(null)
  const halfAnimationsRef = useRef<Animation[]>([])
  const searchRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const isSearchExpanded = searchExpansionKey === location.key
  const isSearchOpen = !shouldSeparate || isSearchExpanded

  useLayoutEffect(() => {
    const halves = [leftHalfRef.current, rightHalfRef.current] as const

    if (!halves[0] || !halves[1]) return

    const previousRects = pendingHalfContentRectsRef.current
    pendingHalfContentRectsRef.current = null
    halfAnimationsRef.current.forEach((animation) => animation.cancel())
    halfAnimationsRef.current = []

    const nextRects = readHalfContentRects(leftHalfContentRef.current, rightHalfContentRef.current)

    if (
      !previousRects ||
      !nextRects ||
      !isDesktop ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) return

    halfAnimationsRef.current = halves.flatMap((half, index) => {
      if (!half) return []
      const deltaX = previousRects[index].left - nextRects[index].left
      const deltaY = previousRects[index].top - nextRects[index].top
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return []

      return [half.animate(
        [
          { transform: 'translate(' + deltaX + 'px, ' + deltaY + 'px)' },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 1600, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      )]
    })
  }, [isDesktop, shouldSeparate])

  useEffect(() => () => {
    halfAnimationsRef.current.forEach((animation) => animation.cancel())
    halfAnimationsRef.current = []
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const loadAuthState = async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include', signal: controller.signal })
        const payload = await readJsonPayload(response)
        if (controller.signal.aborted) return
        if (!response.ok || !isAuthMePayload(payload)) {
          setAuthState({ status: 'anonymous', user: null })
          return
        }
        setAuthState(payload.authenticated
          ? { status: 'authenticated', user: payload.user }
          : { status: 'anonymous', user: null })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setAuthState({ status: 'anonymous', user: null })
      }
    }
    loadAuthState()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_MEDIA_QUERY)
    const updateDesktop = (event: MediaQueryListEvent) => {
      setIsDesktop(event.matches)
      if (!event.matches) setSearchExpansionKey(null)
    }
    query.addEventListener('change', updateDesktop)
    return () => query.removeEventListener('change', updateDesktop)
  }, [])

  useEffect(() => {
    let frameId: number | null = null
    const updateSeparated = () => {
      frameId = null
      const next = isSeparatedRef.current
        ? window.scrollY >= NAVBAR_MERGE_THRESHOLD
        : window.scrollY > NAVBAR_SEPARATE_THRESHOLD
      if (next !== isSeparatedRef.current) {
        pendingHalfContentRectsRef.current = readHalfContentRects(
          leftHalfContentRef.current,
          rightHalfContentRef.current,
        )
        isSeparatedRef.current = next
        setIsSeparated(next)
        if (!next) setSearchExpansionKey(null)
      }
    }
    const handleScroll = () => {
      if (frameId === null) frameId = window.requestAnimationFrame(updateSeparated)
    }
    updateSeparated()
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (frameId !== null) window.cancelAnimationFrame(frameId)
    }
  }, [])

  useEffect(() => {
    if (!shouldSeparate || !isSearchExpanded) return undefined
    const frameId = window.requestAnimationFrame(() => searchInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frameId)
  }, [isSearchExpanded, shouldSeparate])

  useEffect(() => {
    if (!shouldSeparate || !isSearchExpanded) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && searchRef.current?.contains(event.target)) return
      setSearchExpansionKey(null)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSearchExpansionKey(null)
      searchButtonRef.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSearchExpanded, shouldSeparate])

  useEffect(() => {
    if (!isAccountMenuOpen) return undefined
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && accountRef.current?.contains(event.target)) return
      setIsAccountMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setIsAccountMenuOpen(false)
      accountButtonRef.current?.focus()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isAccountMenuOpen])

  const handleDropdownBlur = (event: FocusEvent<HTMLLIElement>) => {
    const nextTarget = event.relatedTarget
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setOpenMenu(null)
  }
  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => event.preventDefault()
  const handleSearchButtonClick = () => {
    if (!isSearchOpen) setSearchExpansionKey(location.key)
  }
  const handleAccountToggle = () => {
    setSignOutError(null)
    setIsAccountMenuOpen((isOpen) => !isOpen)
  }
  const handleSignOut = async () => {
    if (authState.status !== 'authenticated' || isSigningOut) return
    setIsSigningOut(true)
    setSignOutError(null)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
      if (!response.ok) throw new Error('Sign out failed.')
      setAuthState({ status: 'anonymous', user: null })
      setIsAccountMenuOpen(false)
      navigate('/', { replace: false })
    } catch {
      setSignOutError('Unable to sign out. Please try again.')
    } finally { setIsSigningOut(false) }
  }

  const renderNavItems = (items: NavItem[]) => items.map((item) => {
    const isOpen = openMenu === item.id
    const isActive = isNavItemActive(item.id, location.pathname)
    if (!item.dropdown) {
      return (
        <li className={isActive ? 'active' : undefined} key={item.id}>
          <Link aria-current={isActive ? 'page' : undefined} className="nav-link"
            onClick={() => {
              setOpenMenu(null)
              if (location.pathname === '/') window.scrollTo({ left: 0, top: 0 })
            }} to={item.href ?? '/'}>
            {item.icon ? <span aria-hidden="true" className="nav-link-icon">{item.icon}</span> : null}
            {item.label}
          </Link>
        </li>
      )
    }
    return (
      <li className={`dropdown${isOpen ? ' is-open' : ''}${isActive ? ' active' : ''}`}
        key={item.id} onBlur={handleDropdownBlur}
        onMouseEnter={() => setOpenMenu(item.id)} onMouseLeave={() => setOpenMenu(null)}>
        <button aria-current={isActive ? 'page' : undefined} aria-expanded={isOpen}
          aria-haspopup="true" className="nav-link nav-trigger"
          onClick={() => setOpenMenu(isOpen ? null : item.id)}
          onFocus={() => setOpenMenu(item.id)} type="button">
          {item.label}<span aria-hidden="true" className="nav-caret">&#9662;</span>
        </button>
        <div className="dropdown-menu">
          {item.dropdown.map((dropdownItem) => dropdownItem.href ? (
            <Link key={dropdownItem.label} onClick={() => setOpenMenu(null)} to={dropdownItem.href}>
              {dropdownItem.label}
            </Link>
          ) : (
            <span aria-disabled="true" className="dropdown-menu-placeholder" key={dropdownItem.label}>
              {dropdownItem.label}<small>Coming soon</small>
            </span>
          ))}
        </div>
      </li>
    )
  })

  return (
    <nav aria-label="Primary navigation" className={`navbar ${shouldSeparate ? 'is-separated' : 'is-merged'}`}>
      <div className="navbar-shell">
        <div className="navbar-half navbar-half-left" ref={leftHalfRef}>
          <div className="navbar-half-content navbar-half-content-left" ref={leftHalfContentRef}>
            <ul className="nav-menu">{renderNavItems(leftNavItems)}</ul>
          </div>
        </div>
        <div className="navbar-half navbar-half-right" ref={rightHalfRef}>
          <div className="navbar-half-content navbar-half-content-right" ref={rightHalfContentRef}>
            <ul className="nav-menu">{renderNavItems(rightNavItems)}</ul>
            <div className="navbar-search" ref={searchRef}>
            <form className={`search-box ${isSearchOpen ? 'is-open' : 'is-collapsed'}`}
              onSubmit={handleSearchSubmit} role="search">
              <input aria-hidden={!isSearchOpen} aria-label="Search scientific topics"
                id="navbar-search-input" onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search scientific topics..." ref={searchInputRef}
                tabIndex={isSearchOpen ? 0 : -1} type="search" value={searchTerm} />
              <button aria-controls="navbar-search-input" aria-expanded={isSearchOpen}
                aria-label={isSearchOpen ? 'Search' : 'Open search'}
                onClick={handleSearchButtonClick} ref={searchButtonRef}
                type={isSearchOpen ? 'submit' : 'button'}>&#8981;</button>
            </form>
          </div>
            <div className="navbar-auth" ref={accountRef}>
            {authState.status === 'authenticated' ? <>
              <button aria-controls="account-menu" aria-expanded={isAccountMenuOpen}
                aria-haspopup="menu" className="login-nav-button account-nav-button"
                onClick={handleAccountToggle} ref={accountButtonRef} type="button">
                <span className="account-button-label">{authState.user.username}</span>
              </button>
              <div aria-label="Account menu" className={`account-menu${isAccountMenuOpen ? ' is-open' : ''}`}
                id="account-menu" role="menu">
                <div className="account-email" role="presentation">{authState.user.email}</div>
                <button className="account-menu-action" disabled={isSigningOut}
                  onClick={handleSignOut} role="menuitem" type="button">
                  {isSigningOut ? 'Signing Out...' : 'Sign Out'}
                </button>
                {signOutError ? <p className="account-menu-error" role="alert">{signOutError}</p> : null}
              </div>
            </> : authState.status === 'loading' ? (
              <span aria-busy="true" aria-label="Checking sign-in status"
                className="login-nav-button auth-loading-button"><span>Login</span></span>
            ) : <Link className="login-nav-button" to="/login"><span>Login</span></Link>}
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}
export default Navbar
