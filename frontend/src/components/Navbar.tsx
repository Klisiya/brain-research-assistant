import { useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import './Navbar.css'

type DropdownItem = {
  label: string
  href: string
}

type NavItem = {
  id: string
  label: string
  icon: string
  href?: string
  dropdown?: DropdownItem[]
}

type AuthUser = {
  id: number
  username: string
  email: string
  role: string
}

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'anonymous'; user: null }
  | { status: 'authenticated'; user: AuthUser }

type AuthMePayload =
  | { authenticated: false; user: null }
  | { authenticated: true; user: AuthUser }

const navItems: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: '\u2302',
    href: '/',
  },
  {
    id: 'learning',
    label: 'Learning Center',
    icon: '\u{1F4D6}',
    dropdown: [
      { label: 'Course Overview', href: '#overview' },
      { label: 'Learning Units', href: '#modules' },
      { label: 'AI Tutor', href: '#ai-section' },
      { label: 'Knowledge Quiz', href: '#' },
    ],
  },
  {
    id: 'research',
    label: 'Research Areas',
    icon: '\u25CE',
    dropdown: [
      { label: 'Neuroscience', href: '#' },
      { label: 'Cognitive Science', href: '#' },
      { label: 'Brain-Computer Interfaces', href: '#' },
      { label: 'Brain-Inspired Computing', href: '#' },
      { label: 'Artificial Intelligence', href: '#' },
      { label: 'Brain Disorders', href: '#' },
    ],
  },
  {
    id: 'papers',
    label: 'Papers',
    icon: '\u25A4',
    dropdown: [
      { label: 'Research Recommendations', href: '#' },
      { label: 'Learning Resources', href: '#' },
      { label: 'Latest News', href: '#' },
      { label: 'About This Project', href: '/about' },
    ],
  },
  {
    id: 'more',
    label: 'More',
    icon: '\u25A6',
    dropdown: [
      { label: 'Learning Evaluation', href: '#' },
      { label: 'About & Disclaimer', href: '/about' },
      { label: 'Contact', href: '/contact' },
    ],
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAuthUser(value: unknown): value is AuthUser {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.username === 'string' &&
    typeof value.email === 'string' &&
    typeof value.role === 'string'
  )
}

function isAuthMePayload(value: unknown): value is AuthMePayload {
  return (
    (isRecord(value) && value.authenticated === false && value.user === null) ||
    (isRecord(value) && value.authenticated === true && isAuthUser(value.user))
  )
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
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
  const accountRef = useRef<HTMLDivElement>(null)
  const accountButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const controller = new AbortController()

    const loadAuthState = async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
          signal: controller.signal,
        })
        const payload = await readJsonPayload(response)

        if (controller.signal.aborted) {
          return
        }

        if (!response.ok || !isAuthMePayload(payload)) {
          setAuthState({ status: 'anonymous', user: null })
          return
        }

        setAuthState(payload.authenticated ? { status: 'authenticated', user: payload.user } : { status: 'anonymous', user: null })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }

        setAuthState({ status: 'anonymous', user: null })
      }
    }

    loadAuthState()

    return () => {
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (!isAccountMenuOpen) {
      return undefined
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target

      if (target instanceof Node && accountRef.current?.contains(target)) {
        return
      }

      setIsAccountMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

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

    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setOpenMenu(null)
    }
  }

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
  }

  const handleAccountToggle = () => {
    setSignOutError(null)
    setIsAccountMenuOpen((isOpen) => !isOpen)
  }

  const handleSignOut = async () => {
    if (authState.status !== 'authenticated' || isSigningOut) {
      return
    }

    setIsSigningOut(true)
    setSignOutError(null)

    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Sign out failed.')
      }

      setAuthState({ status: 'anonymous', user: null })
      setIsAccountMenuOpen(false)
      navigate('/', { replace: false })
    } catch {
      setSignOutError('Unable to sign out. Please try again.')
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <nav className="navbar" aria-label="Primary navigation">
      <ul className="nav-menu">
        {navItems.map((item) => {
          const isDropdown = Boolean(item.dropdown)
          const isOpen = openMenu === item.id

          if (!isDropdown) {
            const isActive = location.pathname === item.href

            return (
              <li className={isActive ? 'active' : undefined} key={item.id}>
                <Link
                  aria-current={isActive ? 'page' : undefined}
                  className="nav-link"
                  to={item.href ?? '/'}
                >
                  <span
                    aria-hidden="true"
                    className="nav-link-icon"
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </Link>
              </li>
            )
          }

          return (
            <li
              className={`dropdown${isOpen ? ' is-open' : ''}`}
              key={item.id}
              onBlur={handleDropdownBlur}
              onMouseEnter={() => setOpenMenu(item.id)}
              onMouseLeave={() => setOpenMenu(null)}
            >
              <button
                type="button"
                className="nav-link nav-trigger"
                aria-expanded={isOpen}
                aria-haspopup="true"
                onClick={() => setOpenMenu(isOpen ? null : item.id)}
                onFocus={() => setOpenMenu(item.id)}
              >
                <span
                  aria-hidden="true"
                  className="nav-link-icon"
                >
                  {item.icon}
                </span>
                {item.label}
                <span aria-hidden="true" className="nav-caret">
                  &#9662;
                </span>
              </button>

              <div className="dropdown-menu">
                {item.dropdown?.map((dropdownItem) =>
                  dropdownItem.href.startsWith('/') ? (
                    <Link
                      key={dropdownItem.label}
                      to={dropdownItem.href}
                      onClick={() => setOpenMenu(null)}
                    >
                      {dropdownItem.label}
                    </Link>
                  ) : (
                    <a href={dropdownItem.href} key={dropdownItem.label}>
                      {dropdownItem.label}
                    </a>
                  ),
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <form className="search-box" role="search" onSubmit={handleSearchSubmit}>
        <input
          aria-label="Search scientific topics"
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search scientific topics..."
          type="search"
          value={searchTerm}
        />
        <button type="submit" aria-label="Search">
          &#8981;
        </button>
      </form>

      <div className="navbar-auth" ref={accountRef}>
        {authState.status === 'authenticated' ? (
          <>
            <button
              aria-controls="account-menu"
              aria-expanded={isAccountMenuOpen}
              aria-haspopup="menu"
              className="login-nav-button account-nav-button"
              onClick={handleAccountToggle}
              ref={accountButtonRef}
              type="button"
            >
              <span className="account-button-label">{authState.user.username}</span>
            </button>

            <div
              aria-label="Account menu"
              className={`account-menu${isAccountMenuOpen ? ' is-open' : ''}`}
              id="account-menu"
              role="menu"
            >
              <div className="account-email" role="presentation">
                {authState.user.email}
              </div>

              <button className="account-menu-action" disabled={isSigningOut} onClick={handleSignOut} role="menuitem" type="button">
                {isSigningOut ? 'Signing Out...' : 'Sign Out'}
              </button>

              {signOutError ? (
                <p className="account-menu-error" role="alert">
                  {signOutError}
                </p>
              ) : null}
            </div>
          </>
        ) : authState.status === 'loading' ? (
          <span aria-busy="true" aria-label="Checking sign-in status" className="login-nav-button auth-loading-button">
            <span>Login</span>
          </span>
        ) : (
          <Link className="login-nav-button" to="/login">
            <span>Login</span>
          </Link>
        )}
      </div>
    </nav>
  )
}

export default Navbar
