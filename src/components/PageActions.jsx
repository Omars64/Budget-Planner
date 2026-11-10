import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'

const PageActionsTarget = createContext(null)

export function PageActionsProvider({ target, floatingTarget, children }) {
  return <PageActionsTarget.Provider value={{ target, floatingTarget }}>{children}</PageActionsTarget.Provider>
}

export default function PageActions({ children, floating = false }) {
  const targets = useContext(PageActionsTarget)
  const target = floating ? targets?.floatingTarget : targets?.target
  return target ? createPortal(children, target) : children
}
