import SettingsSection from './SettingsSection'

export default function PrivacySettings({ guest = false }) {
  return <SettingsSection title="Privacy policy" heading="How Budgetly uses your data">
    <div className="stack gap-10 muted">
      {guest ? <p>Guest records are stored on this device. Clearing app or browser data can remove them.</p> : <>
        <p>Your records are stored in Budgetly’s backend database and are available on devices signed in to your account.</p>
        <p>Google sign-in verifies your identity. Optional Google Drive backups require separate permission and are saved in your Google Drive. Those files stay in your Drive after disconnection or account deletion.</p>
        <p>People you share a wallet with can view its records. View-only members can download statements for that wallet. Statements include only wallets you can access.</p>
        <p>The full JSON backup includes your owned workspace. Keep downloaded files private.</p>
        <p>When Ask Budgetly AI is enabled, your question and the selected activity context are sent to OpenAI. Deleting an account removes live account data. Encrypted external backups may remain until their retention period ends.</p>
      </>}
      <a className="button ghost self-start" href="https://budget-planner-ecru-seven.vercel.app/privacy.html" target="_blank" rel="noopener noreferrer">Read the full privacy policy</a>
    </div>
  </SettingsSection>
}
