import { motion } from 'framer-motion'

export default function MetricCard({ label, value, sub, icon: Icon, tone = 'accent', delay = 0 }) {
  return <motion.div className={`metric-card glass tone-${tone}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }} whileHover={{ y: -3 }}>
    <div className="metric-icon"><Icon size={19}/></div>
    <div><p>{label}</p><strong>{value}</strong>{sub && <small>{sub}</small>}</div>
  </motion.div>
}
