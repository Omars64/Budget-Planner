import { Component } from 'react'
import { RefreshCw } from 'lucide-react'
import { reportClientFailure } from '../lib/diagnostics'

export default class AppErrorBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { reportClientFailure('render') }
  render() {
    if (!this.state.failed) return this.props.children
    return <main className="budgetly-v2 recovery-screen" role="alert"><h1>Budgetly couldn’t display this page</h1><p>Your saved records have not been changed. Reload to try again.</p><button className="button primary" onClick={() => window.location.reload()}><RefreshCw size={18}/>Reload Budgetly</button></main>
  }
}
