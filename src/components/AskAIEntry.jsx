import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, ChartNoAxesCombined, CircleHelp, Sparkles, Target } from 'lucide-react'

export default function AskAIEntry({ month }) {
  const [question, setQuestion] = useState('')
  const navigate = useNavigate()
  const open = text => navigate('/ask-ai', { state: { question: text, month } })
  return <section className="ai-overview-entry" aria-label="Ask Budgetly">
    <div className="ai-entry-heading"><span className="ai-brand-mark"><Sparkles size={21}/></span><div><h3>Ask Budgetly</h3><p className="muted">Quick answers for your app and activity.</p></div></div>
    <form className="ai-entry-input" onSubmit={event => { event.preventDefault(); open(question) }}>
      <input aria-label="Ask Budgetly a question" placeholder="What's on your mind?" value={question} onChange={e => setQuestion(e.target.value)} maxLength={8000}/>
      <button className="ai-send" aria-label="Open Ask Budgetly" title="Open Ask Budgetly"><ArrowUp size={20}/></button>
    </form>
    <div className="ai-entry-prompts">
      <button onClick={() => open('Where did my money go this month?')}><ChartNoAxesCombined size={17}/>Explain my spending</button>
      <button onClick={() => open('Create a roadmap to reduce my spending across categories.')}><Target size={17}/>Make a budget plan</button>
      <button onClick={() => open('How do I share a wallet?')}><CircleHelp size={17}/>Help using Budgetly</button>
    </div>
  </section>
}
