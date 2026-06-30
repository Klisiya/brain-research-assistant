import './Footer.css'

function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-glow" />

      <div className="footer-content simple-footer-content">
        <div className="footer-brand">
          <h2>Frontiers in Brain Science and Brain-Inspired Intelligence</h2>
          <p>
            An educational learning platform for neuroscience, cognitive science,
            brain-computer interfaces, and brain-inspired intelligence.
          </p>
        </div>

        <div className="footer-note">
          <p>
            Educational use only. Content is not intended as medical advice, diagnosis,
            or treatment.
          </p>
          <p>3D model credit belongs to the original creator and source platform.</p>
        </div>
      </div>

      <div className="footer-bottom">
        <span>
          &copy; 2026 Frontiers in Brain Science and Brain-Inspired Intelligence. All
          rights reserved.
        </span>
      </div>
    </footer>
  )
}

export default Footer
