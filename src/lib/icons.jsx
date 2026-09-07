import { Wallet, Landmark, CreditCard, Utensils, Car, ShoppingBag, House, Gamepad2, HeartPulse, ReceiptText, Plane, BriefcaseBusiness, Laptop, Gift, CircleDollarSign, Target, ShieldCheck, Circle } from 'lucide-react'

const Icons = { Wallet, Landmark, CreditCard, Utensils, Car, ShoppingBag, House, Gamepad2, HeartPulse, ReceiptText, Plane, BriefcaseBusiness, Laptop, Gift, CircleDollarSign, Target, ShieldCheck, Circle }

const aliases = {
  wallet: 'Wallet', landmark: 'Landmark', 'credit-card': 'CreditCard', utensils: 'Utensils', car: 'Car',
  'shopping-bag': 'ShoppingBag', house: 'House', gamepad: 'Gamepad2', 'heart-pulse': 'HeartPulse',
  receipt: 'ReceiptText', plane: 'Plane', briefcase: 'BriefcaseBusiness', laptop: 'Laptop', gift: 'Gift',
  'circle-dollar-sign': 'CircleDollarSign', target: 'Target', 'shield-check': 'ShieldCheck', circle: 'Circle',
}

export function DynamicIcon({ name = 'circle', size = 18, ...props }) {
  const C = Icons[aliases[name] || name] || Icons.Circle
  return <C size={size} {...props} />
}
