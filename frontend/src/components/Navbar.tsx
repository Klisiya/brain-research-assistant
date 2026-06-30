import { useState, type FocusEvent, type FormEvent } from 'react'
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

const navItems: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    icon: '\u2302',
    href: '#',
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
      { label: 'About This Project', href: '#' },
    ],
  },
  {
    id: 'more',
    label: 'More',
    icon: '\u25A6',
    dropdown: [
      { label: 'Learning Evaluation', href: '#' },
      { label: 'About & Disclaimer', href: '#' },
      { label: 'Contact', href: '#' },
    ],
  },
]

function Navbar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  const handleDropdownBlur = (event: FocusEvent<HTMLLIElement>) => {
    const nextTarget = event.relatedTarget

    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setOpenMenu(null)
    }
  }

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
  }

  return (
    <nav className="navbar" aria-label="Primary navigation">
      <ul className="nav-menu">
        {navItems.map((item) => {
          const isDropdown = Boolean(item.dropdown)
          const isOpen = openMenu === item.id

          if (!isDropdown) {
            return (
              <li className="active" key={item.id}>
                <a className="nav-link" href={item.href} aria-current="page">
                  <span
                    aria-hidden="true"
                    className="nav-link-icon"
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </a>
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
                {item.dropdown?.map((dropdownItem) => (
                  <a href={dropdownItem.href} key={dropdownItem.label}>
                    {dropdownItem.label}
                  </a>
                ))}
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

      <a className="login-nav-button" href="#">
        <span>Login</span>
      </a>
    </nav>
  )
}

export default Navbar
