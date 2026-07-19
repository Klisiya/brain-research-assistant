import Footer from '../components/Footer'
import Navbar from '../components/Navbar'
import PageParticleBackground from '../components/PageParticleBackground'
import './ContactPage.css'

const contactDetails = [
  {
    key: 'affiliation',
    marker: 'KM',
    title: 'Affiliation',
    lines: [
      'Biochemistry and Molecular Department,',
      'College of Basic Medicine,',
      'Kunming Medical University,',
      'Kunming 650500, Yunnan, China',
    ],
  },
  {
    key: 'telephone',
    marker: 'TEL',
    title: 'Telephone',
    lines: ['+86-871-65922863', '+86-15087106898'],
  },
  {
    key: 'email',
    marker: '@',
    title: 'Email',
    lines: ['ganping@kmmu.edu.cn'],
  },
]

function getContactHref(key: string, line: string) {
  if (key === 'email') return 'mailto:' + line
  if (key === 'telephone') return 'tel:' + line.replace(/[^+\d]/g, '')
  return null
}

function ContactDetails() {
  return (
    <div className="contact-react-list">
      {contactDetails.map((detail) => (
        <div className="contact-react-item" key={detail.key}>
          <span aria-hidden="true" className="contact-react-marker">{detail.marker}</span>
          <div>
            <h3>{detail.title}</h3>
            <p>
              {detail.lines.map((line, index) => {
                const href = getContactHref(detail.key, line)
                return (
                  <span key={line}>
                    {href ? <a href={href}>{line}</a> : line}
                    {index < detail.lines.length - 1 ? <br /> : null}
                  </span>
                )
              })}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function ContactCard() {
  return (
    <section aria-label="Project contact" className="contact-react-card">
      <span className="contact-react-kicker">Project Contact</span>
      <h2>Project Contact</h2>
      <div className="contact-react-profile">
        <div aria-hidden="true" className="contact-react-profile-icon">PG</div>
        <div>
          <h3>Ping Gan</h3>
          <p>Associate Professor / Ph.D.</p>
        </div>
      </div>
      <ContactDetails />
      <p className="contact-react-note">
        This contact information is provided for project, educational, and research
        inquiries. This platform does not provide medical diagnosis or treatment.
      </p>
    </section>
  )
}

function ContactPage() {
  return (
    <div className="contact-react-page">
      <PageParticleBackground />
      <Navbar />
      <main className="contact-react-main">
        <section className="contact-react-hero">
          <span className="contact-react-label">Contact</span>
          <h1>Get in Touch</h1>
          <p>
            Have questions, feedback, or suggestions about this brain science learning
            platform? Send a message!!!
          </p>
        </section>
        <ContactCard />
      </main>
      <Footer />
    </div>
  )
}

export default ContactPage
