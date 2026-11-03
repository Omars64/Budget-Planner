import { showTime } from '../lib/time'

const jobNames = { scheduler: 'Scheduled entries', daily_backup: 'Daily recovery', external_backup: 'Independent backup' }

export default function OperationJobs({ jobs = {} }) {
  return Object.entries(jobs).map(([name, job]) => {
    const paused = name === 'scheduler' && job.paused === true
    const status = paused ? 'Paused' : !job.configured ? 'Not configured' : job.healthy ? 'Healthy' : 'Needs attention'
    return <div className="security-item" key={name}>
      <div><strong>{jobNames[name] || name}</strong><small>{job.last_run ? showTime(job.last_run) + ' Kuwait' : 'No heartbeat yet'}</small>
        {job.overdue_count > 0 && <small>{job.overdue_count} overdue entries</small>}</div>
      <span className={!paused && job.healthy === false ? 'form-error' : 'muted'}>{status}</span>
    </div>
  })
}
