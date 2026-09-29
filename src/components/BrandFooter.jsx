import { version } from '../../package.json'

export default function BrandFooter({ className = '' }) {
  return <div className={('brand-footer ' + className).trim()} role="contentinfo">
    <span>Copyrights 2026. All Rights Reserved (C)</span>
    <span>Budgetly (by Omar Solanki) v{version}</span>
  </div>
}
