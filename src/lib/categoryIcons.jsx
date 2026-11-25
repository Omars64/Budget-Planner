import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, BanknoteArrowDown, Briefcase, BusFront, CircleHelp,
  Clapperboard, Coffee, Fuel, Gift, GraduationCap, House, Landmark, Laptop, Plane,
  ShoppingBag, ShoppingBasket, Stethoscope, Utensils, Wallet
} from 'lucide-react'

function CategoryGlyph({ size = 24, children, ...props }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinejoin="round" strokeLinecap="round" {...props}>
    {children}
  </svg>
}

function HandBanknote(props) {
  return <CategoryGlyph {...props}>
    <path d="M9 5.5 12.5 3a3 3 0 0 1 2.4-.5l4.6 1h2v5.8h-2l-1.6 1.3a2.5 2.5 0 0 1-1.6.6H14"/>
    <rect x="4.5" y="5.5" width="12.5" height="7" rx=".65"/>
    <circle cx="10.6" cy="9" r="1.25"/>
    <path d="m4.7 16.6 2.5-1.3a2.2 2.2 0 0 1 1.7-.15l3.5 1.25a1.25 1.25 0 0 1-.8 2.37l-2.4-.83m3.45.36 4.65-2.4a1.3 1.3 0 0 1 1.25 2.23l-5.1 3.1a2.4 2.4 0 0 1-1.9.25L8.2 20.5l-1 .5"/>
    <path d="m1.7 17.4 2.5-1.4 3.2 5.4-2.5 1.4z"/>
  </CategoryGlyph>
}

function BillReceipt(props) {
  return <CategoryGlyph {...props}>
    <path d="M5 2h14v20l-2.3-2.2-2.3 2.2-2.4-2.2-2.4 2.2-2.3-2.2L5 22V2Z"/>
    <circle cx="12" cy="8" r="3.25"/>
    <path d="M12 6.15v3.7m1.02-2.92h-1.54a.55.55 0 0 0 0 1.1h1a.55.55 0 1 1 0 1.1h-1.54M8 14h8m-8 3h8"/>
  </CategoryGlyph>
}

function LunchPlate(props) {
  return <CategoryGlyph {...props}>
    <circle cx="12.1" cy="12.2" r="6.5"/>
    <circle cx="12.1" cy="12.2" r="4.35"/>
    <path d="M1.4 5.9v3a2.1 2.1 0 0 0 4.2 0v-3M3.5 5.9v12.9m17 0v-4.9h1.9V5.5c-1.5 1.15-2.45 3.4-2.45 5.65v1.13l.55 1.62"/>
  </CategoryGlyph>
}

function SnackPacket(props) {
  return <CategoryGlyph {...props}>
    <path d="M7 2h10a1.8 1.8 0 0 1 1.8 1.8v2.1c0 1.6-.7 2.3-.7 4v4.2c0 1.7.7 2.4.7 4v2.1A1.8 1.8 0 0 1 17 22H7a1.8 1.8 0 0 1-1.8-1.8v-2.1c0-1.6.7-2.3.7-4V9.9c0-1.7-.7-2.4-.7-4V3.8A1.8 1.8 0 0 1 7 2ZM5.2 5h13.6m-13.6 14h13.6M6 10.5l12.5-4M5.7 17.4l12.4-4"/>
    <path d="M9.5 12.5c1 .8 2.4 1.2 3.55-.3.6-.8 1.75-.05 1.12 1.1-.9 1.62-2.84 2.16-4.68.75-.92-.7-.65-2.08.01-1.55Z" strokeWidth="1.25"/>
  </CategoryGlyph>
}

const categories = [
  ['lending', HandBanknote, '#ffc87c', /\b(lend(?:ing|ed)?|lent|loan(?:ed)? to)\b/],
  ['groceries', ShoppingBasket, '#a7f3ac', /\b(grocer(?:y|ies)|supermarkets?)\b/],
  ['coffee', Coffee, '#f0c49f', /\b(coffee|cafes?)\b/],
  ['snacks', SnackPacket, '#ffca91', /\bsnacks?\b/],
  ['lunch', LunchPlate, '#ffc1a7', /\blunch(?:es)?\b/],
  ['dining', Utensils, '#ffac86', /\b(food|dining|restaurants?|takeout)\b/],
  ['fuel', Fuel, '#ffe58e', /\b(fuel|petrol|gas station)\b/],
  ['transport', BusFront, '#82dcff', /\b(transport(?:ation)?|bus|metro|taxi|commut(?:e|ing)|parking)\b/],
  ['health', Stethoscope, '#ffa5a1', /\b(health(?:care)?|medical|pharmacy|dental)\b/],
  ['housing', House, '#c1b1ff', /\b(home|housing|rent|mortgage)\b/],
  ['bills', BillReceipt, '#ace6fa', /\b(bills?|utilities|utility|internet|subscriptions?)\b/],
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
