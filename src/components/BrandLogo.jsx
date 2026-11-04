export default function BrandLogo({ className = '', style = 'current' }) {
  return <img className={`brand-logo ${className}`} src={style === 'legacy' ? '/flowbudget-logo-legacy.png' : '/flowbudget-logo.png'} alt="Budgetly" width="40" height="40" />
}
