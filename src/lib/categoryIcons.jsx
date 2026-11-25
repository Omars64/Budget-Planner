import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BanknoteArrowDown, Briefcase, BusFront, CircleHelp,
  Clapperboard, Coffee, FileText, Fuel, Gift, GraduationCap, House, Landmark, Laptop, Plane,
  ShoppingBag, ShoppingBasket, Stethoscope, Utensils, Wallet
} from 'lucide-react'

function HandBanknote({ size = 24, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" {...props}>
    <rect x="9" y="3" width="13" height="8" rx="1.5"/>
    <path d="M15.5 6.4v1.2M2 15h3v6H2m3-4 4-4h4a2 2 0 0 1 0 4h-2m-6 3h9l6-5a1.7 1.7 0 0 0-2.4-2.3l-3.5 3"/>
  </svg>
}

const categories = [
  ['lending', HandBanknote, '#ffc87c', /\b(lend(?:ing)?|lent|loan(?:ed)? to)\b/],
  ['groceries', ShoppingBasket, '#a7f3ac', /\b(grocer(?:y|ies)|supermarkets?)\b/],
  ['coffee', Coffee, '#f0c49f', /\b(coffee|cafes?)\b/],
  ['dining', Utensils, '#ffac86', /\b(food|dining|restaurants?|takeout)\b/],
  ['fuel', Fuel, '#ffe58e', /\b(fuel|petrol|gas station)\b/],
  ['transport', BusFront, '#82dcff', /\b(transport(?:ation)?|bus|metro|taxi|commut(?:e|ing)|parking)\b/],
  ['health', Stethoscope, '#ffa5a1', /\b(health(?:care)?|medical|pharmacy|dental)\b/],
  ['housing', House, '#c1b1ff', /\b(home|housing|rent|mortgage)\b/],
  ['bills', FileText, '#ace6fa', /\b(bills?|utilities|utility|internet|subscriptions?)\b/],
  ['salary', BanknoteArrowDown, '#9cf0ca', /\b(salary|payroll|wages)\b/],
  ['transfers', ArrowLeftRight, '#91edec', /\btransfers?\b/],
  ['entertainment', Clapperboard, '#efbaff', /\b(entertainment|cinema|movies?)\b/],
  ['education', GraduationCap, '#ccdbff', /\b(education|school|tuition|courses?)\b/],
  ['gifts', Gift, '#ffacdb', /\bgifts?\b/],
  ['shopping', ShoppingBag, '#fd91ba', /\b(shopping|retail|clothing)\b/],
  ['loans', Landmark, '#b3b7f6', /\b(loans?|borrow(?:ed|ing)?|debt)\b/],
  ['freelance', Laptop, '#abe1fa', /\bfreelanc(?:e|ing)\b/],
  ['travel', Plane, '#a4ccff', /\b(travel|flights?|holiday|vacation)\b/]
].map(([key, Icon, color, pattern]) => ({ key, Icon, color, pattern }))

const byKey = new Map(categories.map(category => [category.key, category]))
const legacy = {
  utensils: 'dining', car: 'transport', 'shopping-bag': 'shopping', 'shopping-basket': 'groceries',
  house: 'housing', gamepad: 'entertainment', 'heart-pulse': 'health', receipt: 'bills',
  plane: 'travel', 'hand-coins': 'lending', gift: 'gifts', laptop: 'freelance'
}

// The glyph registry is shared by CategoryIcon and map markers.
// eslint-disable-next-line react-refresh/only-export-components
export function categoryAppearance(name, { type, openingBalance } = {}) {
  if (openingBalance) return { Icon: Wallet, color: '#ccc3e8' }
  if (type === 'transfer') return byKey.get('transfers')
  const normalized = (name || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[_-]/g, ' ')
  const category = categories.find(item => item.pattern.test(normalized))
  if (category) return category
  const slug = normalized.trim().replace(/\s+/g, '-')
  const stored = byKey.get(slug) || byKey.get(legacy[slug])
  if (stored) return stored
  if (normalized && normalized !== 'uncategorized' && normalized !== 'unassigned') {
    return { Icon: type === 'income' ? Briefcase : CircleHelp, color: '#c1cbe8' }
  }
  return { Icon: type === 'income' ? ArrowDownLeft : type === 'expense' ? ArrowUpRight : CircleHelp, color: '#c1cbe8' }
}

export function CategoryIcon({ name, type, openingBalance, size = 18 }) {
  const { Icon } = categoryAppearance(name, { type, openingBalance })
  return <Icon size={size} aria-hidden="true" focusable="false"/>
}
