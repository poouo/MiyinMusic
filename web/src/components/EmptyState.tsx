import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty">
      {icon ? <div className="empty__icon">{icon}</div> : null}
      <div className="empty__title">{title}</div>
      {description ? <div style={{ fontSize: 13, maxWidth: 360 }}>{description}</div> : null}
      {action ? <div style={{ marginTop: 10 }}>{action}</div> : null}
    </div>
  )
}
