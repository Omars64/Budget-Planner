import { MapPinned, Radio, Sheet, BarChart3, BellDot, CalendarClock, CalendarDays, Gauge, Landmark, LayoutDashboard, ReceiptText, Target, WalletCards, CircleHelp, MessageSquare, NotebookPen, Settings, Users, Menu } from 'lucide-react'

export const workspaceNavigation = [
  ['/', 'Overview', LayoutDashboard, 'Every day', 'Balances, recent activity and what needs attention'],
  ['/transactions', 'Transactions', ReceiptText, 'Every day', 'Find, add and manage recorded entries'],
  ['/wallets', 'Wallets', WalletCards, 'Every day', 'Bank cards, cash and wallet balances'],
  ['/upcoming', 'Upcoming', CalendarClock, 'Every day', 'Planned payments, reminders and automatic entries'],
  ['/budgets', 'Budgets', Gauge, 'Every day', 'Spending limits and repeating budget periods'],
  ['/bank-messages', 'Bank Inbox', ReceiptText, 'Your workspace', 'Review bank alerts before recording them'],
  ['/spaces', 'Spaces', Users, 'Your workspace', 'Switch workspace or manage your shared Spaces'],
  ['/planner', 'Planner', BarChart3, 'Planning & insights', 'Forecast cash flow and explore a plan'],
  ['/attention', 'Attention', BellDot, 'Planning & insights', 'Items that need a closer look'],
  ['/calendar', 'Calendar', CalendarDays, 'Planning & insights', 'See activity and payments by date'],
  ['/goals', 'Goals & debts', Target, 'Planning & insights', 'Savings goals and debt repayments'],
  ['/debt-management', 'Debt Management', Landmark, 'Planning & insights', 'Loans, repayments and money lent'],
  ['/analytics', 'Analytics', BarChart3, 'Planning & insights', 'Understand spending and income trends'],
  ['/spending', 'Spending tracker', BarChart3, 'Planning & insights', 'See where your money goes'],
  ['/ask-ai', 'Ask Budgetly', CircleHelp, 'Tools & support', 'Guidance and conversations'],
  ['/workbooks', 'Workbooks', Sheet, 'Tools & support', 'Import and edit personal spreadsheets'],
  ['/notes', 'Notes', NotebookPen, 'Tools & support', 'Personal and shared notes'],
  ['/feedback', 'Feedback', MessageSquare, 'Tools & support', 'Send suggestions or report a problem'],
  ['/settings', 'Settings', Settings, 'Account', 'Appearance, notifications, backup and security'],
  ['/after-hours','After Hours',Radio,'Explore','Miami districts, custom audio and money reviews'],
  ['/spending-map','Spending Map',MapPinned,'Explore','Monthly transactions by category and date'],
  ['/more', 'More', Menu, 'Account', 'All tools, settings and support'],
]

export const everydayRoutes = new Set(['/', '/transactions', '/wallets', '/upcoming', '/budgets', '/bank-messages', '/spaces', '/settings', '/more', '/admin'])
