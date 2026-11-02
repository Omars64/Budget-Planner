import SpaceSwitcher from '../components/SpaceSwitcher'

export default function Spaces() {
  return <section className="everyday-page spaces-library glass" aria-label="Your spaces">
    <div className="everyday-section-heading"><div><h3>Your spaces</h3><p className="muted">Personal records stay separate. Each shared Space has its own wallets, records and members.</p></div></div>
    <SpaceSwitcher library/>
  </section>
}
