import { createContext, useContext } from 'react'
import { createPortal } from 'react-dom'

const PageActionsTarget = createContext(null)

export function PageActionsProvider({ target, children }) {
  return <PageActionsTarget.Provider value={target}>{children}</PageActionsTarget.Provider>
}

export default function PageActions({ children }) {
  const target = useContext(PageActionsTarget)
  return target ? createPortal(children, target) : children
}
